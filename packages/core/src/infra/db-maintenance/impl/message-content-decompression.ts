/**
 * 消息正文解压搬运任务（message-plaintext 迁移层，反向任务）。
 *
 * 背景：v1.5.25 起的消息正文压缩迭代被认定为复杂度与性能双输，本迭代
 * 改回「全库明文」——写侧直写 `content_json` 明文（`content_encoding` /
 * `content_blob` 恒 NULL），本任务把**存量压缩行**逐行解压回明文。
 *
 * 骨架与正向压缩任务 `message-content-compaction.ts` 同款（keyset 游标 +
 * 批 ≤100 + 单行短事务 + 谓词进 UPDATE WHERE + 零进展护栏 3 批 + 同步预算
 * 60s + shouldPause + 批间让步 + 3s WeakMap 按连接节流的状态采样），方向反转：
 *
 * - 谓词：`content_blob IS NOT NULL`（COUNT / 批查询 / UPDATE WHERE 三处
 *   **同条件**，幂等可续跑：已搬走的行天然退出谓词，重启后重扫即续跑）。
 * - 行级动作：`decodeMessageContent(encoding, blob, id)` 解压 →
 *   `UPDATE ... SET content_json = 明文, content_encoding = NULL,
 *    content_blob = NULL WHERE id = ? AND content_blob IS NOT NULL`。
 * - 批查询带 keyset 游标（`rowid > ?` 单调推进）：游标只用于**本轮加速**，
 *   完成判定仍以谓词 COUNT 为准（口径照搬正向任务：游标不承担正确性）。
 * - **坏行隔离**：decode 抛错只跳本行——行保持压缩形态、计入
 *   `failedCount`、不阻断完成标记。否则一行坏数据就让整轮永不收敛、每次
 *   启动白烧预算。读路径对压缩行本就双形态自愈（读到的是旧压缩内容，
 *   语义正确：该行从未被成功改写）。
 * - **入口自愈（防标记闩锁）**：完成标记已置位时先跑一次
 *   `SELECT 1 ... WHERE content_blob IS NOT NULL LIMIT 1`，命中（整库快照
 *   回灌等场景让标记与数据形态脱节）即清标记继续搬。标记随整库快照 travels
 *   且写死不校验时，pull 回灌的旧快照会让本库永久停在压缩态、用户拿不到
 *   本迭代的核心收益；一次索引级探测永久消除整类问题。
 * - **旧 pending 消费**：入口先读正向任务遗留的
 *   `nm-message-content/startupMaintenancePending`，置位则补跑一次
 *   `runStartupMaintenanceOnce`（**去重版**，勿用手动
 *   `runDatabaseMaintenance`——后者不受进程级去重约束、会与 blob 归一任务
 *   叠加出双 VACUUM），返回值非 null 才清 pending。正向文件 Step 3 整文件
 *   删除后，这段逻辑活在 `db-maintenance.service.ts`（两代任务共用）。
 * - **收尾不变量（承重约束）**：`leftover > failedKeys.size → stalled = true
 *   + 不置标记`（与正向任务逐字对齐的口径）。驱动静默写回不生效时游标会
 *   扫完但谓词仍有行、failedKeys 为空；没有这道校验任务会谎报完成并把残留
 *   行**永久锁死在压缩态**。**收尾前不得引入任何「看着扫完了」的提前
 *   退出**——护栏/预算/守卫的提前 return 是显式失败路径（不置标记），
 *   不在此列。
 *
 * **不挂收尾维护链路（VACUUM / checkpoint）**——与正向任务的语义差异，
 * 别照抄：正向是**释放**（压缩释放的页挂 freelist，VACUUM 能归还文件系统，
 * 有实打实的空间收益）；本任务是**增容**（明文比压缩大 2-3×，库里没有
 * 任何可归还的 freelist 页），VACUUM 只会全库重写、白烧一次同步阻塞。
 * 本文件里唯一与维护链路相关的动作是上面的「旧 pending 欠账清偿」。
 *
 * 升级首启有界同步收尾预算（默认 60s）：调用方传
 * {@link RunMessageContentDecompressOptions.syncBudgetMs}，超预算残余由
 * 调用方转后台续跑（再次调用本任务）。
 *
 * 并发安全：app 层组合守卫（按端取用，见各端调度接线）+ 驱动连接级互斥
 * （tdbc）；本任务不感知具体守卫。
 *
 * @module infra/db-maintenance/impl/message-content-decompression
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SqlValue } from "@/infra/tdbc/types.js";
import { SqliteKkvRepository } from "@/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import { decodeMessageContent } from "@/domain/chat/logic/message-content-codec.js";
import { runPendingStartupMaintenance } from "./db-maintenance.service.js";

/** 本任务的日志标签（告警溯源前缀）。 */
const LOG_TAG = "message-content-decompress";

