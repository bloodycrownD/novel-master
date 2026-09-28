/**
 * 消息正文压缩搬运任务（message-content-compression 迁移层）。
 *
 * 不注册 schema migration 搬数据（跨 boot 框架缺失、空占位禁令封死
 * 「先登记后搬」），改用后台幂等压缩任务——先例：runDeferredFileCacheGc
 * 的「事务提交后调度」+ vfs-content-blob-zlib-v1 的谓词驱动分批骨架
 * （该 migration 已退役，骨架见 git 历史 63a35139）。
 *
 * - 谓词：`content_json != ''`（未压缩行）。每批 ≤100 行：SELECT
 *   id/content_json（不碰 blob 列）→ JS 侧 fflate 压缩 → 单条短事务
 *   UPDATE（置 blob + encoding + content_json=''）→ 批间 setTimeout(0)
 *   让步（mobile 事务内另有 TDBC 16ms 量子让步兜底）。
 * - 幂等可重入：中断（杀进程/会话运行）随时停，重启后谓词重扫续跑，
 *   已压缩行天然排除。
 * - 完成判定两态：进行中（剩余 N 条，谓词 COUNT）/ 已完成（谓词空 →
 *   置 KKV 完成标记 → 触发一次 runDatabaseMaintenance 归还页空间）。
 *   库里只有完成标记一种持久化进度，数据上无法区分「从未跑过」与
 *   「跑过若干批」，故不设「未开始」态。
 * - 升级首启有界同步收尾预算（默认 60s）：调用方传 {@link
 *   RunMessageContentCompactionOptions.syncBudgetMs}，超预算残余由
 *   调用方转后台续跑（再次调用本任务）。
 * - 并发安全：app 层组合守卫（按端取用，见各端调度接线）+ 驱动连接级
 *   互斥（tdbc）；本任务不感知具体守卫。
 *
 * 应急预案（spec 回滚方案）：若发布后发现解压 bug，可用同款任务反向
 * 解回明文——谓词反转为 `content_blob IS NOT NULL`，逐行 UPDATE 置回
 * content_json=解压明文、blob 两列置 NULL。读路径双形态保证反向搬完
 * 前后均可读。
 *
 * @module infra/db-maintenance/impl/message-content-compaction
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteKkvRepository } from "@/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import { encodeMessageContent } from "@/domain/chat/logic/message-content-codec.js";
import { createDbMaintenanceService } from "./db-maintenance.service.js";

/** KKV 完成标记两段式命名（module 为 nm- 短横线、key 为 camelCase，
 * 先例 `nm-search` / `nm-compaction-conditions`）。 */
export const MESSAGE_COMPACTION_KKV_MODULE = "nm-message-content";
export const MESSAGE_COMPACTION_KKV_KEY = "compactionDone";

/** 每批搬运行数上限（短事务粒度，spec 拍板 ≤100）。 */
const BATCH_SIZE = 100;

/** 升级首启同步收尾预算默认值（超预算残余转后台，spec 拍板 ≤60s）。 */
export const DEFAULT_COMPACTION_SYNC_BUDGET_MS = 60_000;

/** 搬运状态（双端存储页状态行数据源）。 */
export interface MessageCompactionStatus {
  /** 已完成：KKV 标记已置，或谓词空（数据上全压缩，等价完成）。 */
  readonly done: boolean;
  /** 未压缩行计数（进行中态的「剩余 N 条」）。 */
  readonly pendingCount: number;
}

/** {@link runMessageContentCompaction} 入参。 */
export interface RunMessageContentCompactionOptions {
  /**
   * 同步预算（ms）。默认 60s：升级首启有界同步收尾；预算耗尽即返回
   * （done=false），残余由调用方转后台再次调用。
   */
  readonly syncBudgetMs?: number;
  /**
   * 批间守卫（app 层组合守卫按端取用：agent 活跃/云同步/维护 busy）。
   * 返回 true 时本轮暂停并立即返回 done=false。
   */
  readonly shouldPause?: () => boolean;
}

