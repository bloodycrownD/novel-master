/**
 * 存量 blob 行形态归一任务（zlib-b64 base64 文本 → 二进制 BLOB）。
 *
 * 骨架对齐同目录 {@link runMessageContentCompaction}：谓词查询 → 每批
 * ≤100 行 → 每行短事务 → 批间 setTimeout(0) 让步 → 单轮同步预算 →
 * 每表 KKV 完成标记 → 完成后挂一次维护链路。不注册 schema migration
 * （无进度语义、空占位登记禁令）。
 *
 * - 谓词（三表同形）：`encoding = 'zlib-b64' OR (encoding = 'zlib' AND
 *   TYPEOF(bytes) = 'text')`。**必须用 TYPEOF 判别而不是只看 encoding**
 *   ——quick-sqlite 时代遗留「encoding=zlib 但存的是 base64 文本」的脏
 *   形态，只看 encoding 会漏掉那批行。
 * - 表适配器化：一张表一个 adapter（表名、主键列、SELECT/UPDATE SQL、
 *   完成标记 key），由 {@link TABLE_ADAPTERS} 数组驱动；新增表只加一条
 *   适配器，不改流程代码。SELECT 只取主键 + encoding + bytes（搬运源），
 *   不碰其它列。
 * - **不按 rowid 排序**：本任务注册的表都是 `WITHOUT ROWID`，`rowid`
 *   不存在——按主键列排序 + LIMIT 分批。
 * - 并发幂等：UPDATE 的 WHERE 带同一谓词，另一端/上一轮已归一时
 *   `changes = 0`，静默跳过。
 * - 归一动作：base64 文本 → 二进制 Uint8Array，置 `encoding = 'zlib'`
 *   与 `byte_len = ` 物理字节长度。存量 `byte_len` 写法三态混杂（base64
 *   文本长度 / 二进制长度 / 二进制长度 −2），故本任务**一律重算**。
 * - 可重入：中断（杀进程/预算耗尽）随时停，重启后谓词重扫续跑，已归一
 *   行天然排除。完成判定两态同 compaction：进行中（剩余 N 条，谓词
 *   COUNT）/ 已完成（谓词空 → 置 KKV 完成标记）。
 * - 无 schema 变更：三表 `encoding` CHECK 值域已含 `'zlib'`，读路径
 *   `decodeCompressedBytes` 三形态兼容是既有契约，存量行不转换也能读。
 *
 * @module infra/db-maintenance/impl/blob-binary-normalization
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SqlValue } from "@/infra/tdbc/types.js";
import { SqliteKkvRepository } from "@/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import { base64ToBytes } from "@/domain/vfs/content-store/logic/blob-bytes-codec.js";
import {
  asBase64Text,
  VFS_CONTENT_ENCODING_ZLIB,
} from "@/domain/vfs/content-store/logic/zlib-codec.js";
import { runStartupMaintenanceOnce } from "./db-maintenance.service.js";

/** KKV 完成标记两段式命名（module 为 nm- 短横线、key 为 camelCase，
 * 先例 `nm-message-content` / `nm-compaction-conditions`）。 */
export const BLOB_BINARY_KKV_MODULE = "nm-blob-binary";

/** 每批归一行数上限（短事务粒度，spec 拍板 ≤100）。 */
const BATCH_SIZE = 100;

/** 升级首启同步收尾预算默认值（超预算残余转后台，spec 拍板 ≤60s）。 */
export const DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS = 60_000;

/**
 * 归一谓词（两表同形，逐字复用进 SELECT 的 WHERE 与 UPDATE 的 WHERE）。
 *
 * @remarks `TYPEOF(bytes) = 'text'` 覆盖「encoding='zlib' 但列里存的是
 * base64 文本」的历史脏形态；只看 encoding 会漏掉这批行。
 */
const PREDICATE = `(encoding = 'zlib-b64' OR (encoding = 'zlib' AND TYPEOF(bytes) = 'text'))`;

/** 归一任务覆盖的表标识（与完成标记 key 一一对应，互不牵连）。 */
export type BlobBinaryTableId = "vfsContent" | "fileCache";

