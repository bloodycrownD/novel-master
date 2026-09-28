/**
 * 存量 blob 行形态归一任务（zlib-b64 base64 文本 → 二进制 BLOB）。
 *
 * 骨架对齐 message-content-compaction 任务（该任务在未合并分支上，此处
 * 只做结构对齐、不做符号引用）：谓词查询 → 每批
 * ≤100 行 → 每行短事务 → 批间 setTimeout(0) 让步 → 单轮同步预算 →
 * 每表 KKV 完成标记 → 完成后挂一次维护链路。不注册 schema migration
 * （无进度语义、空占位登记禁令）。
 *
 * - 谓词（两张 blob 表同形，chat_message 列名不同、形状同构）：
 *   `encoding = 'zlib-b64' OR (encoding = 'zlib' AND TYPEOF(bytes) = 'text')`。
 *   **必须用 TYPEOF 判别而不是只看 encoding**——quick-sqlite 时代遗留
 *   「encoding=zlib 但存的是 base64 文本」的脏形态，只看 encoding 会漏掉
 *   那批行。chat_message 的 legacy 明文行（content_encoding IS NULL）不
 *   命中——那是 message-content-compaction 任务的谓词范围。
 * - 表适配器化：一张表一个 adapter（表名、主键列、谓词、SELECT/UPDATE
 *   SQL、完成标记 key、有无 byte_len 列），由 {@link TABLE_ADAPTERS} 数组
 *   驱动；新增表只加一条适配器，不改流程代码。SELECT 只取主键 +
 *   encoding + bytes（搬运源，chat_message 用列别名映射成同形），不碰
 *   其它列。
 * - **不按 rowid 排序**：blob 两表是 `WITHOUT ROWID`（rowid 不存在），
 *   chat_message 是常规表——统一按主键列排序 + LIMIT 分批。
 * - 并发幂等：UPDATE 的 WHERE 带同一谓词，另一端/上一轮已归一时
 *   `changes = 0`，静默跳过。
 * - 归一动作：base64 文本 → 二进制 Uint8Array，置 `encoding = 'zlib'`，
 *   blob 两表同时置 `byte_len = ` 物理字节长度（chat_message 无该列）。
 *   存量 `byte_len` 写法三态混杂（base64 文本长度 / 二进制长度 /
 *   二进制长度 −2），故一律重算。
 * - 可重入：中断（杀进程/预算耗尽）随时停，重启后谓词重扫续跑，已归一
 *   行天然排除。完成判定两态同 compaction：进行中（剩余 N 条，谓词
 *   COUNT）/ 已完成（谓词空 → 置 KKV 完成标记）。
 * - 无 schema 变更：三表 encoding/CHECK 值域已含 `'zlib'`，读路径
 *   `decodeCompressedBytes` 三形态兼容是既有契约，存量行不转换也能读。
 * - **坏行不阻断收敛**：单行 base64 解码失败只跳过该行（行原样保留、
 *   不写库），其余行照常归一；本表仍照常置 KKV 完成标记，否则每次启动
 *   都会重扫同一批坏行、任务永远收敛不了。跳过的行数记入
 *   {@link BlobBinaryRunResult.failedCount}，> 0 表示该表存在需人工关注
 *   的行（读路径对同类坏行是自愈的，会当 miss 处理）。
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

/**
 * 零进展护栏阈值：连续多少个**零进展批**（本批 UPDATE 全部 `changes === 0`
 * 且无新增坏行、又不全是本轮已知坏行）即判定异常打转。
 *
 * @remarks 护的是「某端驱动把二进制值绑成 TEXT 存回、谓词反复命中同一批
 * 行」这类行原地打转的死循环——纯烧同步预算。
 *
 * **不要求满批**：谓词是每轮实时重扫的，被并发端搬走的行下一轮不会再出现，
 * 所以「同一批行反复被 SELECT 出来、UPDATE 却全 0」在**任何批大小**下都
 * 是可靠的异常信号。旧口径的满批条件（`rows.length === BATCH_SIZE`）会让
 * 「卡住行数 < 100」的情形永远不触发护栏，恰好漏掉最该兜底的那类库。
 *
 * 阈值仍取 3 而不是 1：容忍偶发的并发抢写/写锁抖动，又把无界空转压在
 * 3 批以内。
 */
