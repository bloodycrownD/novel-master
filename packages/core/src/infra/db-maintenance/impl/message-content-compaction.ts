/**
 * 消息正文压缩搬运任务（message-content-compression 迁移层）。
 *
 * 不注册 schema migration 搬数据（跨 boot 框架缺失、空占位禁令封死
 * 「先登记后搬」），改用后台幂等压缩任务——先例：runDeferredFileCacheGc
 * 的「事务提交后调度」+ vfs-content-blob-zlib-v1 的谓词驱动分批骨架
 * （该 migration 已退役，骨架见 git 历史 63a35139）。
 *
 * - 谓词：`content_json != ''`（未压缩行）。每批 ≤100 行：SELECT
 *   rowid/id/content_json（不碰 blob 列）→ JS 侧 fflate 压缩 → 单条短事务
 *   UPDATE（置 blob + encoding + content_json=''）→ 批间 setTimeout(0)
 *   让步（mobile 事务内另有 TDBC 16ms 量子让步兜底）。
 * - 批查询带 keyset 游标（`rowid > ?` 单调推进）：游标只用于**本轮加速**
 *   ——每批从上一批末尾续扫，不再从头扫过已搬走的前缀行（5350 行量级
 *   库每批从头扫的累计读放大约 4GB，是「真机 2 分钟才收敛」的主成本）。
 *   完成判定仍以谓词 COUNT 为准，不落在游标上；并发端（另一端启动）
 *   搬走的行不会出现在本进程后续批，残余由下次启动的谓词重扫兜底。
 * - 幂等可重入：中断（杀进程/会话运行）随时停，重启后谓词重扫续跑，
 *   已压缩行天然排除。
 * - 完成判定两态：进行中（剩余 N 条，谓词 COUNT）/ 已完成（谓词空 →
 *   置 KKV 完成标记 → 经 `runStartupMaintenanceOnce`（进程级去重入口）
 *   触发一次维护链路归还页空间——同进程多任务叠加不会多次全库 VACUUM；
 *   维护失败只 warn 不抛，并写 `startupMaintenancePending` 持久化兜底，
 *   下次启动入口读到即强制补跑一次）。库里只有完成标记一种持久化进度，
 *   数据上无法区分「从未跑过」与「跑过若干批」，故不设「未开始」态。
 * - 升级首启有界同步收尾预算（默认 60s）：调用方传 {@link
 *   RunMessageContentCompactionOptions.syncBudgetMs}，超预算残余由
 *   调用方转后台续跑（再次调用本任务）。
 * - 并发安全：app 层组合守卫（按端取用，见各端调度接线）+ 驱动连接级
 *   互斥（tdbc）；本任务不感知具体守卫。维护段另设
 *   beforeMaintenance/afterMaintenance 回调供 app 层置 busy 信号（回调
 *   异常由 core 吞掉，app 侧不得带崩收尾链路）。
 *
 * 应急预案（spec 回滚方案）：若发布后发现解压 bug，可用同款任务反向
 * 解回明文——谓词反转为 `content_blob IS NOT NULL`，逐行 UPDATE 置回
 * content_json=解压明文、blob 两列置 NULL。读路径双形态保证反向搬完
 * 前后均可读。
 *
 * 已知限制（风险登记）：压缩任务恒写 `content_encoding='zlib'` + 二进制
 * BLOB；若某端驱动有缺陷把二进制绑成 TEXT 存回（blob 归一谓词第二
 * disjunct 针对的历史脏形态），而 blob 归一的 `messageContentDone`
 * 标记已置（该表已完成短路），这批新脏行不会被归一任务自动重扫——
 * 兜底手段：手动清 `messageContentDone`（KKV module `nm-blob-binary`）
 * 触发重扫。
 *
 * @module infra/db-maintenance/impl/message-content-compaction
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteKkvRepository } from "@/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import { encodeMessageContent } from "@/domain/chat/logic/message-content-codec.js";
import { runStartupMaintenanceOnce } from "./db-maintenance.service.js";

/** KKV 完成标记两段式命名（module 为 nm- 短横线、key 为 camelCase，
 * 先例 `nm-search` / `nm-compaction-conditions`）。 */
export const MESSAGE_COMPACTION_KKV_MODULE = "nm-message-content";
export const MESSAGE_COMPACTION_KKV_KEY = "compactionDone";