/** 一张待归一 blob 表的适配器（表名 / 主键列 / SQL / 完成标记 key）。 */
interface BlobTableAdapter {
  /** 对外标识（状态查询返回的 `table` 值）。 */
  readonly tableId: BlobBinaryTableId;
  /** 物理表名（错误文案与日志用）。 */
  readonly table: string;
  /** 主键列名（本轮两表同为 content_hash）。 */
  readonly primaryKeyColumn: string;
  /** 该表的 KKV 完成标记 key。 */
  readonly doneKey: string;
  /** 谓词批查询 SQL（只取主键 + encoding + bytes，按主键排序分批）。 */
  readonly selectSql: string;
  /** 逐行归一 UPDATE SQL（WHERE 带同一谓词保证并发幂等）。 */
  readonly updateSql: string;
}

/**
 * 注册表清单（数组驱动流程）。
 *
 * @remarks `chat_message` 适配器属 A2 波次（该表在
 * message-content-compression 分支上，合并后再追加），本轮只归一两表。
 * 两表均为 `WITHOUT ROWID`，故排序用主键列而非 rowid。
 */
const TABLE_ADAPTERS: readonly BlobTableAdapter[] = [
  {
    tableId: "vfsContent",
    table: "vfs_content_blob",
    primaryKeyColumn: "content_hash",
    doneKey: "vfsContentDone",
    selectSql: `SELECT content_hash, encoding, bytes FROM vfs_content_blob
       WHERE ${PREDICATE}
       ORDER BY content_hash
       LIMIT ${BATCH_SIZE}`,
    updateSql: `UPDATE vfs_content_blob
       SET bytes = ?, encoding = '${VFS_CONTENT_ENCODING_ZLIB}', byte_len = ?
       WHERE content_hash = ? AND ${PREDICATE}`,
  },
  {
    tableId: "fileCache",
    table: "session_file_cache_blob",
    primaryKeyColumn: "content_hash",
    doneKey: "fileCacheDone",
    selectSql: `SELECT content_hash, encoding, bytes FROM session_file_cache_blob
       WHERE ${PREDICATE}
       ORDER BY content_hash
       LIMIT ${BATCH_SIZE}`,
    updateSql: `UPDATE session_file_cache_blob
       SET bytes = ?, encoding = '${VFS_CONTENT_ENCODING_ZLIB}', byte_len = ?
       WHERE content_hash = ? AND ${PREDICATE}`,
  },
];

/** 单表归一状态（状态查询一行）。 */
export interface BlobBinaryTableStatus {
  /** 表标识。 */
  readonly table: BlobBinaryTableId;
  /** 已完成：KKV 标记已置，或谓词空（数据上已全归一，等价完成）。 */
  readonly done: boolean;
  /** 未归一行计数（进行中态的「剩余 N 条」）。 */
  readonly pendingCount: number;
}

/** {@link getBlobBinaryStatus} 结果。 */
export interface BlobBinaryStatus {
  /** 各表状态（顺序与注册表一致）。 */
  readonly tables: readonly BlobBinaryTableStatus[];
}