const ZERO_PROGRESS_BATCH_LIMIT = 3;

/** 升级首启同步收尾预算默认值（超预算残余转后台，spec 拍板 ≤60s）。 */
export const DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS = 60_000;

/**
 * 归一谓词（两张 blob 表同形，逐字复用进 SELECT 的 WHERE 与 UPDATE 的 WHERE）。
 *
 * @remarks `TYPEOF(bytes) = 'text'` 覆盖「encoding='zlib' 但列里存的是
 * base64 文本」的历史脏形态；只看 encoding 会漏掉这批行。
 */
const PREDICATE = `(encoding = 'zlib-b64' OR (encoding = 'zlib' AND TYPEOF(bytes) = 'text'))`;

/**
 * chat_message 侧同形谓词（列名不同：content_encoding / content_blob）。
 *
 * @remarks legacy 明文行（content_encoding IS NULL）天然不命中——那是
 * message-content-compaction 任务的谓词范围，两任务互不越界。
 */
const MESSAGE_PREDICATE = `(content_encoding = 'zlib-b64' OR (content_encoding = 'zlib' AND TYPEOF(content_blob) = 'text'))`;

/**
 * 归一任务覆盖的表标识（与完成标记 key 一一对应，互不牵连）。
 */
export type BlobBinaryTableId = "vfsContent" | "fileCache" | "messageContent";

/** 一张待归一 blob 表的适配器（表名 / 主键列 / SQL / 完成标记 key）。 */
interface BlobTableAdapter {
  /** 对外标识（状态查询返回的 `table` 值）。 */
  readonly tableId: BlobBinaryTableId;
  /** 物理表名（错误文案与日志用）。 */
  readonly table: string;
  /** 主键列名（blob 两表为 content_hash，chat_message 为 id）。 */
  readonly primaryKeyColumn: string;
  /** 该表的 KKV 完成标记 key。 */
  readonly doneKey: string;
  /** 该表的归一谓词（SELECT/UPDATE/COUNT 共用，保证三处同一口径）。 */
  readonly predicate: string;
  /** UPDATE 是否带 byte_len 参数（chat_message 无该列）。 */
  readonly hasByteLen: boolean;
  /** 谓词批查询 SQL（只取主键 + encoding + bytes，按主键排序分批）。 */
  readonly selectSql: string;
  /** 逐行归一 UPDATE SQL（WHERE 带同一谓词保证并发幂等）。 */
  readonly updateSql: string;
}

/**
 * 注册表清单（数组驱动流程）。
 *
 * @remarks 前两张为 `WITHOUT ROWID`，chat_message 为常规表——统一按主键列
 * 排序分批（rowid 对前两张不存在，对第三张无必要），SELECT 用列别名把
 * chat_message 的 content_encoding/content_blob 映射成统一的
 * encoding/bytes 行形状，流程代码零分叉。
 */
const TABLE_ADAPTERS: readonly BlobTableAdapter[] = [
  {
    tableId: "vfsContent",
    table: "vfs_content_blob",
    primaryKeyColumn: "content_hash",
    doneKey: "vfsContentDone",
    predicate: PREDICATE,
    hasByteLen: true,
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
    predicate: PREDICATE,
    hasByteLen: true,
    selectSql: `SELECT content_hash, encoding, bytes FROM session_file_cache_blob
       WHERE ${PREDICATE}
       ORDER BY content_hash
       LIMIT ${BATCH_SIZE}`,
    updateSql: `UPDATE session_file_cache_blob
       SET bytes = ?, encoding = '${VFS_CONTENT_ENCODING_ZLIB}', byte_len = ?
       WHERE content_hash = ? AND ${PREDICATE}`,
  },
  {
    tableId: "messageContent",
    table: "chat_message",
    primaryKeyColumn: "id",
    doneKey: "messageContentDone",
    predicate: MESSAGE_PREDICATE,
    hasByteLen: false,
    selectSql: `SELECT id, content_encoding AS encoding, content_blob AS bytes FROM chat_message
       WHERE ${MESSAGE_PREDICATE}
       ORDER BY id
       LIMIT ${BATCH_SIZE}`,
    updateSql: `UPDATE chat_message
       SET content_blob = ?, content_encoding = '${VFS_CONTENT_ENCODING_ZLIB}'
       WHERE id = ? AND ${MESSAGE_PREDICATE}`,
  },
];