/**
 * KKV 完成标记两段式命名。
 *
 * **不复用正向任务的 `nm-message-content` module**（两代语义不同：
 * `compactionDone` = 「已全部压成压缩形态」，`decompressDone` = 「已全部
 * 解回明文」）。混用会让两代标记互相冒充——旧库带着 compactionDone 升级
 * 时若被当成本任务的完成标记，那个库的数据形态与标记就对不上了。
 */
export const MESSAGE_DECOMPRESS_KKV_MODULE = "nm-message-decompress";
export const MESSAGE_DECOMPRESS_KKV_KEY = "decompressDone";

/**
 * 旧 pending 标记（正向压缩任务遗留）：module `nm-message-content` +
 * key `startupMaintenancePending`。
 *
 * @remarks 以**字面量**而非从 message-content-compaction.ts import 常量：
 * 那份常量随正向文件在 Step 3 整文件删除，本任务是它的消费方兼延续。
 * 旧 `compactionDone` 标记行不清理（无害孤儿，spec 已登记为已知取舍）。
 */
export const LEGACY_MESSAGE_CONTENT_KKV_MODULE = "nm-message-content";
export const LEGACY_MAINTENANCE_PENDING_KKV_KEY =
  "startupMaintenancePending";

/** 每批搬运行数上限（短事务粒度，spec 拍板 ≤100）。 */
const BATCH_SIZE = 100;

/**
 * 零进展护栏阈值：连续多少个**零进展批**（本批 UPDATE 全部 `changes === 0`
 * 且无新增坏行）即判定异常打转。
 *
 * @remarks 口径照搬正向任务：游标版每批扫的都是新行，「同一批行 UPDATE
 * 却全 0」在任何批大小下都是可靠的异常信号；不设满批条件（卡住行数 < 100
 * 恰恰是满批条件漏掉、且最该兜底的那类）。阈值 3 容忍偶发写锁抖动。
 */
const ZERO_PROGRESS_BATCH_LIMIT = 3;

/** 升级首启同步收尾预算默认值（超预算残余转后台，spec 拍板 ≤60s）。 */
export const DEFAULT_DECOMPRESS_SYNC_BUDGET_MS = 60_000;

/**
 * 状态采样节流窗口（同正向任务 ic-06①）：双端存储页轮询 + 全表 COUNT
 * （谓词不可索引）= 迁移期 IO 风暴，窗口内重复采样回放上次值。取 3s。
 */
const STATUS_SAMPLING_THROTTLE_MS = 3000;

/** 搬运状态（双端存储页状态行数据源）。 */
export interface MessageDecompressStatus {
  /** 已完成：KKV 标记已置且入口自愈探测未命中剩余压缩行。 */
  readonly done: boolean;
  /** 剩余压缩行计数（进行中态的「剩余 N 条」）。 */
  readonly pendingCount: number;
}

/** {@link runMessageContentDecompress} 入参。 */
export interface RunMessageContentDecompressOptions {
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
  /**
   * 进入维护段前的回调（app 层置 busy 信号用）。
   *
   * @remarks 本任务自身不跑维护链路；该回调只在**消费旧 pending 欠账**
   * （补跑一次维护）时触发。回调抛错由 core 吞掉只 warn。
   */
  readonly beforeMaintenance?: () => void;
  /**
   * 旧 pending 补跑结束后的回调（finally 语义复位 busy 信号用）。
   */
  readonly afterMaintenance?: () => void;
}

/** {@link runMessageContentDecompress} 结果。 */
export interface MessageDecompressRunResult {
  /** true = 谓词已空（或仅剩坏行）且完成标记已置。 */
  readonly done: boolean;
  /** 本次调用实际搬走的行数（只计 UPDATE `changes > 0` 的落库行）。 */
  readonly decompressedCount: number;
  /**
   * 本次调用解码失败被跳过的行数（坏行隔离）。
   *
   * @remarks 失败的行**原样保留压缩形态、不写库**，既不阻断其余行的收敛，
   * 也不阻断完成标记的置位（否则坏行永远留在谓词里、每次启动白烧预算）。
   * > 0 表示存在需人工关注的行：读路径对压缩行是双形态自愈的。
   */
  readonly failedCount: number;
  /**
   * 本轮是否被零进展护栏或收尾谓词校验主动拦停。
   *
   * @remarks `true` 仅表示「继续立即重跑也不会有任何进展」的异常态：此时
   * 完成标记未置、`done = false`，调用方应本进程停止重试（下个冷启动再
   * 试），而不是零延迟续跑把空转放大成热循环。预算耗尽、守卫暂停等普通
   * `done = false` 一律为 `false`。
   */
  readonly stalled: boolean;
}

