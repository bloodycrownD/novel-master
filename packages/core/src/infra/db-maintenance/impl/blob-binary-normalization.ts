/**
 * 存量 blob 行形态归一任务（zlib-b64 base64 文本 → 二进制 BLOB）。
 *
 * 骨架对齐 message-content-decompression 任务（同目录姊妹文件）：谓词
 * 查询 → 每批
 * ≤100 行 → 每行短事务 → 批间 setTimeout(0) 让步 → 单轮同步预算 →
 * 每表 KKV 完成标记 → 完成后挂一次维护链路。不注册 schema migration
 * （无进度语义、空占位登记禁令）。
 *
 * - 谓词（两张 blob 表同形，chat_message 列名不同、形状同构）：
 *   `encoding = 'zlib-b64' OR (encoding = 'zlib' AND TYPEOF(bytes) = 'text')`。
 *   **必须用 TYPEOF 判别而不是只看 encoding**——quick-sqlite 时代遗留
 *   「encoding=zlib 但存的是 base64 文本」的脏形态，只看 encoding 会漏掉
 *   那批行。chat_message 的 legacy 明文行（content_encoding IS NULL）不
 *   命中——那是反向解压任务的谓词范围之外的形态。
 * - 表适配器化：一张表一个 adapter（表名、主键列、blob 列名、谓词、
 *   SELECT/UPDATE SQL、完成标记 key、有无 byte_len 列），由
 *   {@link TABLE_ADAPTERS} 数组驱动；新增表只加一条适配器，不改流程代码。
 *   SELECT 只取主键 + encoding + bytes（搬运源，chat_message 用列别名映射成
 *   同形），不碰其它列。
 * - **keyset 游标分批**：前两张 `WITHOUT ROWID` 表按主键列（`content_hash`）
 *   游标分批；chat_message 为常规表，按主键 `id` 游标。每批从上一批末行
 *   主键之后取，同一行不会被重复 SELECT（见 {@link normalizeTable}）。
 * - 并发幂等：UPDATE 的 WHERE 带同一谓词，另一端/上一轮已归一时
 *   `changes = 0`，静默跳过。
 * - 归一动作：base64 文本 → 二进制 Uint8Array，置 `encoding = 'zlib'`，
 *   blob 两表同时置 `byte_len = ` 物理字节长度（chat_message 无该列）。
 *   存量 `byte_len` 写法三态混杂（base64 文本长度 / 二进制长度 /
 *   二进制长度 −2），故一律重算。
 * - 可重入：中断（杀进程/预算耗尽）随时停，重启后谓词重扫续跑，已归一
 *   行天然排除。完成判定两态同 compaction：进行中（剩余 N 条，谓词
 *   COUNT）/ 已完成（谓词空 → 置 KKV 完成标记）。
 * - **收尾维护触发口径（cr-01/cr-25）**：仅在本轮确有推进（成功改写
 *   ≥1 行）且全部表完成时触发一次收尾维护（缓存 GC → checkpoint →
 *   VACUUM）；稳态零成本；上一轮维护失败会由持久化标记
 *   `startupMaintenancePending` 补跑（见 {@link runBlobBinaryNormalization}）。
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
import { errorText } from "@/common/error-text.js";
import {
  asBase64Text,
  VFS_CONTENT_ENCODING_ZLIB,
} from "@/domain/vfs/content-store/logic/zlib-codec.js";
import { runStartupMaintenanceOnce } from "./db-maintenance.service.js";

/** KKV 完成标记两段式命名（module 为 nm- 短横线、key 为 camelCase，
 * 先例 `nm-message-content` / `nm-compaction-conditions`）。 */
export const BLOB_BINARY_KKV_MODULE = "nm-blob-binary";