/** 单表归一状态（状态查询一行）。 */
export interface BlobBinaryTableStatus {
  /** 表标识。 */
  readonly table: BlobBinaryTableId;
  /** 已完成：KKV 标记已置，或谓词空（数据上已全归一，等价完成）。 */
  readonly done: boolean;
  /** 未归一行计数（进行中态的「剩余 N 条」，已完成恒为 0）。 */
  readonly pendingCount: number;
  /**
   * 完成时被跳过的坏行数（解码失败、原样保留需人工关注）。
   *
   * @remarks 来自完成标记里的快照（置标记时记录）；`done = false` 时恒 0。
   * 读路径对同类坏行按 miss 自愈，> 0 只表示该表存在需人工关注的行。
   */
  readonly failedCount: number;
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
   * 批间守卫，按端取用组合（mobile 当前仅 agent 活跃；desktop 另有云同步 /
   * 维护 busy）。返回 true 时本轮暂停并立即返回 done=false。
   */
  readonly shouldPause?: () => boolean;
}

/** {@link runBlobBinaryNormalization} 结果。 */
export interface BlobBinaryRunResult {
  /** true = 全部注册表均处于完成态（含触发维护链路）。 */
  readonly done: boolean;
  /** 本次调用实际归一的行数（幂等重入的第二遍为 0）。 */
  readonly normalizedCount: number;
  /**
   * 本次调用解码失败被跳过的行数。
   *
   * @remarks 失败的行**原样保留、不写库**（base64 非法 → 无从归一），
   * 既不阻断同表其余行的收敛，该表也仍照常置 KKV 完成标记。> 0 表示该表
   * 存在需人工关注的行：数据本身已损坏，读路径对同类行按 miss 自愈处理。
   */
  readonly failedCount: number;
  /**
   * 本轮是否被**零进展护栏**主动收手（见 {@link ZERO_PROGRESS_BATCH_LIMIT}）。
   *
   * @remarks `true` 仅表示「谓词反复命中同一批行、UPDATE 恒 `changes = 0`」
   * 这一种异常：此时该表未置完成标记、整轮 `done = false`，但**继续立即
   * 重跑也不会有任何进展**，故调用方应本进程停止重试（下个冷启动再试），
   * 而不是「零延迟续跑」把空转放大成热循环。预算耗尽、守卫暂停等普通的
   * `done = false` 一律为 `false`。
   */
  readonly stalled: boolean;
}

/** 完成标记值（JSON；旧版为纯 ISO 时间戳字符串，解析兜底见 readDoneMarker）。 */
interface BlobBinaryDoneMarker {
  /** 置标记时间。 */
  readonly at: string;
  /** 置标记时本表累计跳过的坏行数（需人工关注的行）。 */
  readonly failedCount: number;
}

/**
 * 读该表的 KKV 完成标记（两段式 module/key）。
 *
 * 标记值向后兼容：旧版是纯 ISO 时间戳字符串（无 failedCount 可言），
 * JSON.parse 失败一律按 `{ failedCount: 0 }` 处理——不抛、不刷屏，
 * 旧库升级后状态行照常显示（failedCount 归零口径与「旧标记时代无此
 * 信号」一致）。
 */
async function readDoneMarker(
  conn: TdbcConnection,
  adapter: BlobTableAdapter
): Promise<BlobBinaryDoneMarker | null> {
  const kkv = new SqliteKkvRepository(conn);
  const entry = await kkv.get(BLOB_BINARY_KKV_MODULE, adapter.doneKey);
  if (entry == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(entry.value) as Partial<BlobBinaryDoneMarker>;
    return {
      at: typeof parsed.at === "string" ? parsed.at : entry.value,
      failedCount:
        typeof parsed.failedCount === "number" &&
        Number.isFinite(parsed.failedCount)
          ? parsed.failedCount
          : 0,
    };
  } catch {
    // 旧版纯 ISO 字符串标记：无 failedCount 快照，按 0 处理。
    return { at: entry.value, failedCount: 0 };
  }
}