/** 完成标记值（JSON）。 */
interface MessageDecompressDoneMarker {
  /** 置标记时间。 */
  readonly at: string;
  /** 置标记时累计跳过的坏行数（需人工关注的行）。 */
  readonly failedCount: number;
}

/** 谓词 COUNT（与批查询、UPDATE WHERE 同条件）。 */
async function countPendingRows(conn: TdbcConnection): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chat_message WHERE content_blob IS NOT NULL"
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * 未完成态采样缓存（按连接实例隔离）——只缓存「标记未置、真跑了谓词
 * COUNT」的采样值；标记已置的快路径在缓存检查**之前**就返回（见
 * {@link getMessageDecompressStatus}）。
 */
let statusSamplingThrottleCache = new WeakMap<
  TdbcConnection,
  { at: number; value: MessageDecompressStatus }
>();

/**
 * 测试专用：清空状态采样节流缓存（WeakMap 无清空 API，直接换新实例）。
 *
 * @remarks 共享连接的测试用例之间必须调用（生产代码不得调用）。
 */
export function __resetStatusSamplingThrottleForTests(): void {
  statusSamplingThrottleCache = new WeakMap();
}

/**
 * 读 KKV 完成标记（两段式 module/key）。
 *
 * 标记值向后兼容：非 JSON / 旧版纯 ISO 时间戳字符串一律按
 * `{ failedCount: 0 }` 处理——不抛、不刷屏（口径照搬正向任务）。
 */