/** {@link runBlobBinaryNormalization} 入参。 */
export interface RunBlobBinaryNormalizationOptions {
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

/** {@link runBlobBinaryNormalization} 结果。 */
export interface BlobBinaryRunResult {
  /** true = 全部注册表均处于完成态（含触发维护链路）。 */
  readonly done: boolean;
  /** 本次调用实际归一的行数（幂等重入的第二遍为 0）。 */
  readonly normalizedCount: number;
}

/** 读该表的 KKV 完成标记（两段式 module/key）。 */
async function readDoneMarker(
  conn: TdbcConnection,
  adapter: BlobTableAdapter
): Promise<boolean> {
  const kkv = new SqliteKkvRepository(conn);
  const entry = await kkv.get(BLOB_BINARY_KKV_MODULE, adapter.doneKey);
  return entry != null;
}

/** 谓词 COUNT（仅未完成的表跑，稳态零成本）。 */
async function countPendingRows(
  conn: TdbcConnection,
  adapter: BlobTableAdapter
): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${adapter.table} WHERE ${PREDICATE}`
  );
  return Number(rows[0]?.n ?? 0);
}

/** 批间让步：setTimeout(0) 交还事件循环（desktop main / RN JS 线程）。 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 采样归一状态（存储页状态行 + 启动零成本短路共用）。
 *
 * 稳态（已完成）只读 KKV 标记一次即返回，零 COUNT 成本；未完成才 COUNT
 * 全表（仅归一期间，百万行量级库毫秒级）。
 */
export async function getBlobBinaryStatus(
  conn: TdbcConnection
): Promise<BlobBinaryStatus> {
  const tables: BlobBinaryTableStatus[] = [];
  for (const adapter of TABLE_ADAPTERS) {
    if (await readDoneMarker(conn, adapter)) {
      tables.push({ table: adapter.tableId, done: true, pendingCount: 0 });
      continue;
    }
    const pendingCount = await countPendingRows(conn, adapter);
    tables.push({
      table: adapter.tableId,
      done: pendingCount === 0,
      pendingCount,
    });
  }
  return { tables };
}

/**
 * 对单表执行一轮谓词驱动的归一。
 *
 * 可重入：任意时刻中断（返回/异常/杀进程）都安全——每行 UPDATE 是独立
 * 短事务且 WHERE 带谓词（并发重复归一时 changes=0），重启后谓词重扫续跑。
 */
async function normalizeTable(
  conn: TdbcConnection,
  adapter: BlobTableAdapter,
  deadline: number,
  shouldPause: (() => boolean) | undefined
): Promise<{ done: boolean; normalizedCount: number }> {
  let normalizedCount = 0;

  for (;;) {
    if (shouldPause?.()) {
      return { done: false, normalizedCount };
    }

    // 每批 ≤100 行：只取主键 + encoding + bytes。WITHOUT ROWID 表按主键
    // 列排序（rowid 不存在，照抄 compaction 的 ORDER BY rowid 会报错）。
    const rows = await conn.query<{
      content_hash: string;
      encoding: string;
      bytes: SqlValue;
    }>(adapter.selectSql);
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      // base64 文本 → 二进制：asBase64Text 兜住「列值是 base64 的 UTF-8
      // 字节」形态（quick-sqlite 存量），解码统一走 blob-bytes-codec 的
      // base64ToBytes，不另起实现。
      const compressed = base64ToBytes(
        asBase64Text(row.bytes, `${adapter.table}.bytes`)
      );
      // 主键列名由适配器给出（本轮两表同为 content_hash），行类型是
      // 字面量声明的，故按记录取值再取字符串。
      const record = row as unknown as Record<string, unknown>;
      const result = await conn.transaction(async (tx) => {
        // 单条短事务 UPDATE：置 bytes + encoding + byte_len（物理字节
        // 长度）。条件带谓词防并发重复归一（changes=0 静默跳过）。
        return await tx.execute(adapter.updateSql, [
          compressed,
          compressed.byteLength,
          String(record[adapter.primaryKeyColumn]),
        ]);
      });
      // 只计实际落库的行走数：谓词命中但 changes=0 说明已被并发端搬走。
      if (result.changes > 0) {
        normalizedCount += 1;
      }
    }

    // 批间让步：预算检查放批粒度（行粒度事务已足够短）。
    if (Date.now() >= deadline) {
      return { done: false, normalizedCount };
    }
    await yieldToEventLoop();
  }

  // 谓词空 → 置该表的 KKV 完成标记（两表各自短路，互不牵连）。
  await new SqliteKkvRepository(conn).set(
    BLOB_BINARY_KKV_MODULE,
    adapter.doneKey,
    new Date().toISOString()
  );
  return { done: true, normalizedCount };
}

/**
 * 执行一轮谓词驱动的存量 blob 形态归一（zlib-b64 文本 → 二进制 BLOB）。
 *
 * 全部注册表都处于完成态时，触发一次维护链路（缓存 GC → checkpoint →
 * VACUUM，事务外直调）归还页空间；维护链路本身带进程级去重
 * （{@link runStartupMaintenanceOnce}），多任务叠加不会多次全库 VACUUM。
 */
export async function runBlobBinaryNormalization(
  conn: TdbcConnection,
  options: RunBlobBinaryNormalizationOptions = {}
): Promise<BlobBinaryRunResult> {
  const budgetMs =
    options.syncBudgetMs ?? DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  let normalizedCount = 0;
  let allDone = true;

  for (const adapter of TABLE_ADAPTERS) {
    // 启动先查标记即走：此后每次启动零成本（spec 拍板）。
    if (await readDoneMarker(conn, adapter)) {
      continue;
    }
    const result = await normalizeTable(
      conn,
      adapter,
      deadline,
      options.shouldPause
    );
    normalizedCount += result.normalizedCount;
    allDone = allDone && result.done;
  }

  if (allDone) {
    // 归一释放的页挂 freelist，VACUUM 归还文件系统。VACUUM 失败不影响
    // 正确性（标记已置，用户手动「数据清理」同样可收缩）。
    await runStartupMaintenanceOnce(conn);
  }
  return { done: allDone, normalizedCount };
}