/**
 * 收尾维护失败的持久化兜底标记 key（module 同 {@link
 * MESSAGE_COMPACTION_KKV_MODULE}，独立 key）。
 *
 * @remarks 口径（OQ-I2）：与 blob 归一侧（`nm-blob-binary`）**各自独立
 * pending key、只共用 `runStartupMaintenanceOnce` 的进程级去重域**——
 * 不共享单 key，避免两任务的补跑语义互相牵连。
 */
export const MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY =
  "startupMaintenancePending";

/** 每批搬运行数上限（短事务粒度，spec 拍板 ≤100）。 */
const BATCH_SIZE = 100;

/**
 * 零进展护栏阈值：连续多少个**零进展批**（本批 UPDATE 全部 `changes === 0`
 * 且无新增坏行）即判定异常打转。
 *
 * @remarks 护的是「某端驱动写回不生效、谓词反复命中行」这类原地打转的
 * 死循环——纯烧同步预算。**不要求满批**：游标版每批扫的都是新行，
 * 「同一批行 UPDATE 却全 0」在任何批大小下都是可靠的异常信号；旧口径的
 * 满批条件会让「卡住行数 < 100」的情形永远不触发护栏。阈值取 3 而不是
 * 1：容忍偶发的并发抢写/写锁抖动，又把无界空转压在 3 批以内。
 */
const ZERO_PROGRESS_BATCH_LIMIT = 3;

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
  /**
   * 进入维护段前的回调（app 层置 busy 信号用，如 desktop 的
   * `setDesktopDbMaintenanceBusy(true)`）。
   *
   * @remarks 含被进程级去重短路的调用——回调早于去重判定执行（对齐
   * blob 侧同款语义，进入维护段的次数以本回调计数为准）；回调抛错由
   * core 吞掉只 warn，app 回调异常不得带崩收尾链路。
   */
  readonly beforeMaintenance?: () => void;
  /**
   * 维护段结束后的回调（app 层复位 busy 信号用）。
   *
   * @remarks **finally 语义**：维护链路（VACUUM 等）抛错也必须复位，
   * 否则 busy 信号永久置位会锁死后续调度；回调抛错同样由 core 吞掉。
   */
  readonly afterMaintenance?: () => void;
}

/** {@link runMessageContentCompaction} 结果。 */
export interface MessageCompactionRunResult {
  /** true = 谓词已空且完成标记已置（含触发维护链路）。 */
  readonly done: boolean;
  /** 本次调用实际搬运的行数（只计 UPDATE `changes > 0` 的落库行）。 */
  readonly compactedCount: number;
  /**
   * 本次调用编码失败被跳过的行数（坏行隔离）。
   *
   * @remarks 失败的行**原样保留明文、不写库**，既不阻断其余行的收敛，
   * 也不阻断完成标记的置位（否则坏行永远留在谓词里、每次启动白烧预算）。
   * > 0 表示存在需人工关注的行：读路径对明文行是双形态自愈的。
   */
  readonly failedCount: number;
  /**
   * 本轮是否被零进展护栏或收尾谓词校验主动拦停。
   *
   * @remarks `true` 仅表示「继续立即重跑也不会有任何进展」的异常态：
   * 此时完成标记未置、`done = false`，调用方应本进程停止重试（下个冷
   * 启动再试），而不是零延迟续跑把空转放大成热循环。预算耗尽、守卫
   * 暂停等普通 `done = false` 一律为 `false`。
   */
  readonly stalled: boolean;
}

/** 完成标记值（JSON；旧版为纯 ISO 时间戳字符串，解析兜底见 readDoneMarker）。 */
interface MessageCompactionDoneMarker {
  /** 置标记时间。 */
  readonly at: string;
  /** 置标记时累计跳过的坏行数（需人工关注的行）。 */
  readonly failedCount: number;
}

async function countPendingRows(conn: TdbcConnection): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chat_message WHERE content_json != ''"
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * 状态采样节流窗口（ic-06①）：desktop 存储页 2s 轮询 + 全表 COUNT（谓词
 * 不可索引）= 迁移期 IO 风暴，窗口内重复采样直接回放上次值。取 3s（略
 * 大于 desktop 2s 轮询周期）：相邻两次轮询合并成一次真采样，进度展示
 * 最多滞后一个窗口（mobile 5s 轮询周期大于窗口，每次仍真采样）。
 */
const STATUS_SAMPLING_THROTTLE_MS = 3000;

/**
 * 未完成态采样缓存（按连接实例隔离，ic-06①）。
 *
 * 只缓存「标记未置、真跑了谓词 COUNT」的采样值——`getMessageCompactionStatus`
 * 里标记已置的免 COUNT 快路径在缓存检查**之前**就返回，天然不写缓存也
 * 不受节流影响（稳态每次调用仍只读一次 KKV 标记）。
 */
