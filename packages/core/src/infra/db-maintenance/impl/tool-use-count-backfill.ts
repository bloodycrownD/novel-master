/**
 * chat_message.tool_use_count 存量回填任务（metric-detail 弹窗读路径提速）。
 *
 * v18 补列前的存量行 tool_use_count 为 NULL——读侧（usage-stats 会话详情）
 * SUM 命中 NULL 行时兜底现算，本任务在后台把存量行补齐、让兜底集合收敛
 * 到零。骨架沿 runMessageContentCompaction 先例（谓词驱动 + keyset 游标
 * + 单行短事务 + KKV 完成标记），但不挂收尾维护链路——本任务只写小整数
 * 列，不搬正文不释放页空间，无 VACUUM 诉求。
 *
 * - 谓词：`role = 'assistant' AND tool_use_count IS NULL`（user/tool 行
 *   读侧永不消费，不回填）。
 * - 每批 ≤100 行：SELECT rowid/id/content 三列 → JS 侧解压 parse 数块 →
 *   单条短事务 UPDATE（带谓词防并发重复回填）→ 批间 setTimeout(0) 让步。
 * - 幂等可重入：任意中断安全，重启按谓词续扫。
 * - 坏行（解压/parse 失败）：写 0 隔离 + failedCount 计数，不阻断完成
 *   标记——该行正文对一切消费方都不可读，计数无从谈起，标记不置则任务
 *   永远收敛不了（每次启动重扫同一批坏行）。标记值存 JSON 快照
 *   （at + failedCount）。
 *
 * @module infra/db-maintenance/impl/tool-use-count-backfill
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteKkvRepository } from "@/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import { parseMessageContent } from "@/domain/chat/content/parse-message-content.js";
import { decodeMessageContent } from "@/domain/chat/logic/message-content-codec.js";
import { countToolUseBlocks } from "@/domain/chat/logic/tool-use-count.js";

/** KKV 完成标记两段式命名（module 为 nm- 短横线、key 为 camelCase）。 */
export const TOOL_USE_COUNT_KKV_MODULE = "nm-tool-use-count";
export const TOOL_USE_COUNT_KKV_KEY = "backfillDone";

/** 每批行数上限（短事务粒度，对齐 message-content-compaction 的 ≤100）。 */
const BATCH_SIZE = 100;

/** 单轮同步预算默认值（真机 5k 行量级库 <2s；重度库残余由调用方转后台续跑）。 */
export const DEFAULT_TOOL_USE_COUNT_SYNC_BUDGET_MS = 30_000;

/** 连续零进展批护栏阈值（对齐 message-content-compaction 的 3）。 */
const ZERO_PROGRESS_BATCH_LIMIT = 3;

/** {@link runToolUseCountBackfill} 入参。 */
export interface RunToolUseCountBackfillOptions {
  /** 同步预算（ms）：耗尽即返回（done=false），残余由调用方续跑。 */
  readonly syncBudgetMs?: number;
  /** 批间守卫（agent 活跃/维护 busy 任一命中即暂停本轮）。 */
  readonly shouldPause?: () => boolean;
}

/** {@link runToolUseCountBackfill} 结果。 */
export interface ToolUseCountBackfillRunResult {
  /** true = 谓词已空且完成标记已置。 */
  readonly done: boolean;
  /** 本次调用实际回填的行数。 */
  readonly backfilledCount: number;
  /** 解压/parse 失败被写 0 隔离的行数（需人工关注）。 */
  readonly failedCount: number;
  /** 零进展护栏/收尾谓词校验拦停（本进程应停止重试）。 */
  readonly stalled: boolean;
}

interface DoneMarker {
  readonly at: string;
  readonly failedCount: number;
}

async function readDoneMarker(
  conn: TdbcConnection
): Promise<DoneMarker | null> {
  const kkv = new SqliteKkvRepository(conn);
  const entry = await kkv.get(TOOL_USE_COUNT_KKV_MODULE, TOOL_USE_COUNT_KKV_KEY);
  if (entry == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(entry.value) as Partial<DoneMarker>;
    return {
      at: typeof parsed.at === "string" ? parsed.at : entry.value,
      failedCount:
        typeof parsed.failedCount === "number" &&
        Number.isFinite(parsed.failedCount)
          ? parsed.failedCount
          : 0,
    };
  } catch {
    return { at: entry.value, failedCount: 0 };
  }
}