/** 谓词 COUNT（仅未完成的表跑，稳态零成本）。 */
async function countPendingRows(
  conn: TdbcConnection,
  adapter: BlobTableAdapter
): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${adapter.table} WHERE ${adapter.predicate}`
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
    const marker = await readDoneMarker(conn, adapter);
    if (marker != null) {
      tables.push({
        table: adapter.tableId,
        done: true,
        pendingCount: 0,
        failedCount: marker.failedCount,
      });
      continue;
    }
    const pendingCount = await countPendingRows(conn, adapter);
    tables.push({
      table: adapter.tableId,
      done: pendingCount === 0,
      pendingCount,
      failedCount: 0,
    });
  }
  return { tables };
}

/** 单表归一过程的对外返回（行数三态：归一 / 跳过坏行 / 未完成）。 */
interface NormalizeTableResult {
  readonly done: boolean;
  readonly normalizedCount: number;
  readonly failedCount: number;
  /** 是否被零进展护栏收手（见 {@link ZERO_PROGRESS_BATCH_LIMIT}）。 */
  readonly stalled: boolean;
}

/**
 * 对单表执行一轮谓词驱动的归一。
 *
 * 可重入：任意时刻中断（返回/异常/杀进程）都安全——每行 UPDATE 是独立
 * 短事务且 WHERE 带谓词（并发重复归一时 changes=0），重启后谓词重扫续跑。
 *
 * 坏行策略：base64 解码抛错的行**原样保留、不写库**，计入 `failedCount`；
 * 行仍留在谓词里，故用 `failedKeys` 记住本轮已确认失败的行——当某一批
 * 命中的全是这类行时收尾（再 SELECT 必然重复命中同一批），让其余行先
 * 收敛掉。
 */
async function normalizeTable(
  conn: TdbcConnection,
  adapter: BlobTableAdapter,
  deadline: number,
  shouldPause: (() => boolean) | undefined
): Promise<NormalizeTableResult> {
  let normalizedCount = 0;
  let failedCount = 0;
  /** 本轮已确认解码失败的主键（行原样保留，会被后续 SELECT 反复命中）。 */
  const failedKeys = new Set<string>();
  /** 连续零进展批计数（护栏用，见 {@link ZERO_PROGRESS_BATCH_LIMIT}）。 */
  let zeroProgressBatches = 0;

  for (;;) {
    if (shouldPause?.()) {
      return { done: false, normalizedCount, failedCount, stalled: false };
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

    // 批内统计：落库行数 / 新增坏行数 / 本批是否全是已知坏行。
    let batchChanges = 0;
    let newFailures = 0;
    let allKnownFailed = true;

    for (const row of rows) {
      // 主键列名由适配器给出（本轮两表同为 content_hash），行类型是
      // 字面量声明的，故按记录取值再取字符串。
      const record = row as unknown as Record<string, unknown>;
      const primaryKey = String(record[adapter.primaryKeyColumn]);
      if (failedKeys.has(primaryKey)) {
        // 本轮已判定失败：行还在谓词里，跳过以免同一批被反复解码。
        continue;
      }

      // base64 文本 → 二进制：asBase64Text 兜住「列值是 base64 的 UTF-8
      // 字节」形态（quick-sqlite 存量），解码统一走 blob-bytes-codec 的
      // base64ToBytes，不另起实现。解码失败只跳过本行——抛出去会让整轮
      // 中断、坏行永远留在谓词里，完成标记永远置不上、每次启动白烧
      // 60s 预算（读路径对同类坏行是自愈的，两侧口径必须一致）。
      let compressed: Uint8Array;
      try {
        compressed = base64ToBytes(
          asBase64Text(row.bytes, `${adapter.table}.bytes`)
        );
      } catch (error) {
        failedKeys.add(primaryKey);
        failedCount += 1;
        newFailures += 1;
        console.warn(
          `[blob-binary-normalization] ${adapter.table}.${adapter.primaryKeyColumn}=${primaryKey} 解码失败，跳过归一：${
            error instanceof Error ? error.message : String(error)
          }`
        );
        continue;
      }
      allKnownFailed = false;

      const result = await conn.transaction(async (tx) => {
        // 单条短事务 UPDATE：置 bytes + encoding（blob 两表另有 byte_len =
        // 物理字节长度；chat_message 无该列，两个占位）。条件带谓词防并发
        // 重复归一（changes=0 静默跳过）。
        const params: SqlValue[] = adapter.hasByteLen
          ? [compressed, compressed.byteLength, primaryKey]
          : [compressed, primaryKey];
        return await tx.execute(adapter.updateSql, params);
      });
      // 只计实际落库的行走数：谓词命中但 changes=0 说明已被并发端搬走。
      if (result.changes > 0) {
        normalizedCount += 1;
        batchChanges += 1;
      }
    }

    if (batchChanges === 0 && newFailures === 0) {
      if (allKnownFailed) {
        // 批内全是本轮已确认的坏行：谓词非空但已无可推进的行走，收尾
        // 收标记（下面的置标记分支照常执行），避免对同一批坏行空转。
        break;
      }
      // 零进展批：谓词实时重扫，上一批被并发端搬走的行本轮不会再出现，
      // 所以「同一批行反复被 SELECT 出来、UPDATE 却全 0」在任何批大小
      // 下都是异常信号——不设满批条件（不满批的卡住行数 <100 才是旧口径
      // 漏掉、且最该兜底的那类）。连续 3 批即判定原地打转。
      zeroProgressBatches += 1;
      if (zeroProgressBatches >= ZERO_PROGRESS_BATCH_LIMIT) {
        // 继续只是白烧同步预算：告警后本轮主动收手、**不置完成标记**，
        // 并把 stalled 透给 app 层，让它本进程停止重试（否则 app 的
        // 「零延迟续跑」会把空转放大成无界热循环）。下个冷启动再试。
        console.warn(
          `[blob-binary-normalization] ${adapter.table} 连续 ${ZERO_PROGRESS_BATCH_LIMIT} 批归一零进展，疑似谓词原地打转，本轮中止`
        );
        return { done: false, normalizedCount, failedCount, stalled: true };
      }
    } else {
      zeroProgressBatches = 0;
    }

    // 批间让步：预算检查放批粒度（行粒度事务已足够短）。
    if (Date.now() >= deadline) {
      return { done: false, normalizedCount, failedCount, stalled: false };
    }
    await yieldToEventLoop();
  }

  // 谓词空（或仅剩解码失败的坏行）→ 置该表的 KKV 完成标记（两表各自
  // 短路，互不牵连）。坏行不阻断标记：否则每次启动都要重扫同一批坏行
  // 再抛一遍，任务永远收敛不了。标记值存 JSON（含 failedCount 快照，
  // cr-06：状态行据它显示「已完成（N 条需人工处理）」第三态）。
  await new SqliteKkvRepository(conn).set(
    BLOB_BINARY_KKV_MODULE,
    adapter.doneKey,
    JSON.stringify({ at: new Date().toISOString(), failedCount })
  );
  return { done: true, normalizedCount, failedCount, stalled: false };
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
  let failedCount = 0;
  let allDone = true;
  let stalled = false;

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
    failedCount += result.failedCount;
    allDone = allDone && result.done;
    stalled = stalled || result.stalled;
  }

  if (allDone) {
    // 归一释放的页挂 freelist，VACUUM 归还文件系统。
    //
    // 必须吞掉异常：VACUUM 在磁盘满 / 库被别处锁住时会抛，而本函数的调用方
    // （CLI 启动链路等）没有 try/catch，裸奔上去会让**每一条 CLI 命令**都
    // 失败；且完成标记已置、进程级去重在新进程复位，等于每条命令都白重跑
    // 一次注定失败的 VACUUM。失败只丢空间回收、不影响正确性：标记已置，
    // 数据也已归一，用户手动「数据清理」同样可收缩。
    try {
      await runStartupMaintenanceOnce(conn);
    } catch (error) {
      console.warn(
        `[blob-binary-normalization] 收尾维护链路（缓存 GC / checkpoint / VACUUM）失败，不影响归一结果：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return { done: allDone, normalizedCount, failedCount, stalled };
}
