/**
 * 消息引用化回迁任务（v1.5.30 unref 回退，反向搬运）。
 *
 * 背景：v1.5.29 曾把 read / skill 的 tool_result 改写成引用形态——`content`
 * 置占位空串、正文改存 `contentRef`（全局键 `(entryId, version)`），并按
 * `aggregateReadRefs` 口径给源 revision `ref_count` +1。本迭代把整个引用化
 * 机制回迁掉：写侧恒存全文，**新消息不再产生任何 `contentRef`、也不再 +1**。
 * 本任务把 v1.5.29 装机窗口落库的**存量引用行**逐行改写回明文包，并对源
 * revision 逐 pair 精确 −1（消息不再持有该引用，计数就该让出来）。
 *
 * 骨架与兄弟任务 `message-content-decompression.ts` 同款（keyset 游标 +
 * 批 ≤100 + 单行短事务 + 谓词进 UPDATE WHERE + 零进展护栏 3 批 + 同步预算
 * 60s + shouldPause + 批间让步 + 3s WeakMap 按连接节流的状态采样）：
 *
 * - 谓词（三处**同条件**：主循环批 SELECT / 入口自愈探针 / 收尾 COUNT）：
 *   `content_json LIKE '%"contentRef"%' AND content_blob IS NULL`。
 *   - 带引号的键形态（D12）：`JSON.stringify` 产出的 `contentRef` 键在库里
 *     的字节形态就是 `"contentRef"`；正文里用户自己写的带引号文本会被 JSON
 *     转义成 `\"contentRef\"`——该序列不会出现。故带引号形式几乎只可能来自
 *     真 `contentRef` 键，把假阳性概率压到近零（但**不消除**，见下）。
 *   - `content_blob IS NULL`（D19）：压缩行不由本任务碰——那行得先经解压
 *     兄弟任务解回明文才谈得上回迁，与它抢同一行得不偿失（而且抢不到明文，
 *     因为压缩行的 `content_json` 是空串）。
 * - 行级动作：parse 出引用块（复用 parse 层白名单，`kind` 不限 read/skill）→
 *   逐块按 `(entryId, version)` `findByEntryAndVersion` 取明文（内部
 *   `contentStore.get(contentHash)`）→ 组装 `{path, content}` JSON 写回该块
 *   `content` 并**移除 `contentRef` 字段** → 整行 `content_json` 写回。
 *   **写回只 patch raw 原始 blocks**（`JSON.parse(contentJson)` 原地改），
 *   不拿 parse 结果重排：整行归一化会吞掉空 text 块与白名单外字段，把「搬
 *   contentRef」放大成「整行所有块不可逆重写」。
 *   - **hash 不匹配不算坏行**：能取到明文就照常回填并 warn。内容寻址 hash
 *     在本仓其余读路径上都不当强校验用（见 hydrate 兜底模块的同款取舍），
 *     废除的 hydrate fail-fast 四码不复活。
 *   - **坏行三判别**（revision 行缺失 / 明文不可取（blob 缺失）/
 *     `status=deleted`）：落错误占位 JSON（`{path, error}`）+ warn + 记
 *     `failedIds`。占位仍**移除 `contentRef`**——它本来就取不回明文，留着
 *     只会让每次冷启动都重跑一遍同样的注定失败。
 *   - **假阳性行**（谓词命中但 parse 后无引用块，例如正文里恰好出现
 *     `contentRef` 字面量）：warn + 记 `failedIds` + **单独计数**
 *     （`noRefBlockCount`，与坏行 `failedCount` 区分）+ **不下发 UPDATE**。
 *     不下发是关键：若为了「让行退出谓词」下发一次同值 UPDATE，SQLite 的
 *     `changes` 仍计 1，零进展护栏永不触发，调度层零延迟续跑 → 无界热循环
 *     （D12 双保险之二）。
 * - **写回与 −1 同一 `conn.transaction`**（D15）：`ref_count` 误减是不可恢复
 *   方向（提前 GC 删活 revision），把两件事拆开则「写回成功、−1 失败」留下
 *   永久泄漏、「−1 成功、写回失败」重扫二次 −1 把计数减到负/归零。事务
 *   回调里**只喂 `tx` 句柄**（`new SqliteVfsRevisionRepository(tx)`）——驱动
 *   层 AsyncMutex 不可重入，回调里误用外层 `conn` 会死锁。UPDATE WHERE 带
 *   谓词，重复搬运 `changes = 0` 自然跳过。
 *   −1 口径走 `aggregateReadRefs`（消息内 pair 去重、消息间累加），与 fork/copy
 *   的 +1、删除路径的 −1 严格对账。**−1 之前先查前值**：行缺失或
 *   `前值 < |delta|` 的 pair 记 warn 区分坏行（repository 侧 UPDATE 同时带
 *   `ref_count >= |delta|` 下限夹逼——误减活 revision 是不可恢复方向）。
 * - **入口自愈（防标记闩锁）**：完成标记已置位时先跑一次
 *   `SELECT 1 ... <谓词> LIMIT 1`（并排除标记里已知的 `failedIds`），命中
 *   （整库快照回灌等让标记与数据形态脱节）即清标记续搬。
 * - **探针排除 `failedIds`**：假阳性行按设计**永留谓词**（不能改用户正文）。
 *   不排除的话每次冷启动都要走「标记命中 → 探针必命中 → 清标记 → 全表重扫
 *   → 再撞同一批假阳性行」的永不收敛循环。
 * - **收尾让位仅一条（D19）**：解压兄弟任务的 KKV 标记
 *   （`nm-message-decompress` / `decompressDone`）未置 → 返回
 *   `deferred = true` 且**不置本任务标记**。压缩行仍残留只 warn 记
 *   deferred 计数、**不作否决**——解压任务自身的判据允许坏行残留稳态
 *   （`leftover ≤ failedKeys` 即置标记），双条件会永久锁死 `unrefDone`
 *   与清理版的外部确认闸门。
 *   **`deferred` 与 `stalled` 同款停手语义**：调用方 warn 后本进程收手、
 *   下个冷启动按 KKV 重试；**不可把它当「预算耗尽」零延迟续轮**（先例
 *   调度循环只有 done/stalled 两个停手出口，deferred 落在「永不 done 也不
 *   stalled」象限会变成永不退出的忙循环）。该语义已进类型（`deferred` 字段）。
 * - **收尾判定顺序：deferred 让位前置于残留下沉校验**。压缩行被解压任务解回
 *   明文时会**在游标扫过之后**才进入谓词，先判 leftover 会把这种正常交叠态
 *   谎报成 stalled。两条判定同为**不置标记的显式失败路径**（谁先判都不置
 *   标记、都不让本进程零延迟续轮），不违反下面的收尾不变量。
 * - **收尾不变量（承重约束）**：`leftover > residualKeys.size → stalled = true`
 *   + 不置标记。`residualKeys` 只装**仍留在谓词里**的行（假阳性行、parse
 *   不过的坏行）；已落错误占位的坏块行**已退出谓词**，故不拿它放宽校验
 *   （否则等于给「写回静默不生效」白送额度）。驱动静默写回不生效时游标会
 *   扫完但谓词仍有行、residualKeys 为空；没有这道校验任务会谎报完成并把残留行
 *   **永久锁死在引用态**。**收尾前不得引入任何「看着扫完了」的提前退出**
 *   ——护栏/预算/守卫/deferred 让位判定的提前 return 都是显式失败路径
 *   （不置标记），不在此列。
 * - **KKV 完成标记两段式**（D18）：module `nm-message-ref-unref`、key
 *   `unrefDone`（camelCase 惯例）。不复用解压任务的 module——两代语义不同，
 *   混用会让标记互相冒充。
 *
 * **不挂收尾维护链路（VACUUM / checkpoint）**——与解压兄弟任务同款语义差异：
 * 回迁是**增容**（明文包比占位空串大得多，库里没有任何可归还的 freelist
 * 页），VACUUM 只会全库重写、白烧一次同步阻塞。本文件不提供
 * `beforeMaintenance` / `afterMaintenance` 回调（解压那两个只为消费旧
 * `startupMaintenancePending` 欠账存在，本任务无此欠账）。
 *
 * **不建部分索引（D13）**：谓词要对整段 `content_json` 求值，部分索引会让
 * **每条消息写一次全串扫描**；回迁一次性、存量行预计 ≈0，分批全扫可接受。
 * 代价是入口探针在未完成态是全表读正文——这正是 D13 显式登记的取舍。
 *
 * 升级首启有界同步收尾预算（默认 60s）：调用方传
 * {@link RunMessageRefUnrefOptions.syncBudgetMs}，超预算残余由调用方转后台
 * 续跑（再次调用本任务）。
 *
 * 并发安全：app 层组合守卫（按端取用，见各端调度接线）+ 驱动连接级互斥
 * （tdbc）；本任务不感知具体守卫。
 *
 * 退役契约：清理版确认全库谓词归零且 `unrefDone` 已置后，本文件连同三端
 * 调度接线一并删除（见 spec「后续清理轮」）。
 *
 * @module infra/db-maintenance/impl/message-ref-unref
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteKkvRepository } from "@/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import { parseMessageContent } from "@/domain/chat/content/parse-message-content.js";
import type {
  MessageContent,
  ReadResultRef,
  SkillResultRef,
} from "@/domain/chat/model/content-block.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  adjustReadRefCount,
  aggregateReadRefs,
  type ReadRefPointer,
} from "@/domain/vfs/logic/revision-ref-count.js";
import {
  MESSAGE_DECOMPRESS_KKV_KEY,
  MESSAGE_DECOMPRESS_KKV_MODULE,
} from "./message-content-decompression.js";

/** 本任务的日志标签（告警溯源前缀）。 */
const LOG_TAG = "message-ref-unref";