/** {@link runMessageContentCompaction} 结果。 */
export interface MessageCompactionRunResult {
  /** true = 谓词已空且完成标记已置（含触发维护链路）。 */
  readonly done: boolean;
  /** 本次调用实际搬运的行数（幂等重入的第二遍为 0）。 */
  readonly compactedCount: number;
}

async function countPendingRows(conn: TdbcConnection): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chat_message WHERE content_json != ''"
  );
  return Number(rows[0]?.n ?? 0);
}

async function readDoneMarker(
  conn: TdbcConnection
): Promise<boolean> {
  const kkv = new SqliteKkvRepository(conn);
  const entry = await kkv.get(
    MESSAGE_COMPACTION_KKV_MODULE,
    MESSAGE_COMPACTION_KKV_KEY
  );
  return entry != null;
}

/**
 * 采样搬运状态（双端存储页两态状态行 + 启动零成本短路共用）。
 *
 * 稳态（已完成）只读 KKV 标记一次即返回，零 COUNT 成本；未完成才
 * COUNT 全表（仅迁移期间，73MB 量级库毫秒级）。
 */
export async function getMessageCompactionStatus(
  conn: TdbcConnection
): Promise<MessageCompactionStatus> {
  if (await readDoneMarker(conn)) {
    return { done: true, pendingCount: 0 };
  }
  const pendingCount = await countPendingRows(conn);
  return { done: pendingCount === 0, pendingCount };
}

/** 批间让步：setTimeout(0) 交还事件循环（desktop main / RN JS 线程）。 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 执行一轮谓词驱动的消息正文压缩搬运。
 *
 * 可重入：任意时刻中断（返回/异常/杀进程）都安全——每行 UPDATE 是独立
 * 短事务且带 `AND content_json != ''` 条件（并发重复搬运时 changes=0
 * 自然跳过），重启后谓词重扫续跑。
 */
export async function runMessageContentCompaction(
  conn: TdbcConnection,
  options: RunMessageContentCompactionOptions = {}
): Promise<MessageCompactionRunResult> {
  // 启动先查标记即走：此后每次启动零成本（spec 拍板）。
  if (await readDoneMarker(conn)) {
    return { done: true, compactedCount: 0 };
  }

  const budgetMs =
    options.syncBudgetMs ?? DEFAULT_COMPACTION_SYNC_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  let compactedCount = 0;

  for (;;) {
    if (options.shouldPause?.()) {
      return { done: false, compactedCount };
    }

    // 每批 ≤100 行：只取 id/content_json，不碰 blob 列（搬运源）。
    const rows = await conn.query<{ id: string; content_json: string }>(
      `SELECT id, content_json FROM chat_message
       WHERE content_json != ''
       ORDER BY rowid
       LIMIT ${BATCH_SIZE}`
    );
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      // 单条短事务 UPDATE：置 blob + encoding + content_json=''。
      // 条件带谓词防并发重复搬运（另一端/上一轮已搬走时 changes=0）。
      const encoded = encodeMessageContent(row.content_json);
      await conn.transaction(async (tx) => {
        await tx.execute(
          `UPDATE chat_message
           SET content_blob = ?, content_encoding = ?, content_json = ''
           WHERE id = ? AND content_json != ''`,
          [encoded.blob, encoded.encoding, row.id]
        );
      });
      compactedCount += 1;
    }

    // 批间让步：预算检查放批粒度（行粒度事务已足够短）。
    if (Date.now() >= deadline) {
      return { done: false, compactedCount };
    }
    await yieldToEventLoop();
  }

  // 谓词空 → 两段式置 KKV 完成标记（module/key 命名见常量注释）。
  await new SqliteKkvRepository(conn).set(
    MESSAGE_COMPACTION_KKV_MODULE,
    MESSAGE_COMPACTION_KKV_KEY,
    new Date().toISOString()
  );
  // 完成后触发一次维护链路（缓存 GC → checkpoint → VACUUM，事务外
  // 直调——搬运释放的页挂 freelist，VACUUM 归还文件系统）。VACUUM 失败
  // 不影响正确性（标记已置，用户手动「数据清理」同样可收缩）。
  await createDbMaintenanceService(conn).runDatabaseMaintenance();
  return { done: true, compactedCount };
}