/**
 * 收尾维护失败的补跑兜底标记 key（cr-01 方案 A）。
 *
 * @remarks 与三张表的完成标记共用 {@link BLOB_BINARY_KKV_MODULE}、key
 * 各自独立。收尾维护链路（GC/checkpoint/VACUUM）失败时置 `"1"`，下次冷
 * 启动入口读到即无视 `processedAny` 强制补跑一次（仍需 `allDone`）。手动
 * 「数据清理」成功后由 db-maintenance 侧顺带清掉（advisory③ 方案 A，见
 * `db-maintenance.service.ts`），否则标记会陈旧、让下次冷启动多跑一次
 * 全库 VACUUM（纯浪费、无正确性损失）。
 */
const STARTUP_MAINTENANCE_PENDING_KEY = "startupMaintenancePending";

/** 每批归一行数上限（短事务粒度，spec 拍板 ≤100）。 */
const BATCH_SIZE = 100;

/**
 * 零进展护栏阈值：连续多少个**零进展批**（本批 UPDATE 全部 `changes === 0`
 * 且无新增坏行、又不全是本轮已知坏行）即判定异常打转。
 *
 * @remarks 护的是「某端驱动把二进制值绑成 TEXT 存回、UPDATE 后谓词仍命中」
 * 这类真异常——纯烧同步预算。keyset 游标保证不会重复命中同一批行，故零
 * 进展只可能来自这类驱动级形态异常，而不是「同一批被反复 SELECT」。
 *
 * **不要求满批**：卡住行数 < 100 的情形恰恰是最该兜底的那类库，旧口径的
 * 满批条件（`rows.length === BATCH_SIZE`）会让它们永远不触发护栏。
 *
 * **这是提前止损，不是最终判定**：护栏只负责「别把一轮空转拖到 60s 预算
 * 耗尽」，触发后本轮 `done = false` 且不置完成标记；「谓词里是否还有
 * 非坏行残留」的**最终判定权交给循环退出后的收尾谓词校验**（见
 * {@link normalizeTable} 尾部的不变量注释）。阈值取 3 而不是 1：容忍偶发
 * 的并发抢写/写锁抖动，又把无界空转压在 3 批以内。
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
 * @remarks legacy 明文行（content_encoding IS NULL）天然不命中——明文是
 * chat_message 的正形态；反向解压任务命中的是「压缩行」，两任务谓词可交叠
 * （zlib-b64 行同时命中）但收敛顺序无关：任一先跑，另一谓词重扫后收敛。
 */
const MESSAGE_PREDICATE = `(content_encoding = 'zlib-b64' OR (content_encoding = 'zlib' AND TYPEOF(content_blob) = 'text'))`;

/**
 * 归一任务覆盖的表标识（与完成标记 key 一一对应，互不牵连）。
 */
export type BlobBinaryTableId = "vfsContent" | "fileCache" | "messageContent";

/** 一张待归一 blob 表的适配器（表名 / 主键列 / blob 列名 / SQL / 完成标记 key）。 */
interface BlobTableAdapter {
  /** 对外标识（状态查询返回的 `table` 值）。 */
  readonly tableId: BlobBinaryTableId;
  /** 物理表名（错误文案与日志用）。 */
  readonly table: string;
  /** 主键列名（blob 两表为 content_hash，chat_message 为 id）。 */
  readonly primaryKeyColumn: string;
  /** blob 列真名（ic-15：告警文案用真列名，chat_message 是 content_blob）。 */
  readonly bytesColumn: string;
  /** 该表的 KKV 完成标记 key。 */
  readonly doneKey: string;
  /** 该表的归一谓词（SELECT/UPDATE/COUNT 共用，保证三处同一口径）。 */
  readonly predicate: string;
  /** UPDATE 是否带 byte_len 参数（chat_message 无该列）。 */
  readonly hasByteLen: boolean;
  /** 谓词批查询 SQL（只取主键 + encoding + bytes，keyset 游标分批）。 */
  readonly selectSql: string;
  /** 逐行归一 UPDATE SQL（WHERE 带同一谓词保证并发幂等）。 */
  readonly updateSql: string;
}