/** KKV 完成标记两段式命名（D18）。 */
export const MESSAGE_REF_UNREF_KKV_MODULE = "nm-message-ref-unref";
export const MESSAGE_REF_UNREF_KKV_KEY = "unrefDone";

/** 每批搬运行数上限（短事务粒度，spec 拍板 ≤100）。 */
const BATCH_SIZE = 100;

/**
 * 零进展护栏阈值：连续多少个**零进展批**（本批 UPDATE 全部 `changes === 0`
 * 且无新增失败行）即判定异常打转。
 *
 * @remarks 口径照搬兄弟任务：游标版每批扫的都是新行，「同一批行 UPDATE
 * 却全 0」在任何批大小下都是可靠的异常信号；不设满批条件（卡住行数 < 100
 * 恰恰是满批条件漏掉、且最该兜底的那类）。阈值 3 容忍偶发写锁抖动。
 */
const ZERO_PROGRESS_BATCH_LIMIT = 3;

/** 升级首启同步收尾预算默认值（超预算残余转后台，spec 拍板 ≤60s）。 */
export const DEFAULT_REF_UNREF_SYNC_BUDGET_MS = 60_000;

/**
 * 状态采样节流窗口（同兄弟任务）：全表 COUNT（谓词无部分索引，D13）=
 * 迁移期 IO 风暴，窗口内重复采样回放上次值。取 3s。
 */