async function countPendingRows(conn: TdbcConnection): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM chat_message
     WHERE role = 'assistant' AND tool_use_count IS NULL`
  );
  return Number(rows[0]?.n ?? 0);
}

/** 批间让步：setTimeout(0) 交还事件循环。 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 解一行 content 并数 tool_use 块；坏行抛错由调用方隔离。 */
function countRowToolUse(row: {
  id: string;
  content_json: string;
  content_encoding: string | null;
  content_blob: Uint8Array | string | null;
}): number {
  const raw =
    row.content_blob != null
      ? decodeMessageContent(
          row.content_encoding,
          row.content_blob,
          String(row.id)
        )
      : String(row.content_json);
  return countToolUseBlocks(parseMessageContent(raw));
}

/**
 * 执行一轮谓词驱动的 tool_use_count 回填。
 *
 * 可重入：每行 UPDATE 是独立短事务且带 NULL 谓词（并发端已回填时
 * changes=0 自然跳过）。
 */
export async function runToolUseCountBackfill(
  conn: TdbcConnection,
  options: RunToolUseCountBackfillOptions = {}
): Promise<ToolUseCountBackfillRunResult> {
  const marker = await readDoneMarker(conn);
  if (marker != null) {
    return {
      done: true,
      backfilledCount: 0,
      failedCount: marker.failedCount,
      stalled: false,
    };
  }

  const deadline = Date.now() + (options.syncBudgetMs ?? DEFAULT_TOOL_USE_COUNT_SYNC_BUDGET_MS);
  let backfilledCount = 0;
  let failedCount = 0;
  let zeroProgressBatches = 0;
  let cursor = 0;

  for (;;) {
    if (options.shouldPause?.()) {
      return { done: false, backfilledCount, failedCount, stalled: false };
    }

    const rows = await conn.query<{
      rowid: number;
      id: string;
      content_json: string;
      content_encoding: string | null;
      content_blob: Uint8Array | string | null;
    }>(
      `SELECT rowid, id, content_json, content_encoding, content_blob
       FROM chat_message
       WHERE role = 'assistant' AND tool_use_count IS NULL AND rowid > ?
       ORDER BY rowid
       LIMIT ${BATCH_SIZE}`,
      [cursor]
    );
    if (rows.length === 0) {
      break;
    }

    let batchChanges = 0;
    for (const row of rows) {
      let count: number;
      try {
        count = countRowToolUse(row);
      } catch (error) {
        // 坏行隔离：写 0 + 计数，不阻断收敛（行正文对一切消费方不可读，
        // 计数无从谈起；留在 NULL 谓词里只会让任务永远收敛不了）。
        failedCount += 1;
        count = 0;
        console.warn(
          `[tool-use-count-backfill] chat_message.id=${row.id} 解析失败，计数写 0：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      const result = await conn.transaction(async (tx) => {
        return await tx.execute(
          `UPDATE chat_message SET tool_use_count = ?
           WHERE id = ? AND role = 'assistant' AND tool_use_count IS NULL`,
          [count, row.id]
        );
      });
      if (result.changes > 0) {
        backfilledCount += 1;
        batchChanges += 1;
      }
    }
    cursor = Number(rows[rows.length - 1]!.rowid);

    if (batchChanges === 0) {
      zeroProgressBatches += 1;
      if (zeroProgressBatches >= ZERO_PROGRESS_BATCH_LIMIT) {
        console.warn(
          `[tool-use-count-backfill] 连续 ${ZERO_PROGRESS_BATCH_LIMIT} 批零进展，疑似原地打转，本轮中止`
        );
        return { done: false, backfilledCount, failedCount, stalled: true };
      }
    } else {
      zeroProgressBatches = 0;
    }

    if (Date.now() >= deadline) {
      return { done: false, backfilledCount, failedCount, stalled: false };
    }
    await yieldToEventLoop();
  }

  // 收尾谓词校验：游标扫完后谓词必须已空（本任务坏行也写 0 离开谓词，
  // 残留即异常——如驱动写回静默不生效）。
  const leftover = await countPendingRows(conn);
  if (leftover > 0) {
    console.warn(
      `[tool-use-count-backfill] 游标已扫完但谓词仍剩 ${leftover} 行，不置完成标记`
    );
    return { done: false, backfilledCount, failedCount, stalled: true };
  }

  await new SqliteKkvRepository(conn).set(
    TOOL_USE_COUNT_KKV_MODULE,
    TOOL_USE_COUNT_KKV_KEY,
    JSON.stringify({ at: new Date().toISOString(), failedCount })
  );
  return { done: true, backfilledCount, failedCount, stalled: false };
}