/**
 * 注册表清单（数组驱动流程）。
 *
 * @remarks 前两张 `WITHOUT ROWID` 表按主键列（`content_hash`）游标分批；
 * `chat_message` 为常规表，按主键 `id` 游标。SELECT 用列别名把 chat_message
 * 的 content_encoding/content_blob 映射成统一的 encoding/bytes 行形状，
 * 流程代码零分叉。
 */
const TABLE_ADAPTERS: readonly BlobTableAdapter[] = [
  {
    tableId: "vfsContent",
    table: "vfs_content_blob",
    primaryKeyColumn: "content_hash",
    bytesColumn: "bytes",
    doneKey: "vfsContentDone",
    predicate: PREDICATE,
    hasByteLen: true,
    selectSql: `SELECT content_hash, encoding, bytes FROM vfs_content_blob
       WHERE ${PREDICATE} AND content_hash > ?
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
    bytesColumn: "bytes",
    doneKey: "fileCacheDone",
    predicate: PREDICATE,
    hasByteLen: true,
    selectSql: `SELECT content_hash, encoding, bytes FROM session_file_cache_blob
       WHERE ${PREDICATE} AND content_hash > ?
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
    bytesColumn: "content_blob",
    doneKey: "messageContentDone",
    predicate: MESSAGE_PREDICATE,
    hasByteLen: false,
    selectSql: `SELECT id, content_encoding AS encoding, content_blob AS bytes FROM chat_message
       WHERE ${MESSAGE_PREDICATE} AND id > ?
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
  /**
   * 收尾维护链路（GC/checkpoint/VACUUM，秒级、desktop 上会冻结 main 事件
   * 循环）即将开始的回调（cr-26：app 层借它只包住真正的维护段——如
   * desktop 置维护 busy——而不是把整轮最长 60s 的归一都包进去）。
   *
   * @remarks 回调异常不得带崩归一任务：内部单独 try/catch、只 warn。
   * 仅在维护段真的被进入时调用（门条件见 {@link runBlobBinaryNormalization}）。
   */
  readonly beforeMaintenance?: () => void;
  /**
   * 收尾维护链路结束的复位回调。
   *
   * @remarks **finally 语义**：VACUUM 抛错也必须被调（app 层据此复位 busy
   * 标志，否则一次维护失败会让 busy 永久挂死）。回调异常同样单独
   * try/catch、只 warn。
   */
  readonly afterMaintenance?: () => void;
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
   * 收尾谓词校验判定谓词内仍有非坏行残留（本轮本进程停手）。
   *
   * @remarks 三种成因：原地打转的 UPDATE 恒 `changes = 0`（驱动把二进制
   * 值绑成 TEXT 存回、更新后谓词仍命中）/ 并发端抢写 / 降级期新写入的
   * legacy 行。无论哪种，处置一致：**本进程停手、下个冷启动按谓词重扫**
   * ——调用方据此停止重试（而不是「零延迟续跑」把空转放大成热循环），
   * 该表也不置完成标记。这是语义扩宽（原语义仅「零进展护栏的打转」一种，
   * 见 {@link ZERO_PROGRESS_BATCH_LIMIT}）：扩宽后的取舍是**本会话不再
   * 推进、下次冷启动重扫，无正确性损失**——已完成改写的行不会回退，只是
   * 节奏变慢。预算耗尽、守卫暂停等普通的 `done = false` 一律为 `false`。
   */
  readonly stalled: boolean;
}

/** 完成标记值（JSON；旧版为纯 ISO 时间戳字符串，解析兜底见 readDoneMarker）。 */
interface BlobBinaryDoneMarker {
  /**
   * 置标记时本表累计跳过的坏行数（需人工关注的行）。
   *
   * @remarks 标记值 JSON 里仍写入 `at`（ISO 时间戳）供人工排查，但解析侧
   * 不保留——全链路无消费（ic-12），留着是纯死数据。
   */
  readonly failedCount: number;
}

/**
 * 读该表的 KKV 完成标记（两段式 module/key）。
 *
 * 标记值向后兼容：旧版是纯 ISO 时间戳字符串（无 failedCount 可言），
 * JSON.parse 失败一律按 `{ failedCount: 0 }` 处理——不抛、不刷屏，
 * 旧库升级后状态行照常显示（failedCount 归零口径与「旧标记时代无此
 * 信号」一致）。标记值损坏（failedCount 为负数/小数等）同样归 0 而不是
 * 原样透传——透传会让 UI 渲染出「已完成（-3 条需人工处理）」这类 nonsense。
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
      // ic-12：非整数 / 负数不透传（UI 第三态文案会直接拼这个数），归 0。
      failedCount:
        typeof parsed.failedCount === "number" &&
        Number.isInteger(parsed.failedCount) &&
        parsed.failedCount >= 0
          ? parsed.failedCount
          : 0,
    };
  } catch {
    // 旧版纯 ISO 字符串标记：无 failedCount 快照，按 0 处理。
    return { failedCount: 0 };
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

/**
 * 状态采样节流窗口（ic-06①）：desktop 存储页 2s 轮询 + 全表 COUNT（谓词
 * 不可索引）×未完成表 = 迁移期 IO 风暴，窗口内重复采样直接回放上次值。
 * 取 3s（略大于 desktop 2s 轮询周期）：相邻两次轮询合并成一次真采样，
 * 进度展示最多滞后一个窗口（mobile 5s 轮询周期大于窗口，每次仍真采样）。
 */
const STATUS_SAMPLING_THROTTLE_MS = 3000;

/**
 * 状态采样缓存（按连接实例隔离，ic-06①）。
 *
 * 取舍：`getBlobBinaryStatus` 三表一轮循环、返回值整体缓存——混合态（部分
 * 表已完成）下已完成表的 KKV 标记读取结果也随窗缓存 3s（该部分本身免
 * COUNT，缓存它只是让「刚置的完成标记」在窗口内不可见，采样只是进度
 * 展示，滞后一个窗口无正确性影响）；per-table 细粒度缓存要把形状复杂化
 * 成 WeakMap<conn, Map<tableId, ...>>，换来的只是这点新鲜度，不值。
 * **只在真触过 COUNT 的采样轮写缓存**：稳态（三表全完成）一轮零 COUNT、
 * 不写缓存——免 COUNT 快路径天然不受节流影响（每次调用仍只读 KKV 标记）。
 */
let statusSamplingThrottleCache = new WeakMap<
  TdbcConnection,
  { at: number; value: BlobBinaryStatus }
>();

/**
 * 测试专用：清空状态采样节流缓存（WeakMap 无清空 API，直接换新实例）。
 *
 * @remarks 共享连接的测试用例之间必须调用，否则前序用例的未完成态采样
 * 会在 3s 窗口内串值到后续用例（生产代码不得调用）。
 */
export function __resetStatusSamplingThrottleForTests(): void {
  statusSamplingThrottleCache = new WeakMap();
}

/**
 * 读「收尾维护待补跑」兜底标记（cr-01 维护失败兜底的入口侧）。
 *
 * @remarks 读失败按「无标记」处理：KKV 读异常不能带崩归一主流程，兜底
 * 退化为「本轮不强制补跑」，无正确性损失。
 */
async function readStartupMaintenancePending(
  conn: TdbcConnection
): Promise<boolean> {
  try {
    const entry = await new SqliteKkvRepository(conn).get(
      BLOB_BINARY_KKV_MODULE,
      STARTUP_MAINTENANCE_PENDING_KEY
    );
    return entry != null;
  } catch (error) {
    console.warn(
      `[blob-binary-normalization] 读 startupMaintenancePending 兜底标记失败，本轮按无标记处理：${errorText(error)}`
    );
    return false;
  }
}

/**
 * 置「收尾维护待补跑」兜底标记（维护链路失败时调用）。
 *
 * @remarks 失败只 warn、不抛（cr-01：KKV 写失败不能让整轮归一任务失败）；
 * 最坏后果是兜底退化为「无补跑」，回到本条修复之前的稳态行为。
 */
async function setStartupMaintenancePending(conn: TdbcConnection): Promise<void> {
  try {
    await new SqliteKkvRepository(conn).set(
      BLOB_BINARY_KKV_MODULE,
      STARTUP_MAINTENANCE_PENDING_KEY,
      "1"
    );
  } catch (error) {
    console.warn(
      `[blob-binary-normalization] 置 startupMaintenancePending 兜底标记失败，放弃本次补跑兜底：${errorText(error)}`
    );
  }
}

/**
 * 清「收尾维护待补跑」兜底标记（补跑成功后调用，条件见 cr-32）。
 *
 * @remarks 失败只 warn、不抛：最坏后果是下次冷启动多跑一次全库维护
 * （纯浪费、无正确性损失）。手动「数据清理」成功后 db-maintenance 侧
 * 也会顺带清这个标记（advisory③ 方案 A）。
 */
async function clearStartupMaintenancePending(
  conn: TdbcConnection
): Promise<void> {
  try {
    await new SqliteKkvRepository(conn).delete(
      BLOB_BINARY_KKV_MODULE,
      STARTUP_MAINTENANCE_PENDING_KEY
    );
  } catch (error) {
    console.warn(
      `[blob-binary-normalization] 清 startupMaintenancePending 兜底标记失败，下次冷启动可能多跑一次维护：${errorText(error)}`
    );
  }
}

/** 批间让步：setTimeout(0) 交还事件循环（desktop main / RN JS 线程）。 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 采样归一状态（存储页状态行 + 启动零成本短路共用）。
 *
 * 稳态（已完成）只读 KKV 标记一次即返回，零 COUNT 成本；未完成才 COUNT
 * 全表（仅归一期间，百万行量级库毫秒级）。触过 COUNT 的采样轮带 3s 节流
 * （ic-06①，见 {@link STATUS_SAMPLING_THROTTLE_MS}）：窗口内重复调用回放
 * 上次采样值——「2s 轮询 + 全表扫 = 迁移期 IO 风暴」。归一本体的完成判定
 * 与收尾谓词校验不走本缓存（`countPendingRows` 直调，正确性不受采样节流
 * 影响）；两端 app 消费侧（desktop 2s 轮询 / mobile 5s 轮询）无需感知：
 * 节流发生在 core 层。
 */
export async function getBlobBinaryStatus(
  conn: TdbcConnection
): Promise<BlobBinaryStatus> {
  const tables: BlobBinaryTableStatus[] = [];
  let counted = false;
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
    // 缓存检查放在「首次遇到标记未置的表」处（对齐 compaction 侧「先读
    // 标记、未置才进节流域」的结构）：三表标记全置的稳态整轮不查不写
    // 缓存——免 COUNT 快路径纯净；命中时丢弃本轮已累积的 tables、返回
    // 缓存里完整的上一轮采样值（同为整轮值，形状完整）。
    const cached = statusSamplingThrottleCache.get(conn);
    if (cached != null && Date.now() - cached.at < STATUS_SAMPLING_THROTTLE_MS) {
      return cached.value;
    }
    const pendingCount = await countPendingRows(conn, adapter);
    counted = true;
    tables.push({
      table: adapter.tableId,
      done: pendingCount === 0,
      pendingCount,
      failedCount: 0,
    });
  }
  const status: BlobBinaryStatus = { tables };
  // 只有真触过 COUNT 的采样轮才写缓存：稳态零 COUNT 路径不进节流域。
  if (counted) {
    statusSamplingThrottleCache.set(conn, { at: Date.now(), value: status });
  }
  return status;
}

/** 单表归一过程的对外返回（行数三态：归一 / 跳过坏行 / 未完成）。 */
interface NormalizeTableResult {
  readonly done: boolean;
  readonly normalizedCount: number;
  readonly failedCount: number;
  /** 收尾谓词校验判定残留 / 零进展护栏收手（见实现尾部不变量注释）。 */
  readonly stalled: boolean;
}

/**
 * 对单表执行一轮 keyset 游标驱动的归一（cr-02/cr-24）。
 *
 * 可重入：任意时刻中断（返回/异常/杀进程）都安全——每行 UPDATE 是独立
 * 短事务且 WHERE 带谓词（并发重复归一时 changes=0），重启后谓词重扫续跑。
 *
 * 坏行策略：base64 解码抛错的行**原样保留、不写库**，计入 `failedCount`；
 * 行仍留在谓词里，由 keyset 游标推过它们继续扫尾部的正常行（旧版「整批
 * 全坏即 break」会把坏行后面的正常行永久跳过、还误置完成标记，正是本条
 * 修复的对象）。`failedKeys` 是必需状态：收尾谓词校验靠它区分「谓词里
 * 只剩已知坏行」（可置标记）与「还有别的行」（stalled 收手）。
 */
async function normalizeTable(
  conn: TdbcConnection,
  adapter: BlobTableAdapter,
  deadline: number,
  shouldPause: (() => boolean) | undefined
): Promise<NormalizeTableResult> {
  let normalizedCount = 0;
  let failedCount = 0;
  /** 本轮已确认解码失败的主键（行原样保留，是收尾谓词校验的基数）。 */
  const failedKeys = new Set<string>();
  /** 连续零进展批计数（护栏用，见 {@link ZERO_PROGRESS_BATCH_LIMIT}）。 */
  let zeroProgressBatches = 0;
  /**
   * keyset 游标（cr-02）：`selectSql` 里留了 `${主键} > ?` 占位，每批从
   * 上一批末行主键之后取，同一行不会被重复 SELECT。
   *
   * 游标初值 `""` 是安全的：三表主键列上都不存在空串行（content_hash 恒为
   * sha256 hex 或测试夹具前缀，chat_message 的 id 恒为非空生成串），故
   * `主键 > ''` 恒真、首批不会漏行——不必怀疑空串游标会漏数据。
   */
  let cursor = "";

  for (;;) {
    if (shouldPause?.()) {
      return { done: false, normalizedCount, failedCount, stalled: false };
    }

    // 每批 ≤100 行：只取主键 + encoding + bytes。前两张 WITHOUT ROWID 表
    // 按主键列 content_hash 游标分批；chat_message 为常规表按主键 id 游标。
    const rows = await conn.query<{
      content_hash: string;
      encoding: string;
      bytes: SqlValue;
    }>(adapter.selectSql, [cursor]);
    if (rows.length === 0) {
      break;
    }

    // 批内统计：落库行数 / 新增坏行数 / 本批是否全是已知坏行。
    let batchChanges = 0;
    let newFailures = 0;
    let allKnownFailed = true;

    for (const row of rows) {
      // 主键列名由适配器给出（blob 两表 content_hash、chat_message 为 id），
      // 行类型是字面量声明的，故按记录取值再取字符串。
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
          // ic-15：label 用 adapter 的 blob 列真名——chat_message 的列是
          // content_blob，写死 .bytes 会产出「列不存在」的误导文案。
          asBase64Text(row.bytes, `${adapter.table}.${adapter.bytesColumn}`)
        );
      } catch (error) {
        failedKeys.add(primaryKey);
        failedCount += 1;
        newFailures += 1;
        console.warn(
          `[blob-binary-normalization] ${adapter.table}.${adapter.bytesColumn} 解码失败（${adapter.table}.${adapter.primaryKeyColumn}=${primaryKey}），跳过归一：${errorText(error)}`
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

    // 批处理完成后**无条件**推进游标：取本批末行主键（cr-02 第 3 步）。
    // 不取决于本批是否推进（坏行/被并发搬走的行同样推过），保证下一批
    // 不会重复命中、终止条件只剩 rows.length === 0。
    const lastRecord = rows[rows.length - 1] as unknown as Record<
      string,
      unknown
    >;
    cursor = String(lastRecord[adapter.primaryKeyColumn]);

    if (batchChanges === 0 && newFailures === 0) {
      if (allKnownFailed) {
        // 整批全是本轮已确认的坏行：游标已推进，continue 扫后面的行。
        //
        // 【正常路径不可达、保留作防御】（cr-35）：keyset 游标已保证不重复
        // 命中同一行，正常路径下几乎不可能再凑齐「整批每行都是本轮已知
        // 坏行」；保留它是防御驱动行为异常时仍不炸栈。不计零进展批——
        // 那不是打转，是坏行被逐批推过。旧版此处是 `break`（坏行满批即
        // 整表收尾、尾部正常行被永久跳过），正是 cr-02 修复的对象。
        continue;
      }
      // 零进展批（提前止损，非最终判定——见 ZERO_PROGRESS_BATCH_LIMIT 的
      // @remarks）：连续 3 批即判定原地打转，本轮主动收手、不置完成标记。
      zeroProgressBatches += 1;
      if (zeroProgressBatches >= ZERO_PROGRESS_BATCH_LIMIT) {
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

  // ── 收尾谓词校验（cr-24，最终判定权）───────────────────────────────
  //
  // 【收尾判据不变量（cr-35，修改循环结构必须同步核对本段）】
  // 收尾校验只在 `rows.length === 0`（游标 `""` 起整表扫完）之后可达；
  // 其余三个出口——预算耗尽、shouldPause 守卫、零进展护栏——都在校验
  // 之前 return。因此谓词里残留的每一行必在本轮被 SELECT 访问过 ⇒
  // **leftover ⊆ failedKeys**，即 `leftover > failedKeys.size` 时一定存在
  // 「不是已知坏行」的残留（成因见 BlobBinaryRunResult.stalled 的三因）。
  //
  // 前提（禁止破坏）：**收尾校验之前不得再引入任何 `break`**。循环内一旦
  // 出现提前 break（旧版 `allKnownFailed → break` 那种形态），leftover 就
  // 可能大于 failedKeys.size 而被误判为「有残留」，或反过来——更糟的是
  // break 之后仍走置标记分支时，坏行后面的正常行会被永久跳过（下次启动
  // 标记短路、不再重扫）。
  const leftover = await countPendingRows(conn, adapter);
  if (leftover > failedKeys.size) {
    console.warn(
      `[blob-binary-normalization] ${adapter.table} 收尾谓词校验发现 ${leftover} 行残留（已知坏行仅 ${failedKeys.size}），存在非坏行残留，本轮停手不置完成标记，待下次冷启动重扫`
    );
    return { done: false, normalizedCount, failedCount, stalled: true };
  }

  // 谓词空（或仅剩本轮已确认的坏行）→ 置该表的 KKV 完成标记（三表各自
  // 短路，互不牵连）。坏行不阻断标记：否则每次启动都要重扫同一批坏行
  // 再抛一遍，任务永远收敛不了。标记值存 JSON（含 failedCount 快照，
  // cr-06：状态行据它显示「已完成（N 条需人工处理）」第三态；at 仅供
  // 人工排查，解析侧不保留，见 readDoneMarker）。
  await new SqliteKkvRepository(conn).set(
    BLOB_BINARY_KKV_MODULE,
    adapter.doneKey,
    JSON.stringify({ at: new Date().toISOString(), failedCount })
  );
  return { done: true, normalizedCount, failedCount, stalled: false };
}

/**
 * 执行一轮 keyset 游标驱动的存量 blob 形态归一（zlib-b64 文本 → 二进制
 * BLOB）。
 *
 * 全部注册表都处于完成态**且本轮确有推进（成功改写 ≥1 行）**时，才触发
 * 一次收尾维护链路（缓存 GC → checkpoint → VACUUM，事务外直调）归还页
 * 空间——只有成功改写过行才会往 freelist 里释放页，稳态（零改写）跑
 * VACUUM 纯属白付代价，故零成本跳过（cr-01/cr-25）。上一轮维护失败会由
 * 持久化标记 `startupMaintenancePending` 兜底：入口读到即无视「本轮是否
 * 有推进」强制补跑一次（仍需 `allDone`——尚未完成的库跑 VACUUM 也没
 * 意义）。维护链路本身带进程级去重（{@link runStartupMaintenanceOnce}），
 * 多任务叠加不会多次全库 VACUUM。
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
  // 「本轮是否真有推进」标记（cr-01）：门条件的唯一信号源。
  let processedAny = false;
  // 入口读维护失败兜底标记：读到则本轮强制走一次维护段（仍需 allDone）。
  const maintenancePending = await readStartupMaintenancePending(conn);

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
    // 门条件**单一来源**：只有成功改写（normalizedCount > 0）才算推进。
    // 刻意**没有** `(result.done && result.failedCount > 0)` 这一支
    // （cr-25 删除，勿补回）：freelist 页只来自成功改写（UPDATE 释放旧
    // 页），「本轮该表只余坏行、零行被改写」的完成态没有释放任何页，
    // 跑 GC/checkpoint/VACUUM 是纯成本（desktop 还要为此冻一次事件
    // 循环）；该路径的收敛性由收尾谓词校验保证，不靠维护链路兜底。
    processedAny = processedAny || result.normalizedCount > 0;
  }

  if (allDone && (processedAny || maintenancePending)) {
    // 归一释放的页挂 freelist，VACUUM 归还文件系统。
    //
    // 必须吞掉异常：VACUUM 在磁盘满 / 库被别处锁住时会抛，而本函数的调用方
    // （CLI 启动链路等）没有 try/catch，裸奔上去会让**每一条 CLI 命令**都
    // 失败；且完成标记已置、进程级去重在新进程复位，等于每条命令都白重跑
    // 一次注定失败的 VACUUM。失败只丢空间回收、不影响正确性：标记已置，
    // 数据也已归一，用户手动「数据清理」同样可收缩。失败时置
    // startupMaintenancePending，下次冷启动补跑（cr-01 兜底）。
    try {
      // cr-26 回调缝：app 层借这两个回调只包住真正的维护段（如 desktop
      // 置/复位维护 busy），回调异常单独吞掉——不得带崩归一任务。
      try {
        options.beforeMaintenance?.();
      } catch (error) {
        console.warn(
          `[blob-binary-normalization] beforeMaintenance 回调抛错，已忽略：${errorText(error)}`
        );
      }
      const result = await runStartupMaintenanceOnce(conn);
      if (result !== null) {
        // 仅在维护**真跑过**（返回非 null）时清兜底标记（cr-32）：
        // runStartupMaintenanceOnce 同进程内已跑过时直接短路返回 null 且
        // 什么都不跑，无条件清会让「标记被清、维护没跑」静默失效。
        await clearStartupMaintenancePending(conn);
      } else {
        // result === null 是「同进程重入」的正常场景（多个启动期任务
        // 叠加），不是异常：保留标记待下次冷启动补跑。
        console.warn(
          "[blob-binary-normalization] 本进程已跑过收尾维护，startupMaintenancePending 保留待下次冷启动"
        );
      }
    } catch (error) {
      console.warn(
        `[blob-binary-normalization] 收尾维护链路（缓存 GC / checkpoint / VACUUM）失败，不影响归一结果：${errorText(error)}`
      );
      await setStartupMaintenancePending(conn);
    } finally {
      // finally 语义（cr-26）：VACUUM 抛错也必须复位（app 层的 busy 标志
      // 挂死比维护失败本身更糟）。
      try {
        options.afterMaintenance?.();
      } catch (error) {
        console.warn(
          `[blob-binary-normalization] afterMaintenance 回调抛错，已忽略：${errorText(error)}`
        );
      }
    }
  }
  return { done: allDone, normalizedCount, failedCount, stalled };
}