const STATUS_SAMPLING_THROTTLE_MS = 3000;

/**
 * 谓词 SQL 片段（**三处同条件**，幂等可续跑的地基）。
 *
 * @remarks 「带引号键形态 + 非压缩行」两条理由见文件头谓词段。之所以抽成常量
 * 而不是三处各写一遍：同条件是本任务的地基，抽成常量后任何一处漏改都在
 * review 期肉眼可见。
 */
const PREDICATE_SQL = `content_json LIKE '%"contentRef"%' AND content_blob IS NULL`;

/** 回迁状态。 */
export interface MessageRefUnrefStatus {
  /** 已完成：KKV 标记已置位，或谓词计数为 0；本采样不做入口自愈探测（自愈只在回迁入口）。 */
  readonly done: boolean;
  /** 剩余待回迁行计数（进行中态的「剩余 N 条」）。 */
  readonly pendingCount: number;
}

/** {@link runMessageRefUnref} 入参。 */
export interface RunMessageRefUnrefOptions {
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

/** {@link runMessageRefUnref} 结果。 */
export interface MessageRefUnrefRunResult {
  /** true = 谓词已空（或仅剩已判无需回迁的行）且完成标记已置。 */
  readonly done: boolean;
  /** 本次调用实际回迁的行数（只计 UPDATE `changes > 0` 的落库行）。 */
  readonly unrefedCount: number;
  /**
   * 本次调用判为坏行（parse 失败 / revision 缺失 / 明文不可取 /
   * status=deleted）的行数。
   *
   * @remarks 坏行**照常落错误占位并移除 contentRef**（本来就取不回明文，
   * 留着只会每次冷启动重跑一遍注定失败的路径），但仍记入标记的
   * `failedIds` 供运维直接定位。
   *
   * @remarks 「标记已置 + 探针无命中」的短路路径下，本字段与
   * {@link MessageRefUnrefRunResult.noRefBlockCount} 回放**标记里的快照**
   * （与解压兄弟任务回放 `failedCount` 同款口径），不是「本次调用的增量」。
   */
  readonly failedCount: number;
  /**
   * 谓词假阳性行数（命中谓词但 parse 后无引用块，典型是正文里出现了
   * `contentRef` 字面量）。
   *
   * @remarks 与 `failedCount` **刻意分开计数**：前者是「已判无需回迁」的
   * 误报行（数据没问题，是谓词宽了），后者是「真取不回明文」的数据问题。
   * 混成一个数就没法在日志里区分「预期内的宽谓词」与「需人工关注」。
   */
  readonly noRefBlockCount: number;
  /**
   * 本轮是否被零进展护栏或收尾谓词校验主动拦停。
   *
   * @remarks `true` 仅表示「继续立即重跑也不会有任何进展」的异常态：此时
   * 完成标记未置、`done = false`，调用方应本进程停止重试（下个冷启动再
   * 试），而不是零延迟续跑把空转放大成热循环。
   */
  readonly stalled: boolean;
  /**
   * 本轮是否因解压兄弟任务的完成标记未置而**让位停手**（D19）。
   *
   * @remarks 语义与 {@link MessageRefUnrefRunResult.stalled} 同款、处置同款
   * （warn 后本进程收手、下个冷启动按 KKV 重试），但成因不同：不是异常，
   * 而是「压缩行还没解回明文、判据还不成立」的正常交叠态。**调用方不得把
   * 它当预算耗尽零延迟续轮**——解压兄弟任务在本进程里根本不调度，续轮只会
   * 空转到下一个冷启动。
   */
  readonly deferred: boolean;
}

/** 完成标记值（JSON）。 */
interface MessageRefUnrefDoneMarker {
  /** 置标记时间。 */
  readonly at: string;
  /** 置标记时累计的真坏行数（需人工关注的行）。 */
  readonly failedCount: number;
  /** 置标记时累计的谓词假阳性行数（已判无需回迁）。 */
  readonly noRefBlockCount: number;
  /**
   * 置标记时本轮确认「留在谓词里、无需再试」的主键清单。
   *
   * @remarks 两类入清单：**谓词假阳性行**（永留谓词，入口探针必须排除，
   * 否则永不收敛）与**已落错误占位的坏行**（观测面：运维据此定位数据问题
   * 行；已不在谓词里，排除它是无害的冗余）。坏行量少，不设上限。
   */
  readonly failedIds: readonly string[];
}

/** 单个引用块的明文解析结果。 */
type BlockPlain =
  | { readonly ok: true; readonly plain: string }
  | { readonly ok: false; readonly reason: string };

/** 单行回迁计划。 */
type RowPlan =
  /** 可写回：整行新 JSON + 该行应 −1 的 read 引用（aggregateReadRefs 口径）+ 取不回明文的坏块数。 */
  | {
      readonly kind: "write";
      readonly json: string;
      readonly refs: readonly ReadRefPointer[];
      /** 本行内取不回明文、已落错误占位的引用块数（>0 即算坏行，见 D12）。 */
      readonly badBlockCount: number;
    }
  /** 谓词假阳性：命中但无引用块——不写库、记 failedIds。 */
  | { readonly kind: "noRefBlocks" }
  /** 真坏行：正文解析不出来，无从写回——记 failedIds。 */
  | { readonly kind: "unparsable"; readonly reason: string };

/** 谓词 COUNT（与批查询、UPDATE WHERE 同条件）。 */
async function countPendingRows(conn: TdbcConnection): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM chat_message WHERE ${PREDICATE_SQL}`
  );
  return Number(rows[0]?.n ?? 0);
}

/** 压缩行残留计数（deferred warn 的附注数据，不参与否决判定）。 */
async function countCompressedRows(conn: TdbcConnection): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chat_message WHERE content_blob IS NOT NULL"
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * 未完成态采样缓存（按连接实例隔离）——只缓存「标记未置、真跑了谓词
 * COUNT」的采样值；标记已置的快路径在缓存检查**之前**就返回。
 */
let statusSamplingThrottleCache = new WeakMap<
  TdbcConnection,
  { at: number; value: MessageRefUnrefStatus }
>();

/**
 * 测试专用：清空状态采样节流缓存（WeakMap 无清空 API，直接换新实例）。
 *
 * @remarks 共享连接的测试用例之间必须调用（生产代码不得调用）。
 */
export function __resetMessageRefUnrefForTests(): void {
  statusSamplingThrottleCache = new WeakMap();
}

/**
 * 读 KKV 完成标记（两段式 module/key）。
 *
 * 标记值向后兼容：非 JSON / 旧版纯 ISO 时间戳字符串一律按
 * `{ failedCount: 0, noRefBlockCount: 0, failedIds: [] }` 处理——不抛、不刷屏
 * （口径照搬兄弟任务）。`failedIds` 缺失或非数组同样视空数组。
 */
async function readDoneMarker(
  conn: TdbcConnection
): Promise<MessageRefUnrefDoneMarker | null> {
  const kkv = new SqliteKkvRepository(conn);
  const entry = await kkv.get(
    MESSAGE_REF_UNREF_KKV_MODULE,
    MESSAGE_REF_UNREF_KKV_KEY
  );
  if (entry == null) {
    return null;
  }
  const fallback: MessageRefUnrefDoneMarker = {
    at: entry.value,
    failedCount: 0,
    noRefBlockCount: 0,
    failedIds: [],
  };
  try {
    const parsed = JSON.parse(entry.value) as Partial<MessageRefUnrefDoneMarker>;
    return {
      at: typeof parsed.at === "string" ? parsed.at : entry.value,
      failedCount:
        typeof parsed.failedCount === "number" &&
        Number.isFinite(parsed.failedCount)
          ? parsed.failedCount
          : 0,
      noRefBlockCount:
        typeof parsed.noRefBlockCount === "number" &&
        Number.isFinite(parsed.noRefBlockCount)
          ? parsed.noRefBlockCount
          : 0,
      failedIds: Array.isArray(parsed.failedIds)
        ? parsed.failedIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return fallback;
  }
}

/**
 * 入口自愈探测：库里还有没有**可回迁**的引用行。
 *
 * @param failedIds 标记里已知的「留在谓词里、无需再试」主键——假阳性行永留
 * 谓词，不排除会让探针恒命中、每次冷启动白扫两遍全表且永不收敛。为空时走
 * 原谓词快路径。
 *
 * @remarks **排除集合在 JS 侧按 Set 判定**（不得展开成 SQL 的 `id NOT IN
 * (?,?,…)`）：
 *
 * - 展开成绑定参数会撞 `SQLITE_MAX_VARIABLE_NUMBER`（默认 32766）——大库的
 *   假阳性行足够多时异常发生在入口最前方，每次冷启动硬失败、迁移永不推进。
 * - **更不能按批切分排除集合**（比如每 500 条切一次 `NOT IN`）：落在第 2 批
 *   及以后的假阳性行在第 1 批查询里不被排除 → 探针恒命中 → 清标记 → 全表重扫
 *   → 再撞同一批，正是本函数与文件头点名要避免的「永不收敛」循环。
 *
 * 故改为分页取候选 id（`rowid > ?` keyset + `LIMIT BATCH_SIZE`，复用搬运主循环
 * 的分页参数），在 JS 侧按 Set 排除：命中任一**不在** failedIds 里的 id 即
 * true，全部分页都排除光才 false。
 */
async function hasPendingRows(
  conn: TdbcConnection,
  failedIds: readonly string[]
): Promise<boolean> {
  if (failedIds.length === 0) {
    const rows = await conn.query<{ present: number }>(
      `SELECT 1 AS present FROM chat_message WHERE ${PREDICATE_SQL} LIMIT 1`
    );
    return rows.length > 0;
  }
  const excluded = new Set(failedIds);
  let cursor = 0;
  for (;;) {
    const rows = await conn.query<{ rowid: number; id: string }>(
      `SELECT rowid, id FROM chat_message
       WHERE ${PREDICATE_SQL} AND rowid > ?
       ORDER BY rowid
       LIMIT ${BATCH_SIZE}`,
      [cursor]
    );
    if (rows.length === 0) {
      return false;
    }
    for (const row of rows) {
      if (!excluded.has(String(row.id))) {
        return true;
      }
    }
    cursor = Number(rows[rows.length - 1]!.rowid);
  }
}

/**
 * 解压兄弟任务的完成标记是否已置（D19 收尾否决的唯一判据）。
 *
 * @remarks 刻意**不**以「库里还有压缩行」作否决：解压任务自身的完成判据允许
 * 坏行残留稳态（`leftover ≤ failedKeys` 即置标记），拿行数当判据会在解压
 * 带坏行的库上永久锁死本任务的 `unrefDone`。
 */
async function isDecompressTaskDone(conn: TdbcConnection): Promise<boolean> {
  const kkv = new SqliteKkvRepository(conn);
  const entry = await kkv.get(
    MESSAGE_DECOMPRESS_KKV_MODULE,
    MESSAGE_DECOMPRESS_KKV_KEY
  );
  return entry != null;
}

/**
 * 采样回迁状态（迁移期状态行数据源）。
 *
 * 稳态（已完成）只读 KKV 标记一次即返回，零 COUNT 成本；未完成才 COUNT
 * 全表（仅迁移期，且谓词无部分索引——D13 登记的代价）。未完成态的 COUNT 带
 * 3s 节流：采样只是进度展示，滞后一个窗口无正确性影响（搬运与完成判定都
 * 不走本缓存）。
 *
 * @remarks 标记已置位的快路径**不做**入口自愈探测：采样是高频轮询的展示面，
 * 把每次轮询都变成一次库查询不划算；标记与数据脱节的态由回迁入口（低频）
 * 在真搬时立刻自愈修正。
 */
export async function getMessageRefUnrefStatus(
  conn: TdbcConnection
): Promise<MessageRefUnrefStatus> {
  if (await readDoneMarker(conn)) {
    return { done: true, pendingCount: 0 };
  }
  const cached = statusSamplingThrottleCache.get(conn);
  if (cached != null && Date.now() - cached.at < STATUS_SAMPLING_THROTTLE_MS) {
    return cached.value;
  }
  const pendingCount = await countPendingRows(conn);
  const status: MessageRefUnrefStatus = {
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

/** 存量引用块的定位标签（warn 文案用，兼作人工排查线索）。 */
function describeRef(ref: ReadResultRef | SkillResultRef): string {
  return ref.kind === "skill"
    ? `skill ${ref.action} 引用 ${ref.path} (entryId=${ref.entryId}, version=${ref.version})`
    : `read 引用 ${ref.path} (entryId=${ref.entryId}, version=${ref.version})`;
}

/**
 * 单个引用块取明文：`findMetaByEntryAndVersion` 先判 status/行缺失（不解
 * blob），再 `findByEntryAndVersion` 取明文。
 *
 * @remarks hash 不匹配**不是**坏行判据：内容寻址 hash 在本仓其余读路径上
 * 都不当强校验用，能取到明文就照常回填，只留一条 warn 线索（版本错位 /
 * 引用键错配的可观测信号）。口径与 hydrate 兜底模块逐字一致。
 */
async function resolveBlockPlain(
  ref: ReadResultRef | SkillResultRef,
  revisionRepo: VfsRevisionRepository,
  label: string
): Promise<BlockPlain> {
  try {
    const meta = await revisionRepo.findMetaByEntryAndVersion(
      ref.entryId,
      ref.version
    );
    if (meta == null) {
      return {
        ok: false,
        reason: `revision 行缺失（entryId=${ref.entryId}, version=${ref.version}）：引用悬空，ref_count 保活链已被破坏或引用键被篡改`,
      };
    }
    if (meta.status === "deleted") {
      return {
        ok: false,
        reason: `revision 已删除（entryId=${ref.entryId}, version=${ref.version}, status=deleted）：明文不可再生`,
      };
    }
    const revision = await revisionRepo.findByEntryAndVersion(
      ref.entryId,
      ref.version
    );
    if (revision == null) {
      return {
        ok: false,
        reason: `revision 行缺失（entryId=${ref.entryId}, version=${ref.version}）：元数据命中后行被并发删除或 GC`,
      };
    }
    if (revision.content == null) {
      return {
        ok: false,
        reason: `revision 明文不可取（entryId=${ref.entryId}, version=${ref.version}, status=${revision.status}）：blob 缺失或已清理`,
      };
    }
    if (
      typeof ref.contentHash === "string" &&
      ref.contentHash !== "" &&
      meta.contentHash != null &&
      meta.contentHash !== ref.contentHash
    ) {
      // hash 不匹配不算坏行：已按取到的明文回填，只留一条 warn 线索。
      console.warn(
        `[${LOG_TAG}] ${label} contentHash 与 revision 行不一致（期望=${ref.contentHash}，实际=${meta.contentHash}）：已按取到的明文回填`
      );
    }
    return { ok: true, plain: revision.content };
  } catch (error) {
    return {
      ok: false,
      reason: `读取 revision 失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 规划单行回迁：解析引用块 → 逐块取明文 → 组装整行新 JSON + 应 −1 的
 * read 引用（`aggregateReadRefs` 口径：消息内 pair 去重）。
 *
 * @param memo 同一次调用内的 `(entryId, version) → 明文` 去重缓存：同一条
 * 消息里多个块引用同一 pair 是常态（长文件分段 read），只查一次。
 *
 * @remarks **refs 计算口径走 `parseMessageContent`（不动）**：对账口径必须与
 * +1 侧逐字一致，不能因为写回改了就换口径。
 *
 * @remarks **写回对 raw 原始 blocks 原地 patch**（D-01 的销毁面收敛）：若拿
 * parse 的结果 `stringify` 写回，一行回迁 = 整行所有块被不可逆归一化——
 * `parseBlocksArray` 会丢弃空 text 块、块上的白名单外字段（`meta` 只保
 * `subagentSessionId`/`skillRef`）一并被吞掉。原地 patch 只动带 `contentRef`
 * 的块：换 `content`、`delete contentRef`，其余块原样保留。
 *
 * 两侧**不得按下标对应**（raw 与 parsed 的块数在含空 text 块的行上整体错位）：
 * 引用块在 raw 上就地按自身 `raw.contentRef` 判定，明文按 `(entryId, version)`
 * 从 memo 取。前置条件即 `raw.type === "tool_result" && raw.contentRef != null`
 * ——正文里恰好带 `contentRef` 字段的 text 块不得误改（与 D12 假阳性同款风险）。
 */
async function planRow(
  id: string,
  contentJson: string,
  revisionRepo: VfsRevisionRepository,
  memo: Map<string, BlockPlain>
): Promise<RowPlan> {
  let content: MessageContent;
  try {
    content = parseMessageContent(contentJson);
  } catch (error) {
    return {
      kind: "unparsable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const refs = aggregateReadRefs([content]);
  if (refs.length === 0) {
    return { kind: "noRefBlocks" };
  }

  // raw 侧与 parsed 侧各自独立：refs 由 parsed 算（口径不动），写回只 patch raw。
  // parse 已通过 → 原文必然是合法 JSON 对象且带 blocks 数组，JSON.parse 不再抛。
  const raw = JSON.parse(contentJson) as { blocks: unknown[] };
  let badBlockCount = 0;
  for (const rawBlock of raw.blocks) {
    if (
      typeof rawBlock !== "object" ||
      rawBlock === null ||
      Array.isArray(rawBlock)
    ) {
      continue;
    }
    const block = rawBlock as Record<string, unknown>;
    if (block.type !== "tool_result" || block.contentRef == null) {
      continue;
    }
    const ref = block.contentRef as ReadResultRef | SkillResultRef;
    const label = describeRef(ref);
    const key = `${ref.entryId}:${ref.version}`;
    let resolved = memo.get(key);
    if (resolved === undefined) {
      resolved = await resolveBlockPlain(ref, revisionRepo, label);
      memo.set(key, resolved);
    }
    if (resolved.ok) {
      // 原地赋值：`content` 已是原块的键，赋值不改键序（既有全等断言依赖）。
      block.content = JSON.stringify({
        path: ref.path,
        content: resolved.plain,
      });
    } else {
      badBlockCount += 1;
      console.warn(`[${LOG_TAG}] chat_message.id=${id} ${label} ${resolved.reason}`);
      block.content = JSON.stringify({
        path: ref.path,
        error: `${resolved.reason}；回迁已落错误占位，正文不可恢复`,
      });
    }
    delete block.contentRef;
  }

  // −1 口径与 +1 侧逐字对齐：对**回迁前**的正文聚合，一 pair 一次 −1
  // （同消息多块同 pair 不多减）。坏块的 pair 也计入——消息同样不再持有
  // 该引用；命不中的 pair（行缺失 / 前值不足夹逼未命中）由单行事务里的
  // 「−1 之前前值」warn 记下成因。
  return {
    kind: "write",
    json: JSON.stringify(raw),
    refs,
    badBlockCount,
  };
}

/**
 * −1 之前的坏行预警（D15 第三子句）：在**减之前**把 `plan.refs` 的前值查回来，
 * 行缺失或前值不足 `ABS(delta)` 的 pair 逐条 `console.warn`。
 *
 * @param refs `aggregateReadRefs` 口径的聚合结果，`count` 即该 pair 本行的
 * 实际减量（`adjustReadRefCount` 按 `delta × count` 分桶发出，聚合后单 pair 的
 * delta 可为 −2/−3）。
 *
 * @remarks 判据锚在「−1 之前的前值不足」或「行缺失」，**不是**「减完等于 0」：
 * v1.5.29 的 read +1 会叠加在 live head +1 之上，「读过 N 次后又被编辑」的旧
 * revision 迁移前 ref_count=N、逐条 −1 归零是**正确终态**——按减完判 0 会在
 * 存量库上打出与存量行同量级的 warn 风暴。
 *
 * @remarks 坏块行（`badBlockCount > 0`）**跳过**：成因已由 planRow 的块级 warn
 * 记过，不重复告警。
 */
async function warnInsufficientRefBeforeDecrement(
  tx: TdbcConnection,
  messageId: string,
  refs: readonly (ReadRefPointer & { readonly count?: number })[],
  badBlockCount: number
): Promise<void> {
  if (badBlockCount > 0 || refs.length === 0) {
    return;
  }
  // 复用 500 分块（与 repository 侧同量级），避免单条 SQL 绑定过多变量。
  const CHUNK_SIZE = 500;
  for (let offset = 0; offset < refs.length; offset += CHUNK_SIZE) {
    const chunk = refs.slice(offset, offset + CHUNK_SIZE);
    const placeholders = chunk.map(() => `(?,?)`).join(",");
    const params: unknown[] = [];
    for (const ref of chunk) {
      params.push(ref.entryId, ref.version);
    }
    const rows = await tx.query<{
      entry_id: number;
      version: number;
      ref_count: number;
    }>(
      `SELECT entry_id, version, ref_count FROM vfs_revision
       WHERE (entry_id, version) IN (${placeholders})`,
      params
    );
    const current = new Map<string, number>();
    for (const row of rows) {
      current.set(
        `${Number(row.entry_id)}:${Number(row.version)}`,
        Number(row.ref_count)
      );
    }
    for (const ref of chunk) {
      const delta = ref.count ?? 1;
      const prev = current.get(`${ref.entryId}:${ref.version}`);
      if (prev === undefined) {
        console.warn(
          `[${LOG_TAG}] chat_message.id=${messageId} −1 之前 revision 行缺失（entryId=${ref.entryId}, version=${ref.version}, delta=-${delta}）：ref_count 未减，记坏行`
        );
      } else if (prev < delta) {
        console.warn(
          `[${LOG_TAG}] chat_message.id=${messageId} −1 之前 ref_count 不足（entryId=${ref.entryId}, version=${ref.version}，前值=${prev} < |delta|=${delta}）：UPDATE 被下限夹逼拦下、计数未减，记坏行`
        );
      }
    }
  }
}

/**
 * 执行一轮谓词驱动的消息引用化回迁。
 *
 * 可重入：任意时刻中断（返回/异常/杀进程）都安全——写回与 −1 同事务、UPDATE
 * WHERE 带谓词（并发重复回迁时 changes=0 自然跳过），重启后谓词重扫续跑。
 */
export async function runMessageRefUnref(
  conn: TdbcConnection,
  options: RunMessageRefUnrefOptions = {}
): Promise<MessageRefUnrefRunResult> {
  // 启动先查标记，**但先付一次自愈探测**（防标记闩锁）：标记随整库快照
  // travels 且写死不校验时，pull 回灌的旧快照会把「已回迁」标记带到一个
  // 仍是引用形态的库上——不清标记则该库永久停在引用态。
  const marker = await readDoneMarker(conn);
  if (marker != null) {
    if (!(await hasPendingRows(conn, marker.failedIds))) {
      return {
        done: true,
        unrefedCount: 0,
        failedCount: marker.failedCount,
        noRefBlockCount: marker.noRefBlockCount,
        stalled: false,
        deferred: false,
      };
    }
    console.warn(
      `[${LOG_TAG}] 完成标记已置位但库中仍有引用行（快照回灌等标记与数据形态脱节），已清标记续搬`
    );
    try {
      await new SqliteKkvRepository(conn).delete(
        MESSAGE_REF_UNREF_KKV_MODULE,
        MESSAGE_REF_UNREF_KKV_KEY
      );
    } catch (error) {
      // 清失败不阻断：本轮照样真搬，搬完会重新置标记（幂等覆盖）。
      console.warn(
        `[${LOG_TAG}] 清除失配的完成标记失败，继续回迁（收尾会重新置标记）：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const budgetMs = options.syncBudgetMs ?? DEFAULT_REF_UNREF_SYNC_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const revisionRepo = new SqliteVfsRevisionRepository(conn);
  const memo = new Map<string, BlockPlain>();
  let unrefedCount = 0;
  let failedCount = 0;
  let noRefBlockCount = 0;
  /** 本轮确认「无需再试」的主键全集（写标记 failedIds：坏行 + 假阳性行）。 */
  const failedKeys = new Set<string>();
  /**
   * 本轮**留在谓词里**的主键（仅假阳性行）——收尾残留校验的比对基准。
   *
   * @remarks 刻意与 `failedKeys` 分开：坏行已落错误占位、**已退出谓词**，
   * 拿它去放宽残留校验等于给「写回静默不生效」的白白送额度。
   */
  const residualKeys = new Set<string>();
  /** 连续零进展批计数（护栏用）。 */
  let zeroProgressBatches = 0;
  // keyset 游标：初值 0 安全（rowid 恒为正）。只用于本轮加速，不承担完成
  // 判定——完成判定仍以下方收尾的谓词 COUNT 为准。
  let cursor = 0;

  for (;;) {
    if (options.shouldPause?.()) {
      return {
        done: false,
        unrefedCount,
        failedCount,
        noRefBlockCount,
        stalled: false,
        deferred: false,
      };
    }

    // 每批 ≤100 行：取 rowid/id/content_json（回迁源）。
    const rows = await conn.query<{
      rowid: number;
      id: string;
      content_json: string;
    }>(
      `SELECT rowid, id, content_json FROM chat_message
       WHERE ${PREDICATE_SQL} AND rowid > ?
       ORDER BY rowid
       LIMIT ${BATCH_SIZE}`,
      [cursor]
    );
    if (rows.length === 0) {
      break;
    }

    // 批内统计：实际落库行数 / 新增失败行数（护栏的输入）。
    let batchChanges = 0;
    let newFailures = 0;

    for (const row of rows) {
      const plan = await planRow(row.id, row.content_json, revisionRepo, memo);

      if (plan.kind === "noRefBlocks") {
        // 谓词假阳性（D12 双保险之二）：命中但没有引用块（典型是正文里恰好
        // 出现 `contentRef` 字面量）。**不下发 UPDATE**——既不能改用户正文
        // 去掉那个词（改用户数据，明确不可做），也不能靠同值 UPDATE 让行
        // 退出谓词（那会让 changes 恒 1、零进展护栏永不触发、调度层零延迟
        // 续跑成无界热循环）。记 failedIds 让收尾校验与入口探针都放行它。
        failedKeys.add(row.id);
        residualKeys.add(row.id);
        noRefBlockCount += 1;
        newFailures += 1;
        console.warn(
          `[${LOG_TAG}] chat_message.id=${row.id} 命中谓词但正文里没有引用块（谓词宽了），已判无需回迁`
        );
        continue;
      }

      if (plan.kind === "unparsable") {
        // 真坏行：正文连 parse 都过不去，无从写回。行原样保留（读路径对它
        // 双形态自愈），只跳本行——抛出去会中断整轮、完成标记永远置不上、
        // 每次冷启动白烧预算。它**留在谓词里**，故进残留校验基准集。
        failedKeys.add(row.id);
        residualKeys.add(row.id);
        failedCount += 1;
        newFailures += 1;
        console.warn(
          `[${LOG_TAG}] chat_message.id=${row.id} 正文解析失败，跳过回迁：${plan.reason}`
        );
        continue;
      }

      // 单条短事务：**写回 content_json 与 ref_count −1 同事务**（D15）。
      // 回调里只喂 tx 句柄（驱动 AsyncMutex 不可重入，误用外层 conn 会死锁）。
      // UPDATE WHERE 带谓词防并发重复回迁（另一端/上一轮已搬走时 changes=0）。
      const result = await conn.transaction(async (tx) => {
        const updated = await tx.execute(
          `UPDATE chat_message
           SET content_json = ?
           WHERE id = ? AND ${PREDICATE_SQL}`,
          [plan.json, row.id]
        );
        if (updated.changes > 0) {
          // −1 之前先查前值：行缺失 / 前值 < |delta| 的 pair 记 warn（D15 第三
          // 子句的「区分坏行」）。必须与 repository 侧的下限夹逼同批落地——
          // 两者是同一判据的两端（夹逼决定 UPDATE 命不中，这里解释为什么不中）。
          await warnInsufficientRefBeforeDecrement(
            tx,
            row.id,
            plan.refs,
            plan.badBlockCount
          );
          await adjustReadRefCount(
            new SqliteVfsRevisionRepository(tx),
            plan.refs,
            -1
          );
        }
        return updated;
      });
      // 只计实际落库的行走数：谓词命中但 changes=0 说明已被并发端搬走
      // （或驱动写回不生效——那是护栏与收尾校验要抓的异常）。
      if (result.changes > 0) {
        unrefedCount += 1;
        batchChanges += 1;
      }
      // 块级坏行（revision 缺失 / 明文不可取 / status=deleted）随本行落库：
      // 占位已写回、行已退出谓词，但仍计入坏行数与标记 failedIds（观测面，
      // 运维据此定位需人工关注的数据问题行）。**不进 residualKeys**——它不
      // 留在谓词里。
      if (plan.badBlockCount > 0 && result.changes > 0) {
        failedKeys.add(row.id);
        failedCount += 1;
        newFailures += 1;
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
        console.warn(
          `[${LOG_TAG}] 连续 ${ZERO_PROGRESS_BATCH_LIMIT} 批回迁零进展，疑似谓词原地打转，本轮中止`
        );
        return {
          done: false,
          unrefedCount,
          failedCount,
          noRefBlockCount,
          stalled: true,
          deferred: false,
        };
      }
    } else {
      zeroProgressBatches = 0;
    }

    // 批间让步：预算检查放批粒度（行粒度事务已足够短）。
    if (Date.now() >= deadline) {
      return {
        done: false,
        unrefedCount,
        failedCount,
        noRefBlockCount,
        stalled: false,
        deferred: false,
      };
    }
    await yieldToEventLoop();
  }

// 收尾让位判定（deferred）**前置于**残留下沉校验（D19）：解压兄弟任务未完成
  // 时，压缩行可能被它解回明文、那些行是在本轮游标扫过之后才进入谓词的——
  // 先判残留会把「正常交叠态」谎报成 stalled、warn 说谎且三端本进程 return
  // 不再重试。解压未完成一律先让位（deferred），解压已完成才允许用 leftover
  // 判 stalled。**两者同为不置标记的显式失败路径**，谁先判都不违反收尾前
  // 不得提前 break 的红线（见文件头「收尾不变量」）。
  if (!(await isDecompressTaskDone(conn))) {
    const compressedLeft = await countCompressedRows(conn);
    console.warn(
      `[${LOG_TAG}] 解压兄弟任务（${MESSAGE_DECOMPRESS_KKV_MODULE}/${MESSAGE_DECOMPRESS_KKV_KEY}）尚未置完成标记，本轮回迁结果不予标记（残留压缩行 ${compressedLeft} 行，仅记数）`
    );
    return {
      done: false,
      unrefedCount,
      failedCount,
      noRefBlockCount,
      stalled: false,
      deferred: true,
    };
  }

  // 收尾谓词校验：游标扫完（rows.length === 0）后谓词必须已空或只剩本轮
  // 判为「无需回迁」的行。**不变量：leftover ⊆ residualKeys**——收尾校验只在
  // 游标扫完后可达（正常行被搬走或并发端搬走都已离开谓词；留下的只可能是
  // 本轮的假阳性行与 parse 不过的坏行），故 leftover > residualKeys.size 即异常
  // 残留（如驱动写回静默不生效）。**收尾前不得引入任何提前 break**——任何
  // 「看着扫完了」的提前退出都会让残留行被永久锁死在引用态；护栏/预算/守卫/
  // 上方 deferred 让位判定的提前 return 是显式失败路径（不置标记），不在此列。
  const leftover = await countPendingRows(conn);
  if (leftover > residualKeys.size) {
    console.warn(
      `[${LOG_TAG}] 游标已扫完但谓词仍剩 ${leftover} 行（本轮已判无需回迁、留在谓词里的 ${residualKeys.size} 行），疑似异常残留，不置完成标记`
    );
    return {
      done: false,
      unrefedCount,
      failedCount,
      noRefBlockCount,
      stalled: true,
      deferred: false,
    };
  }

  // 谓词空（或仅剩已判无需回迁的行）→ 两段式置 KKV 完成标记。失败行不阻断
  // 标记：否则每次启动都要重扫同一批行再抛一遍，任务永远收敛不了。标记值
  // 存 JSON（含失败/假阳性计数快照 + **failedIds 清单**——入口自愈探针靠它
  // 排除假阳性行，读取端解析兜底见 readDoneMarker）。
  await new SqliteKkvRepository(conn).set(
    MESSAGE_REF_UNREF_KKV_MODULE,
    MESSAGE_REF_UNREF_KKV_KEY,
    JSON.stringify({
      at: new Date().toISOString(),
      failedCount,
      noRefBlockCount,
      failedIds: Array.from(failedKeys),
    })
  );

  // **到此为止，不挂收尾维护链路**（无 VACUUM / checkpoint / 缓存 GC）——
  // 回迁是增容不是释放：库里没有可归还的 freelist 页，VACUUM 只会全库
  // 重写、白烧一次同步阻塞。
  return {
    done: true,
    unrefedCount,
    failedCount,
    noRefBlockCount,
    stalled: false,
    deferred: false,
  };
}