let statusSamplingThrottleCache = new WeakMap<
  TdbcConnection,
  { at: number; value: MessageCompactionStatus }
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
 * 读 KKV 完成标记（两段式 module/key）。
 *
 * 标记值向后兼容：旧版是纯 ISO 时间戳字符串（无 failedCount 可言），
 * `JSON.parse` 失败一律按 `{ failedCount: 0 }` 处理——不抛、不刷屏，
 * 旧库升级后照常判定完成（failedCount 归零口径与「旧标记时代无此
 * 信号」一致）。
 */
async function readDoneMarker(
  conn: TdbcConnection
): Promise<MessageCompactionDoneMarker | null> {
  const kkv = new SqliteKkvRepository(conn);
  const entry = await kkv.get(
    MESSAGE_COMPACTION_KKV_MODULE,
    MESSAGE_COMPACTION_KKV_KEY
  );
  if (entry == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(entry.value) as Partial<MessageCompactionDoneMarker>;
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

/**
 * 安全执行 app 层维护回调：回调异常只 warn，不得带崩 core 收尾链路。
 */
function callMaintenanceHook(
  hook: (() => void) | undefined,
  label: string
): void {
  if (hook == null) {
    return;
  }
  try {
    hook();
  } catch (error) {
    console.warn(
      `[message-content-compaction] ${label} 回调抛错，已忽略：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * 入口的 pending 补跑（ic-01 方案 b 的持久化兜底）。
 *
 * 库里存有 `startupMaintenancePending` 标记 = 上次收尾维护链路失败过
 * （页空间尚未回收）。此时无视「本轮无进展」——包括完成标记已置的
 * 稳态短路路径——强制补跑一次维护；清标记以 {@link
 * runStartupMaintenanceOnce} 返回非 null 为条件（本进程真跑了维护且
 * 未抛错）。返回 null 说明本进程已跑过维护（进程级去重短路），无法
 * 确认那次成功与否，保守保留标记待下次冷启动补跑——这是正常场景
 * （多补一次 VACUUM 无害，漏补则页空间永不回收），warn 说明即可。
 */
async function runPendingStartupMaintenance(
  conn: TdbcConnection,
  options: RunMessageContentCompactionOptions
): Promise<void> {
  const kkv = new SqliteKkvRepository(conn);
  const entry = await kkv.get(
    MESSAGE_COMPACTION_KKV_MODULE,
    MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY
  );
  if (entry == null) {
    return;
  }
  callMaintenanceHook(options.beforeMaintenance, "beforeMaintenance");
  try {
    const result = await runStartupMaintenanceOnce(conn);
    if (result !== null) {
      try {
        await kkv.delete(
          MESSAGE_COMPACTION_KKV_MODULE,
          MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY
        );
      } catch (error) {
        console.warn(
          `[message-content-compaction] 清除 startupMaintenancePending 标记失败（下次启动会多补跑一次维护，无害）：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    } else {
      console.warn(
        "[message-content-compaction] startupMaintenancePending 补跑被进程级去重短路（本进程已跑过维护链路），保留标记待下次冷启动补跑——正常场景"
      );
    }
  } catch (error) {
    console.warn(
      `[message-content-compaction] startupMaintenancePending 补跑维护链路失败，保留标记待下次启动重试：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    callMaintenanceHook(options.afterMaintenance, "afterMaintenance");
  }
}

/**
 * 采样搬运状态（双端存储页两态状态行 + 启动零成本短路共用）。
 *
 * 稳态（已完成）只读 KKV 标记一次即返回，零 COUNT 成本；未完成才
 * COUNT 全表（仅迁移期间，73MB 量级库毫秒级）。未完成态的谓词 COUNT
 * 带 3s 节流（ic-06①，见 {@link STATUS_SAMPLING_THROTTLE_MS}）：窗口内
 * 重复调用回放上次采样值——「2s 轮询 + 全表扫 = 迁移期 IO 风暴」，
 * 采样只是进度展示，滞后一个窗口无正确性影响（搬运与完成判定都不走
 * 本缓存）。两端 app 消费侧（desktop 2s 轮询 / mobile 5s 轮询）无需
 * 感知：节流发生在 core 层。
 */
export async function getMessageCompactionStatus(
  conn: TdbcConnection
): Promise<MessageCompactionStatus> {
  if (await readDoneMarker(conn)) {
    return { done: true, pendingCount: 0 };
  }
  const cached = statusSamplingThrottleCache.get(conn);
  if (cached != null && Date.now() - cached.at < STATUS_SAMPLING_THROTTLE_MS) {
    return cached.value;
  }
  const pendingCount = await countPendingRows(conn);
  const status: MessageCompactionStatus = {
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
  // pending 兜底放在最前：完成标记短路的稳态路径也要补跑（见函数注释）。
  await runPendingStartupMaintenance(conn, options);

  // 启动先查标记即走：此后每次启动零成本（spec 拍板）。
  const marker = await readDoneMarker(conn);
  if (marker != null) {
    return {
      done: true,
      compactedCount: 0,
      failedCount: marker.failedCount,
      stalled: false,
    };
  }

  const budgetMs =
    options.syncBudgetMs ?? DEFAULT_COMPACTION_SYNC_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  let compactedCount = 0;
  let failedCount = 0;
  /** 本轮已确认编码失败的主键（行原样保留明文，仍留在谓词里）。 */
  const failedKeys = new Set<string>();
  /** 连续零进展批计数（护栏用，见 {@link ZERO_PROGRESS_BATCH_LIMIT}）。 */
  let zeroProgressBatches = 0;
  // keyset 游标：初值 0 安全（rowid 恒为正）。只用于本轮加速，不承担
  // 完成判定——完成判定仍以下方收尾的谓词 COUNT 为准。
  let cursor = 0;

  for (;;) {
    if (options.shouldPause?.()) {
      return { done: false, compactedCount, failedCount, stalled: false };
    }

    // 每批 ≤100 行：只取 rowid/id/content_json，不碰 blob 列（搬运源）。
    const rows = await conn.query<{
      rowid: number;
      id: string;
      content_json: string;
    }>(
      `SELECT rowid, id, content_json FROM chat_message
       WHERE content_json != '' AND rowid > ?
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
      let encoded: ReturnType<typeof encodeMessageContent>;
      try {
        encoded = encodeMessageContent(row.content_json);
      } catch (error) {
        // 坏行隔离：编码抛错只跳过本行——抛出去会中断整轮、坏行永远
        // 留在谓词里，完成标记永远置不上、每次启动白烧预算。行原样
        // 保留明文，读路径对明文是双形态自愈的。
        failedKeys.add(row.id);
        failedCount += 1;
        newFailures += 1;
        console.warn(
          `[message-content-compaction] chat_message.id=${row.id} 编码失败，跳过搬运：${
            error instanceof Error ? error.message : String(error)
          }`
        );
        continue;
      }

      // 单条短事务 UPDATE：置 blob + encoding + content_json=''。
      // 条件带谓词防并发重复搬运（另一端/上一轮已搬走时 changes=0）。
      const result = await conn.transaction(async (tx) => {
        return await tx.execute(
          `UPDATE chat_message
           SET content_blob = ?, content_encoding = ?, content_json = ''
           WHERE id = ? AND content_json != ''`,
          [encoded.blob, encoded.encoding, row.id]
        );
      });
      // 只计实际落库的行走数：谓词命中但 changes=0 说明已被并发端搬走
      // （或驱动写回不生效——那是护栏要抓的异常）。
      if (result.changes > 0) {
        compactedCount += 1;
        batchChanges += 1;
      }
    }

    // 每批末（含逐行 UPDATE 之后）无条件推进游标：打转行（UPDATE 恒
    // changes=0）游标推过后不再出现在后续批，由下方收尾谓词校验兜住；
    // 并发端搬走的行同理，残余由下次启动谓词重扫兜底。
    cursor = Number(rows[rows.length - 1]!.rowid);

    if (batchChanges === 0 && newFailures === 0) {
      // 零进展批：游标版每批扫的都是新行，「UPDATE 却全 0」在任何批
      // 大小下都是异常信号（不设满批条件——「卡住行数 < 100」恰是旧
      // 口径漏掉、且最该兜底的那类）。连续 3 批即判定原地打转。
      zeroProgressBatches += 1;
      if (zeroProgressBatches >= ZERO_PROGRESS_BATCH_LIMIT) {
        // 继续只是白烧同步预算：告警后本轮主动收手、**不置完成标记**，
        // 并把 stalled 透给 app 层让它本进程停止重试（否则「零延迟续跑」
        // 会把空转放大成无界热循环）。下个冷启动再试。
        console.warn(
          `[message-content-compaction] 连续 ${ZERO_PROGRESS_BATCH_LIMIT} 批搬运零进展，疑似谓词原地打转，本轮中止`
        );
        return { done: false, compactedCount, failedCount, stalled: true };
      }
    } else {
      zeroProgressBatches = 0;
    }

    // 批间让步：预算检查放批粒度（行粒度事务已足够短）。
    if (Date.now() >= deadline) {
      return { done: false, compactedCount, failedCount, stalled: false };
    }
    await yieldToEventLoop();
  }

  // 收尾谓词校验：游标扫完（rows.length === 0）后谓词必须已空或只剩
  // 本轮已知坏行。**不变量：leftover ⊆ failedKeys**——收尾校验只在
  // 游标扫完后可达（正常行被搬走或并发端搬走都已离开谓词；留下的只
  // 可能是本轮编码失败的坏行），故 leftover > failedKeys.size 即异常
  // 残留（如驱动写回静默不生效）。**收尾前不得引入任何提前 break**——
  // 任何「看着扫完了」的提前退出都会让残留行被永久跳过；护栏/预算/
  // 守卫的提前 return 是显式失败路径（不置标记），不在此列。
  const leftover = await countPendingRows(conn);
  if (leftover > failedKeys.size) {
    console.warn(
      `[message-content-compaction] 游标已扫完但谓词仍剩 ${leftover} 行（本轮已知坏行 ${failedKeys.size} 行），疑似异常残留，不置完成标记`
    );
    return { done: false, compactedCount, failedCount, stalled: true };
  }

  // 谓词空（或仅剩坏行）→ 两段式置 KKV 完成标记（module/key 命名见
  // 常量注释）。坏行不阻断标记：否则每次启动都要重扫同一批坏行再抛
  // 一遍，任务永远收敛不了。标记值存 JSON（含 failedCount 快照，读取
  // 端解析兜底见 readDoneMarker）。
  await new SqliteKkvRepository(conn).set(
    MESSAGE_COMPACTION_KKV_MODULE,
    MESSAGE_COMPACTION_KKV_KEY,
    JSON.stringify({ at: new Date().toISOString(), failedCount })
  );

  // 完成后经进程级去重入口触发一次维护链路（缓存 GC → checkpoint →
  // VACUUM，事务外直调——搬运释放的页挂 freelist，VACUUM 归还文件系统）。
  // 与 blob 归一同处 runStartupMaintenanceOnce 的进程级去重域：同进程
  // 双任务叠加也只有一次全库 VACUUM。必须吞掉维护异常：VACUUM 在磁盘
  // 满/库被锁时抛错，裸奔上去会带崩调用方（CLI 每条命令失败）；失败
  // 只丢空间回收、不影响正确性——此时写 startupMaintenancePending
  // 持久化兜底，下次启动入口强制补跑（见 runPendingStartupMaintenance）。
  // 返回 null（本进程已跑过）时不动 pending：无法确认那次成功与否，
  // 保守保留待下次冷启动，对齐入口补跑的同款口径。
  const kkv = new SqliteKkvRepository(conn);
  callMaintenanceHook(options.beforeMaintenance, "beforeMaintenance");
  try {
    const maintenanceResult = await runStartupMaintenanceOnce(conn);
    if (maintenanceResult !== null) {
      // 本进程真跑了且未抛错：清 pending 兜底标记（幂等，无则 no-op）。
      try {
        await kkv.delete(
          MESSAGE_COMPACTION_KKV_MODULE,
          MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY
        );
      } catch (error) {
        console.warn(
          `[message-content-compaction] 清除 startupMaintenancePending 标记失败（下次启动会多补跑一次维护，无害）：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  } catch (error) {
    console.warn(
      `[message-content-compaction] 收尾维护链路（缓存 GC / checkpoint / VACUUM）失败，不影响搬运结果：${
        error instanceof Error ? error.message : String(error)
      }`
    );
    // 失败 → 置 pending 兜底标记（下次启动入口强制补跑一次维护）。
    try {
      await kkv.set(
        MESSAGE_COMPACTION_KKV_MODULE,
        MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY,
        "1"
      );
    } catch (setError) {
      console.warn(
        `[message-content-compaction] startupMaintenancePending 兜底标记写入失败（下次启动无法自动补跑维护）：${
          setError instanceof Error ? setError.message : String(setError)
        }`
      );
    }
  } finally {
    // finally 语义：维护抛错也必须复位 app 的 busy 信号。
    callMaintenanceHook(options.afterMaintenance, "afterMaintenance");
  }
  return { done: true, compactedCount, failedCount, stalled: false };
}