async function readDoneMarker(
  conn: TdbcConnection
): Promise<MessageDecompressDoneMarker | null> {
  const kkv = new SqliteKkvRepository(conn);
  const entry = await kkv.get(
    MESSAGE_DECOMPRESS_KKV_MODULE,
    MESSAGE_DECOMPRESS_KKV_KEY
  );
  if (entry == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(entry.value) as Partial<MessageDecompressDoneMarker>;
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

/**
 * 入口自愈探测：库里还有没有压缩行。
 *
 * @remarks 单独成函数而不是复用 `countPendingRows`：这是**每次启动都要
 * 付的固定成本**，必须是索引级的 `LIMIT 1` 存在性查询（谓词列无索引，
 * COUNT 会全表扫），量级与零成本短路同档。
 */
async function hasPendingRows(conn: TdbcConnection): Promise<boolean> {
  const rows = await conn.query<{ present: number }>(
    "SELECT 1 AS present FROM chat_message WHERE content_blob IS NOT NULL LIMIT 1"
  );
  return rows.length > 0;
}

/**
 * 采样搬运状态（双端存储页两态状态行 + 启动零成本短路共用）。
 *
 * 稳态（已完成）只读 KKV 标记一次即返回，零 COUNT 成本；未完成才 COUNT
 * 全表（仅迁移期）。未完成态的 COUNT 带 3s 节流（见
 * {@link STATUS_SAMPLING_THROTTLE_MS}）——采样只是进度展示，滞后一个窗口
 * 无正确性影响（搬运与完成判定都不走本缓存）。
 *
 * @remarks 标记已置位的快路径**不做**入口自愈探测（{@link hasPendingRows}）：
 * 采样是高频轮询的展示面，把每次轮询都变成一次库查询不划算；标记与数据
 * 脱节的态由搬运入口（低频、每次启动几轮）在真搬时立刻自愈修正，本函数
 * 最多在下一个轮询窗口前显示一次「已完成」的假态。
 */
export async function getMessageDecompressStatus(
  conn: TdbcConnection
): Promise<MessageDecompressStatus> {
  if (await readDoneMarker(conn)) {
    return { done: true, pendingCount: 0 };
  }
  const cached = statusSamplingThrottleCache.get(conn);
  if (cached != null && Date.now() - cached.at < STATUS_SAMPLING_THROTTLE_MS) {
    return cached.value;
  }
  const pendingCount = await countPendingRows(conn);
  const status: MessageDecompressStatus = {
    done: pendingCount === 0,
    pendingCount,
  };
  statusSamplingThrottleCache.set(conn, { at: Date.now(), value: status });
  return status;
}

/** 批间让步：setTimeout(0) 交还事件循环（desktop main / RN JS 线程）。 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 执行一轮谓词驱动的消息正文解压搬运。
 *
 * 可重入：任意时刻中断（返回/异常/杀进程）都安全——每行 UPDATE 是独立短
 * 事务且带 `AND content_blob IS NOT NULL` 条件（并发重复搬运时 changes=0
 * 自然跳过），重启后谓词重扫续跑。
 */
export async function runMessageContentDecompress(
  conn: TdbcConnection,
  options: RunMessageContentDecompressOptions = {}
): Promise<MessageDecompressRunResult> {
  // 旧 pending 欠账清偿放在最前：完成标记短路的稳态路径也要消费（历史库
  // 的页空间欠账与本轮是否有活干无关）。
  await runPendingStartupMaintenance(conn, {
    kkvModule: LEGACY_MESSAGE_CONTENT_KKV_MODULE,
    pendingKey: LEGACY_MAINTENANCE_PENDING_KKV_KEY,
    logTag: LOG_TAG,
    beforeMaintenance: options.beforeMaintenance,
    afterMaintenance: options.afterMaintenance,
  });

  // 启动先查标记，**但先付一次自愈探测**（防标记闩锁）：标记随整库快照
  // travels 且写死不校验时，pull 回灌的旧快照会把「已解完」标记带到一个
  // 仍是压缩形态的库上——不清标记则该库永久停在压缩态、本迭代核心收益
  // 拿不到。探测命中即清标记续搬（正常稳态是零行命中的索引级查询）。
  const marker = await readDoneMarker(conn);
  if (marker != null) {
    if (!(await hasPendingRows(conn))) {
      return {
        done: true,
        decompressedCount: 0,
        failedCount: marker.failedCount,
        stalled: false,
      };
    }
    console.warn(
      `[${LOG_TAG}] 完成标记已置位但库中仍有压缩行（快照回灌等标记与数据形态脱节），已清标记续搬`
    );
    try {
      await new SqliteKkvRepository(conn).delete(
        MESSAGE_DECOMPRESS_KKV_MODULE,
        MESSAGE_DECOMPRESS_KKV_KEY
      );
    } catch (error) {
      // 清失败不阻断：本轮照样真搬，搬完会重新置标记（幂等覆盖）。
      console.warn(
        `[${LOG_TAG}] 清除失配的完成标记失败，继续搬运（收尾会重新置标记）：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const budgetMs =
    options.syncBudgetMs ?? DEFAULT_DECOMPRESS_SYNC_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  let decompressedCount = 0;
  let failedCount = 0;
  /** 本轮已确认解码失败的主键（行原样保留压缩形态，仍留在谓词里）。 */
  const failedKeys = new Set<string>();
  /** 连续零进展批计数（护栏用，见 {@link ZERO_PROGRESS_BATCH_LIMIT}）。 */
  let zeroProgressBatches = 0;
  // keyset 游标：初值 0 安全（rowid 恒为正）。只用于本轮加速，不承担完成
  // 判定——完成判定仍以下方收尾的谓词 COUNT 为准。
  let cursor = 0;

  for (;;) {
    if (options.shouldPause?.()) {
      return { done: false, decompressedCount, failedCount, stalled: false };
    }

    // 每批 ≤100 行：取 rowid/id/content_encoding/content_blob（搬运源）。
    const rows = await conn.query<{
      rowid: number;
      id: string;
      content_encoding: SqlValue;
      content_blob: SqlValue;
    }>(
      `SELECT rowid, id, content_encoding, content_blob FROM chat_message
       WHERE content_blob IS NOT NULL AND rowid > ?
       ORDER BY rowid
       LIMIT ${BATCH_SIZE}`,
      [cursor]
    );
    if (rows.length === 0) {
      break;
    }

    // 批内统计：实际落库行数 / 新增坏行数（护栏的输入）。
    let batchChanges = 0;
    let newFailures = 0;

    for (const row of rows) {
      let plaintext: string;
      try {
        plaintext = decodeMessageContent(
          row.content_encoding,
          row.content_blob,
          row.id
        );
      } catch (error) {
        // 坏行隔离：解码抛错只跳过本行——抛出去会中断整轮、坏行永远留在
        // 谓词里，完成标记永远置不上、每次启动白烧预算。行原样保留压缩
        // 形态，读路径对它双形态自愈（读到旧压缩内容，语义正确）。
        failedKeys.add(row.id);
        failedCount += 1;
        newFailures += 1;
        console.warn(
          `[${LOG_TAG}] chat_message.id=${row.id} 解码失败，跳过搬运：${
            error instanceof Error ? error.message : String(error)
          }`
        );
        continue;
      }

      // 单条短事务 UPDATE：写回明文、压缩两列置 NULL。条件带谓词防并发
      // 重复搬运（另一端/上一轮已搬走时 changes=0）。
      const result = await conn.transaction(async (tx) => {
        return await tx.execute(
          `UPDATE chat_message
           SET content_json = ?, content_encoding = NULL, content_blob = NULL
           WHERE id = ? AND content_blob IS NOT NULL`,
          [plaintext, row.id]
        );
      });
      // 只计实际落库的行走数：谓词命中但 changes=0 说明已被并发端搬走
      // （或驱动写回不生效——那是护栏与收尾校验要抓的异常）。
      if (result.changes > 0) {
        decompressedCount += 1;
        batchChanges += 1;
      }
    }

    // 每批末（含逐行 UPDATE 之后）无条件推进游标：打转行（UPDATE 恒
    // changes=0）游标推过后不再出现在后续批，由下方收尾谓词校验兜住；
    // 并发端搬走的行同理，残余由下次启动谓词重扫兜底。
    cursor = Number(rows[rows.length - 1]!.rowid);

    if (batchChanges === 0 && newFailures === 0) {
      // 零进展批：连续 3 批即判定原地打转。
      zeroProgressBatches += 1;
      if (zeroProgressBatches >= ZERO_PROGRESS_BATCH_LIMIT) {
        // 继续只是白烧同步预算：告警后本轮主动收手、**不置完成标记**，
        // 并把 stalled 透给 app 层让它本进程停止重试。下个冷启动再试。
        console.warn(
          `[${LOG_TAG}] 连续 ${ZERO_PROGRESS_BATCH_LIMIT} 批搬运零进展，疑似谓词原地打转，本轮中止`
        );
        return {
          done: false,
          decompressedCount,
          failedCount,
          stalled: true,
        };
      }
    } else {
      zeroProgressBatches = 0;
    }

    // 批间让步：预算检查放批粒度（行粒度事务已足够短）。
    if (Date.now() >= deadline) {
      return { done: false, decompressedCount, failedCount, stalled: false };
    }
    await yieldToEventLoop();
  }

  // 收尾谓词校验：游标扫完（rows.length === 0）后谓词必须已空或只剩本轮
  // 已知坏行。**不变量：leftover ⊆ failedKeys**——收尾校验只在游标扫完后
  // 可达（正常行被搬走或并发端搬走都已离开谓词；留下的只可能是本轮解码
  // 失败的坏行），故 leftover > failedKeys.size 即异常残留（如驱动写回
  // 静默不生效）。**收尾前不得引入任何提前 break**——任何「看着扫完了」
  // 的提前退出都会让残留行被永久锁死在压缩态；护栏/预算/守卫的提前
  // return 是显式失败路径（不置标记），不在此列。
  const leftover = await countPendingRows(conn);
  if (leftover > failedKeys.size) {
    console.warn(
      `[${LOG_TAG}] 游标已扫完但谓词仍剩 ${leftover} 行（本轮已知坏行 ${failedKeys.size} 行），疑似异常残留，不置完成标记`
    );
    return {
      done: false,
      decompressedCount,
      failedCount,
      stalled: true,
    };
  }

  // 谓词空（或仅剩坏行）→ 两段式置 KKV 完成标记。坏行不阻断标记：否则每次
  // 启动都要重扫同一批坏行再抛一遍，任务永远收敛不了。标记值存 JSON（含
  // failedCount 快照，读取端解析兜底见 readDoneMarker）。
  await new SqliteKkvRepository(conn).set(
    MESSAGE_DECOMPRESS_KKV_MODULE,
    MESSAGE_DECOMPRESS_KKV_KEY,
    JSON.stringify({ at: new Date().toISOString(), failedCount })
  );

  // **到此为止，不挂收尾维护链路**（无 VACUUM / checkpoint / 缓存 GC）——
  // 解压是增容不是释放：库里没有可归还的 freelist 页，VACUUM 只会全库
  // 重写、白烧一次同步阻塞。与正向任务（压缩释放页、挂 VACUUM 有实打实的
  // 空间收益）的语义差异，见文件头注释。
  return { done: true, decompressedCount, failedCount, stalled: false };
}
