/**
 * 会话流式单元编排器（SessionStreamUnitManager，React 树外）。
 *
 * 以 agent-run-manager.service.ts 为模板原样吸收其契约（Step 2；旧文件的
 * 拆除与调用方接线分别在 Step 7 / Step 6 完成）：
 * - per-session 门禁：该会话存在 starting|running 状态的单元，或
 *   abortRegistry.has(sessionId) 任一为真即拒绝（registry 是 run 在途的第二
 *   道判据，core 的 register 在 runAgentTurn 函数入口执行，受理即在途；
 *   starting 单元判据仍独立保留）；settled 单元（interrupted/finished/failed，
 *   含宽限中）不阻塞新 run——interrupted 单元在 startRun 时被替换/吸收（删旧
 *   建新：run_id 更新、状态机回 starting、partial/注入标记与 metrics 随新
 *   单元天然重置），不产生双单元并存；
 * - 全局 refcount 收口：increment 在 startRun 受理路径同步执行，decrement
 *   由全量 FINISHED/FAILED 事件订阅 / finally 早退兜底驱动（不经 UI 面板的
 *   sessionId 过滤）；
 * - promise 链尾 finally 兜底：只要单元仍归本次 startRun 所有（未被事件
 *   路径收尾、未被新 run 替换）即销毁单元 + decrement——事件总线同步分发，
 *   不存在「事件还会再来双减」的组合；
 * - 收尾 runId 所有权校验：runId 不匹配的终态事件（subagent 子 run、旧连接
 *   残留）不收尾、不弹 toast；
 * - 三桥注入：uiBridge（失败 toast）、prefBridge（完成通知/保活开关）、
 *   scopeBridge（通知点按切会话）；桥未注入期间降级，refcount 与单元维护
 *   不依赖桥，始终生效；
 * - 完成通知（AppState 后台口径、失败 5 分钟合并）与保活前台服务起停：
 *   复用 services/agent-finished-notification 的既有封装，不重写；
 * - dispose 契约：退订事件总线、按「活跃单元」逐个递减模块级 refcount
 *   （settled 单元收尾时已减过，不双减；decrement 对 0 幂等）、停前台服务。
 *
 * 相对模板的新增面（单元化）：units 注册表（LRU 上限
 * SESSION_STREAM_MAX_SETTLED_UNITS，超限淘汰最旧 settled 单元）、settled 宽限
 * 销毁、投影订阅 API subscribe(listener) + snapshot(sessionId)、hydrated
 * 标志位（水合前投影 null——水合流程在 Step 5 填实，本节点 manager 构造
 * 后由装配方/测试显式调 markHydrated）。runtime 装配接线在 Step 6。
 *
 * Step 3 新增：流式事件订阅（TEXT/THINKING_DELTA、STEP_COMMITTED）按
 * sessionId 路由进单元管线（delta 累积/step 边界/缓冲/注入/指标归单元
 * 字段），通知节拍对齐单元 apply（64ms）；child-created 与 pendingChildren
 * 链接语义同批填实。runtime 装配接线在 Step 6。
 *
 * Step 4 新增：消息管线消费面路由——loadSessionTailMessages（tail 加载，
 * 含缓存命中/回源语义）/loadOlderSessionMessages（分页）/requestForceSnapshot
 * （force 快照直发驱动）；runtime.messages 以窄口透传进单元（Step 4 起
 * Pick 扩展 messages 字段，构造处原样传入即可）。
 *
 * Step 5 新增：run 态持久化（core session_run_state 表，服务经构造参数
 * 可注入——不注入即纯内存模式）——受理写 starting 行、RUN_STARTED 写
 * running 行、delta 进 250ms 写通 coalescer（step 边界立即刷、大载荷
 * 降频 1s）、收尾 settle 落库 + manager 级 settled 投影（常驻 map，供
 * 「上次生成」跨重启读取）；重启水合（hydrate，单飞幂等）扫 starting/
 * running 行建 interrupted 单元、扫 settled 行回填投影；forgetSession
 * 供会话删除链路清内存现场（持久层行由 core 删除事务联动清理）。真装配
 * 接线在 Step 6。
 *
 * Step 6 新增（屏幕订阅接线的消费面与缺口补全）：
 * - 消费型单元：RUN_STARTED 到达时该会话无单元（subagent 子会话 run）即
 *   lazy 建立接收型单元，供子会话屏订阅投影与单一注入实现落点；不占
 *   refcount、不写持久层、收尾不发通知（这些语义只覆盖经 startRun 发起
 *   的 run）；
 * - activeSessionIds()：活跃 run 会话列举（会话列表「停止生成」判活）；
 * - requestStreamReset(sessionId)：广播 reset-stream 控制消息（消息操作后
 *   清流式显示的屏幕驱动入口）。
 *
 * Step 7 新增：收尾校准探针接线（services/run-finish-calibration-probe，
 * 自旧 use-run-resume-probe 收尾方向迁入的最小版）——低频轮询 + 前台回焦
 * 校准「running 单元 + registry 无注册」的悬挂现场（终态事件丢失兜底），
 * 走 finishRun('failed') 等效收尾；starting 单元不参与（runId 未回填，
 * 判据与 registry 注册时机无关）。
 *
 * Step 7 新增（消息面收口，方案 a）：无单元会话的消息面由本 manager 承担
 * ——loadSessionTailMessages/loadOlderSessionMessages 的 idle 路径（view
 * cache 命中即采纳 / miss 回源 messageStore 窄窗 + hasMore 探针）、
 * readMessagesSnapshot 统一读取口（有单元走投影、空投影回落 idle）、
 * hydrateSessionMessages 同步水合（会话切换防闪）、单元销毁时投影消息面
 * 交接进 idle 视图（宽限销毁/LRU/替换沿不断档）。useChatTabMessages 的
 * 数据管线随之退役，Provider 消息显示单一来源本 manager。
 *
 * @module services/session-stream-unit-manager
 */
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  EVENT_AGENT_STREAM_USAGE,
  EVENT_SUBAGENT_CHILD_SESSION_CREATED,
} from '@novel-master/core/events';
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
  AgentStepCommittedPayload,
  AgentStreamTextDeltaPayload,
  AgentStreamThinkingDeltaPayload,
  AgentStreamToolUsePayload,
  AgentStreamUsagePayload,
  SubagentChildSessionCreatedPayload,
} from '@novel-master/core/events';
import type {
  ChatMessageData,
  ComposerDraftTokenRange,
  MessageAttachment,
  SendAnnotateDraft,
} from '@novel-master/core/chat';
import type {EventSubscription} from '@novel-master/core/events';
import {
  parseStreamFinalRateSnapshot,
  serializeStreamFinalRateSnapshot,
} from '@novel-master/core/format';
import {
  SESSION_KKV_DOMAIN_STREAM_METRICS as METRICS_DOMAIN,
  STREAM_METRICS_FINAL_RATE_KEY as FINAL_RATE_KEY,
} from '@novel-master/core/session-kkv';
import type {SessionKkvService} from '@novel-master/core/session-kkv';
import type {
  SessionRunState,
  SessionRunStateSettleInput,
  SessionRunStatus,
} from '@novel-master/core/session-run-state';
import {
  decrementAgentActive,
  incrementAgentActive,
} from '@/runtime/agent-activity';
import {runAgentTurn as defaultRunAgentTurn} from '@/services/agent-run.service';
import {bootTimingLog, timingLog} from '@/debug/run-timing';
import {
  notifyAgentRunFinished,
  navigateToChatTabFromNotification,
  registerAgentNotificationTapHandling,
  startAgentKeepAliveService,
  stopAgentKeepAliveService,
} from '@/services/agent-finished-notification';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {
  SessionStreamUnit,
  isSessionStreamUnitSettled,
  SESSION_STREAM_MESSAGES_PAGE_SIZE,
  STREAM_ROW_IDS_LIMIT,
} from '@/services/session-stream-unit';
import type {
  SessionStreamRunSettledStatus,
  SessionStreamUnitMetrics,
  SessionStreamUnitView,
  SessionStreamWebviewHandle,
} from '@/services/session-stream-unit';
import {createRunStateWritethrough} from '@/services/run-state-writethrough';
import type {RunStateWritethrough} from '@/services/run-state-writethrough';
import type {IncrementalTokenCounter} from '@novel-master/core/format';
import {
  createRunFinishCalibrationProbe,
  type RunFinishCalibrationProbe,
} from '@/services/run-finish-calibration-probe';
import {
  getSessionViewCache,
  hydrateWindowFromCache,
  sessionViewCacheKey,
  setSessionViewCache,
  type SessionViewCache,
} from '@/services/chat-session-view-cache';
import {createLruMap, type LruMap} from '@/services/scope-key-cache';
import {prependOlderMessages} from '@/services/message-paging';
import {createQuantumYield} from '@/services/yield-quantum';
import {createLogger} from '@novel-master/core/log';
import {AppState} from 'react-native';

/**
 * reset-stream 的下一拍 force-snapshot 目标（P0-4）：只在该会话仍是同一
 * 单元且未销毁时补发，避免捕获的旧单元把过期快照推给已替换的宿主。
 */
type ForceSnapshotTarget = {
  readonly sessionId: string;
  readonly unit: SessionStreamUnit;
};

/** finishRun 的收尾结果（终态 + 可选失败文案）。 */
type RunOutcome = {
  readonly status: SessionStreamRunSettledStatus;
  readonly errorMessage?: string;
};

/** 编排器日志 scope（detail 只放 id/status/err，正文永不进日志）。 */
const log = createLogger('chat.stream-manager');

/** settled 单元并存的 LRU 上限（含宽限中的与水合常驻的；活跃单元不占槽）。 */
const SESSION_STREAM_MAX_SETTLED_UNITS = 8;

/**
 * 两张「按 sessionId 键、无项目维度」的常驻表（settled 投影 / 无单元消息面）的
 * LRU 上限。与 `chat-session-view-cache` 的 500 同口径（会话视图缓存的既有上限），
 * 不另造数字：这两张表存的是消息全文/投影，长期使用会单调增长，必须有上界。
 *
 * 风险面：超过上限后「很久没打开过的会话」的消息面可能被淘汰，重进时走
 * `loadSessionTailMessages` / `hydrateSessionMessages` 重新填充；活跃/刚结束的
 * run 一定在 `units` 里（有独立的 SESSION_STREAM_MAX_SETTLED_UNITS 保护），
 * 不受此上限影响。
 */
const SESSION_STREAM_MAX_MESSAGE_VIEWS = 500;

/** 空接管映射共享实例（idle 视图缺省值；避免每次新建空 Map 打穿引用比较）。 */
const EMPTY_STREAM_ROW_IDS: ReadonlyMap<string, string> = new Map();

/**
 * 无单元会话消息面在 LRU 表内的**存储形态**：只存消息面本身。
 *
 * in-flight（`loadingMoreMessages`）刻意不入表——LRU 是有界淘汰的，而
 * `loadOlderSessionMessages` 的 idle 分支读-改-写跨一个 `await`：标记若留在表里，别的
 * 路径灌进 CAP+1 个 sessionId 就能把本会话连标记带数据一起淘汰，await 落地
 * 时读到 null ⇒ 本次「上翻更早消息」被静默丢弃（页面永远翻不动）。
 * 标记与兜底基线都在 `idleLoadingMore`（不参与淘汰）。
 */
interface IdleMessageViewEntry {
  readonly messages: readonly ChatMessageData[];
  readonly hasMoreMessages: boolean;
  /**
   * DB message id → streamId 接管映射（单元出表时交接；idle 侧的 tail/分页
   * 刷新必须保留它，否则已接管的 assistant 行回退 DB id → remount/闪动）。
   */
  readonly streamRowIds: ReadonlyMap<string, string>;
}

/** 读口形态 = 存储形态 + 从 `idleLoadingMore` 合成的 in-flight 标记。 */
interface IdleMessageView extends IdleMessageViewEntry {
  readonly loadingMoreMessages: boolean;
}

/**
 * idle 上翻的在途态。**不参与 LRU 淘汰**（与 `units` 的
 * `SESSION_STREAM_MAX_SETTLED_UNITS` 同款保护）：条目只在一次
 * `loadOlderSessionMessages` 的 await 窗口内存活，天然受并发上翻数约束。
 */
interface IdleOlderLoadInFlight {
  /** 发起时的视图基线：await 期间本会话条目若被 LRU 淘汰，用它兜底合并。 */
  readonly base: IdleMessageViewEntry;
}

/** Manager 实际依赖的 runtime 子集（测试可传 mock）。messages 为 Step 4 消息管线所需。 */
type SessionStreamManagerRuntime = Pick<
  MobileNovelMasterRuntime,
  'eventBus' | 'abortRegistry' | 'sessions' | 'projects' | 'messages'
> & {
  /**
   * session KKV 面（冻结末值速率的落库/读回）。缺省即速率不落库——
   * 冻结值仍走内存 settled 投影，只是不跨重启（测试/极简 runtime 用）。
   */
  readonly sessionKkv?: SessionKkvService;
};

/** fire-and-forget 的 runAgentTurn 形状（测试可注入 mock）。 */
type RunAgentTurnFn = (
  runtime: SessionStreamManagerRuntime,
  scope: {projectId: string; sessionId: string},
  content: string,
  options?: SessionStreamStartOptions,
) => Promise<unknown>;

/** startRun 的 options 契约（供 ChatComposer.executeRun 等 UI 侧消费）。 */
interface SessionStreamStartOptions {
  /** 原样透传给 runAgentTurn。 */
  readonly stream?: boolean;
  readonly annotateDrafts?: readonly SendAnnotateDraft[];
  readonly allowResumeWithoutInput?: boolean;
  /**
   * D9：Composer 确认胶囊区间（**已换算到 trim 后正文坐标**；空/缺失 →
   * core 全量扫描不掩码）。core 发送挂点把这几段替换成等长空白后再全量扫描，
   * 贴邻 chip（`$A$$B$` / `@path@$技能$`）的触发符不再参与全量识别。
   */
  readonly excludedScanRanges?: readonly ComposerDraftTokenRange[];
  /**
   * Composer 显式附件（D9 区间扫描结果由此透传；core 只放行
   * `source === 'attach'`，并在合并时位于 existing 位 = 区间结果优先）。
   */
  readonly attachments?: readonly MessageAttachment[];
  /**
   * 用户消息 append 成功后回调（透传 runAgentTurn 同名回调）——
   * UI 侧在此清批注草稿与输入草稿（失败不丢草稿的既有语义不变）。
   */
  readonly onUserMessageAppended?: () => void | Promise<void>;
  /** run 终态回调（由事件订阅驱动，与 UI 面板可见性无关）。 */
  readonly onSettled?: (status: SessionStreamRunSettledStatus) => void;
}

/** startRun 同步返回的受理/拒绝结果（拒绝时带明确错误信息）。 */
type SessionStreamStartResult =
  | {readonly ok: true}
  | {readonly ok: false; readonly error: string};

/** 失败 toast 上浮桥（Manager 在 React 外，经 Provider 注入）。 */
interface SessionStreamUiBridge {
  onError(message: string): void;
}

/** 通知偏好读取桥（appUi 通道）：isNotificationEnabled = 消息通知总开关
 * （默认开）——同时管生成结束通知与生成期间常驻保活，一个开关整体启停。 */
export interface SessionStreamPrefBridge {
  isNotificationEnabled(): Promise<boolean>;
}

/** scope 同步桥：通知点按后切换会话（React 外）；读取当前会话用于去重切换。 */
interface SessionStreamScopeBridge {
  /** 当前会话 id（无会话/未就绪为 null）。 */
  getCurrentSessionId(): string | null;
  setCurrentSession(sessionId: string): Promise<void>;
}

/**
 * run 状态持久层窄口（manager 只消费这三个方法；真装配为 core 的
 * `createSessionRunStateService(conn)`，测试注入 mock）。不注入时
 * manager 无持久化行为（纯内存，Step 2-4 的既有语义）。
 */
interface SessionStreamRunStateStore {
  upsert(state: SessionRunState): Promise<void>;
  settle(input: SessionRunStateSettleInput): Promise<void>;
  listByStatuses(
    statuses: readonly SessionRunStatus[],
  ): Promise<SessionRunState[]>;
}

/**
 * manager 级 settled 投影条目：run 收尾后的「上次生成」快照。
 *
 * 常驻 map（sessionId → 条目），独立于单元生命周期：不随单元宽限销毁或
 * LRU 淘汰清除（否则单元淘汰后「上次生成」断源），仅被同会话新 run 收尾
 * 覆盖、随 forgetSession（会话删除链路）清理，或重启后由 settled 行回填。
 */
interface SessionStreamSettledProjection {
  readonly sessionId: string;
  /** 冻结的最终指标（「上次生成」的数据源）。 */
  readonly metrics: SessionStreamUnitMetrics;
  /** run 开始时刻（毫秒）；starting 阶段中断的 run 可能为 0。 */
  readonly startedAtMs: number;
  /** 收尾时刻（毫秒）；持久层回填时以 updated_at_ms 近似。 */
  readonly settledAtMs: number;
  /** 终态冻结的历时 =「上次生成」；回填时以 settledAtMs-startedAtMs 近似。 */
  readonly elapsedMs: number;
  /**
   * 收尾冻结的末值速率（token/秒）=「上次生成」的速率段数据源。
   * null = 省略速率段（无样本、旧数据、session KKV 行缺失或解析失败）。
   */
  readonly rateTokensPerSecond: number | null;
}

interface SessionStreamUnitManagerParams {
  readonly runtime: SessionStreamManagerRuntime;
  /** 测试注入用；默认走 services/agent-run.service 的包装。 */
  readonly runAgentTurn?: RunAgentTurnFn;
  /** settled(finished/failed) 的宽限销毁时长；缺省用单元模块默认值（测试可覆盖）。 */
  readonly settledGraceMs?: number;
  /** settled 单元 LRU 上限；缺省 SESSION_STREAM_MAX_SETTLED_UNITS（测试可覆盖）。 */
  readonly maxSettledUnits?: number;
  /**
   * run 状态持久层服务（可注入；真装配 Step 6 由 runtime 侧传
   * `createSessionRunStateService(conn)`）。注入后 manager 构造即异步
   * kick 水合（starting/running 行 → interrupted 单元、settled 行 →
   * settled 投影回填，完成后 markHydrated）。
   */
  readonly runStateService?: SessionStreamRunStateStore;
  /** 写通节流参数透传（测试可覆盖；缺省用模块默认 250ms/1s/1MB）。 */
  readonly writethrough?: {
    readonly intervalMs?: number;
    readonly slowIntervalMs?: number;
    readonly largePayloadChars?: number;
  };
  /**
   * 量子化让步函数（init-busy-yield Step 2）：水合逐行循环的让步点用。
   * 缺省 createQuantumYield()（16ms 时间量子 + setTimeout(0)）；测试经此
   * 注入同步 resolve 的 mock（fake timers 下无需真实定时器）。
   */
  readonly yieldQuantum?: () => Promise<void>;
  /**
   * 实时 token 估算器工厂（stream-metrics-native ②）：透传给每个单元的
   * `tokenEstimatorFactory`（正文/思考各建一条）。不注入 = 旧启发式行为
   * （`ceil(chars/3.35)`），**未收到 usage 前**与旧口径严格一致；usage 到达后
   * 按 ①「基线 + 增量」口径。
   */
  readonly tokenEstimatorFactory?: (
    sessionId: string,
  ) => IncrementalTokenCounter | null;
}

/**
 * 会话流式单元编排器：app 级单会话串行 / 跨会话并行 run 的发起门禁、
 * 事件收尾、通知与保活，以及 per-session 单元注册表（宽限销毁 + LRU）。
 *
 * 生命周期跟随 runtime：Provider retry 重建时须先 {@link dispose} 再销毁连接。
 */
export class SessionStreamUnitManager {
  private readonly runtime: SessionStreamManagerRuntime;
  private readonly runAgentTurnFn: RunAgentTurnFn;
  private readonly units = new Map<string, SessionStreamUnit>();
  private subscriptions: EventSubscription[] = [];
  /**
   * 子会话链接反查表：childSessionId → parentSessionId。
   *
   * 登记于 child-created。子会话 run 终态【不】据此摘除父单元的
   * pendingChild——并行 task 批是整批 fork-join（core 侧 runParallel 全部
   * 完成后才 append tool_results，meta.subagentSessionId 才落库），「第一个
   * 子 agent 完成 → 最慢子 agent 完成」的窗口期里先完成的任务卡两头落空
   * （pending 映射已删、result meta 未落库）会灰掉不可点；pending 映射须
   * 活到父 run 收尾，由单元 settle 内的 clearPendingChildren 统一清空。
   * 本表只用于父收尾/单元出表/forgetSession/dispose 时批量清理相关条目，
   * 防僵尸条目残留。
   */
  private readonly pendingChildParentByChild = new Map<string, string>();
  /**
   * 消费型单元登记（Step 6）：sessionId 集合——由 RUN_STARTED 的 lazy 路径
   * 建立（subagent 子会话 run）。这类单元的收尾不 decrement refcount
   * （increment 归属发起方 run 的 startRun）、不写持久层、不发完成通知。
   */
  private readonly consumptiveSessions = new Set<string>();
  private readonly settledGraceMs: number | undefined;
  private readonly maxSettledUnits: number;

  /** run 状态持久层（未注入 = 纯内存模式，不写通不水合）。 */
  private readonly runStateStore: SessionStreamRunStateStore | undefined;
  /** 写通节流参数（透传 coalescer；测试覆盖用）。 */
  private readonly writethroughOptions:
    | {
        readonly intervalMs?: number;
        readonly slowIntervalMs?: number;
        readonly largePayloadChars?: number;
      }
    | undefined;
  /** per-session 写通 coalescer（RUN_STARTED 时建、收尾/出表时收口）。 */
  private readonly writethroughs = new Map<string, RunStateWritethrough>();
  /** 水合逐行循环的量子化让步（Step 2 分片；缺省 16ms 量子）。 */
  private readonly yieldQuantum: () => Promise<void>;
  /** settled 投影常驻 map（独立于单元生命周期，见接口注释）。挂 500 LRU 防无界增长。 */
  private readonly settledProjections: LruMap<SessionStreamSettledProjection> =
    createLruMap(SESSION_STREAM_MAX_MESSAGE_VIEWS);
  /** 无单元会话的消息面（Step 7 收口：idle 会话 tail/分页的落点）。同样挂 500 LRU。 */
  private readonly idleMessageViews: LruMap<IdleMessageViewEntry> =
    createLruMap(SESSION_STREAM_MAX_MESSAGE_VIEWS);
  /**
   * idle 上翻的 in-flight 表（**不参与 LRU 淘汰**）：sessionId → 在途态。
   *
   * 为什么不放 LRU 里（CR L1-5）：`loadOlderSessionMessages` 的 idle 分支
   * 「读 LRU → 置 loadingMoreMessages → await 回源 → 读 LRU 合并写回」是
   * 跨 await 的读-改-写。标记若在 LRU 表内，窗口期内别的路径灌进
   * `SESSION_STREAM_MAX_MESSAGE_VIEWS + 1` 个 sessionId 就会把本会话条目
   * 一起淘汰 ⇒ await 落地读到 null ⇒ 本次上翻被静默丢弃、页面再也翻不动。
   * 挪出后：标记不会被淘汰，await 落地时即便条目已被淘汰也用 `base` 兜底
   * 合并并重新 set 回 LRU。
   */
  private readonly idleLoadingMore = new Map<string, IdleOlderLoadInFlight>();
  /** 水合流程的单飞 promise（构造 kick 一次；hydrate 幂等复用）。 */
  private hydratePromise: Promise<void> | null = null;
  /** 实时 token 估算器工厂（②；未注入 = 单元走启发式兜底）。 */
  private readonly tokenEstimatorFactory?:
    | ((sessionId: string) => IncrementalTokenCounter | null)
    | undefined;

  private uiBridge: SessionStreamUiBridge | undefined;
  private prefBridge: SessionStreamPrefBridge | undefined;
  private scopeBridge: SessionStreamScopeBridge | undefined;
  /** 投影变更监听：单元集合或单元状态每次变更后同步通知。 */
  private readonly listeners = new Set<() => void>();
  /** onForegroundEvent 点按监听的退订函数（dispose 时退订，防 retry 重建累积）。 */
  private offNotificationTap: (() => void) | undefined;
  /** 收尾校准探针（Step 7：事件丢失兜底；dispose 时销毁）。 */
  private calibrationProbe: RunFinishCalibrationProbe | undefined;
  /** 前台回焦触发校准的 AppState 订阅（dispose 时退订）。 */
  private calibrationAppStateSub: {remove(): void} | undefined;
  private disposed = false;
  private hydratedValue = false;

  /**
   * tool-use 事件路由（arrow 属性：eventBus 直接持引用，需要稳定 this；
   * 订阅调用因此保持单行）。
   */
  private readonly onToolUse = (payload: AgentStreamToolUsePayload): void => {
    const tool = {id: payload.id, name: payload.name, input: payload.input};
    this.units.get(payload.sessionId)?.ingestToolUse(payload.runId, tool);
  };

  /**
   * reset-stream 的下一拍 force-snapshot（P0-4）：force-snapshot 经适配器
   * 同步调宿主 sendSessionSnapshotNow，它起手读 Provider 的 streamingRows
   * 闭包——必须等 setUnitView 提交后的下一拍再发，否则「清空后的快照」
   * 仍带旧 partial。
   */
  private readonly forceSnapshotSoon = (target: ForceSnapshotTarget): void => {
    const sameUnit = this.units.get(target.sessionId) === target.unit;
    if (sameUnit && !target.unit.isDestroyed()) {
      target.unit.requestForceSnapshot();
    }
  };

  constructor(params: SessionStreamUnitManagerParams) {
    this.runtime = params.runtime;
    // 默认实现的完整 options 类型比 SessionStreamStartOptions 宽，调用点只传子集，安全断言。
    const defaultTurn = defaultRunAgentTurn as RunAgentTurnFn;
    this.runAgentTurnFn = params.runAgentTurn ?? defaultTurn;
    this.settledGraceMs = params.settledGraceMs;
    const settledCap = SESSION_STREAM_MAX_SETTLED_UNITS;
    this.maxSettledUnits = params.maxSettledUnits ?? settledCap;
    this.runStateStore = params.runStateService;
    this.writethroughOptions = params.writethrough;
    this.yieldQuantum = params.yieldQuantum ?? createQuantumYield();
    this.tokenEstimatorFactory = params.tokenEstimatorFactory;

    // 全量订阅 run 生命周期事件（不经 UI 面板过滤）与流式事件（Step 3）：
    // 按 sessionId 路由进对应单元的管线方法——无单元（子会话 run / 旧连接
    // 残留）自然落空。delta 高频不触发投影通知，通知由单元的 apply 节拍
    // （64ms）回调 onProjectionChanged 驱动；delta 生效（ingest 返回 true）
    // 即把最新快照 append 进该会话的写通 coalescer（250ms 合并；settled/
    // interrupted 单元的陈旧 delta 被 ingest 守卫拦截，不产生持久层写）。
    const bus = this.runtime.eventBus;
    this.subscriptions = [
      // RUN_STARTED 只做单元状态迁移与 runId 回填，不碰 refcount。
      bus.subscribe(
        EVENT_AGENT_RUN_STARTED,
        (payload: AgentRunStartedPayload) => {
          const {sessionId, projectId} = payload;
          timingLog(`RUN_STARTED arrived (s=${sessionId.slice(0, 4)})`);
          let unit = this.units.get(sessionId);
          if (unit == null) {
            // Step 6 消费型单元：非本 manager 发起的 run（subagent 子会话 run）。
            // 子会话屏订阅 manager 取投影/注入，需要子会话 run 有单元落点；
            // 该类单元不占 refcount（refcount 归属发起方 run 的 startRun）、
            // 不写持久层（session_run_state 行只记录经 startRun 发起的 run）。
            unit = this.adoptConsumptiveUnit(sessionId, projectId);
          }
          if (!unit.markRunning(payload.runId)) {
            // 消费型子会话的 run 复用（同一 childSessionId 连跑两轮）会撞上仍在宽限期内的
            // settled 旧单元；不替换吸收的话后续 delta / STEP / FINISHED 全被 runId 守卫丢掉，
            // 子会话屏只能看到首轮的旧内容。发起型 run 的 settled 单元不在此列——那由
            // startRun 负责替换，这里复活会绕过持久层口径。
            //
            // 同一个 runId 的重复 RUN_STARTED（真机轮曾有「回填双发」）不替换：该 runId 的
            // FINISHED 已被消费，重建出的 running 单元等不到第二次终态 → 屏上停止按钮不消失、
            // activeSessionIds 误报、单元永不进宽限销毁。
            if (
              !this.consumptiveSessions.has(sessionId) ||
              !isSessionStreamUnitSettled(unit.getStatus()) ||
              unit.getRunId() === payload.runId
            ) {
              return;
            }
            // 句柄迁移 + 消费型标记重建都靠 adoptConsumptiveUnit（removeUnit 会 delete 标记）
            const inheritedHandles = unit.takeWebviewHandles();
            const inheritedStreamRowIds = unit.getStreamRowIds();
            this.removeUnit(sessionId, unit);
            unit = this.adoptConsumptiveUnit(sessionId, projectId);
            unit.inheritStreamRowIds(inheritedStreamRowIds);
            for (const handle of inheritedHandles) {
              unit.attachWebview(handle);
            }
            if (!unit.markRunning(payload.runId)) {
              return;
            }
            // 新单元 messages 为空，屏侧会先落到空数组；立即回源填历史，避免二轮 run 开场空白
            void this.loadSessionTailMessages(sessionId, {force: true}).catch(
              error => {
                log.error('reuse tail reload failed', {sessionId, error});
              },
            );
          }
          if (!this.consumptiveSessions.has(sessionId)) {
            // Step 5：挂写通 coalescer（供后续 delta append）+ 直接写 running 行
            //（runId/startedAtMs 回填；一次性事件不走节流）。消费型单元跳过。
            const store = this.runStateStore;
            if (store != null && !this.writethroughs.has(sessionId)) {
              const writethrough = createRunStateWritethrough(
                state => store.upsert(state),
                this.writethroughOptions,
              );
              this.writethroughs.set(sessionId, writethrough);
            }
            this.upsertRunStateQuietly(this.runStateRowFromSnapshot(unit));
          }
          this.notifyChanged();
        },
      ),
      bus.subscribe(
        EVENT_AGENT_RUN_FINISHED,
        (payload: AgentRunFinishedPayload) => {
          this.finishRun(payload.sessionId, payload.runId, {
            status: 'finished',
          });
        },
      ),
      bus.subscribe(
        EVENT_AGENT_RUN_FAILED,
        (payload: AgentRunFailedPayload) => {
          const failure: RunOutcome = {
            status: 'failed',
            errorMessage: payload.error,
          };
          this.finishRun(payload.sessionId, payload.runId, failure);
        },
      ),
      bus.subscribe(
        EVENT_AGENT_STREAM_TEXT_DELTA,
        (payload: AgentStreamTextDeltaPayload) => {
          const unit = this.units.get(payload.sessionId);
          if (
            unit != null &&
            unit.ingestTextDelta(payload.runId, payload.text)
          ) {
            this.appendWritethroughSnapshot(unit);
          }
        },
      ),
      bus.subscribe(
        EVENT_AGENT_STREAM_THINKING_DELTA,
        (payload: AgentStreamThinkingDeltaPayload) => {
          const unit = this.units.get(payload.sessionId);
          if (
            unit != null &&
            unit.ingestThinkingDelta(payload.runId, payload.text)
          ) {
            this.appendWritethroughSnapshot(unit);
          }
        },
      ),
      // tool-use（chat-streaming-projection Step 2）：进当前 step 记录的
      // tools 并立即推 tools-only 的 stream-batch。tool 状态不是持久字段，
      // 不写通（只由单元内的 onProjectionChanged 通知）。
      bus.subscribe(EVENT_AGENT_STREAM_TOOL_USE, this.onToolUse),
      // STEP_COMMITTED：step 边界冲刷 + partial 清零 + 注入标记复位。
      // 单元内含 runId 所有权守卫，生效才触发投影通知。Step 5：生效后把
      // partial 已清零的新快照 append 进 coalescer 并立即 flush（step 边界
      // 立即刷——落盘行反映 step 边界状态，而非 append 时刻的旧 partial）。
      bus.subscribe(
        EVENT_AGENT_STEP_COMMITTED,
        (payload: AgentStepCommittedPayload) => {
          const unit = this.units.get(payload.sessionId);
          const {runId, phase, messageId} = payload;
          if (
            unit == null ||
            !unit.handleStepCommitted(runId, phase, messageId)
          ) {
            return;
          }
          this.appendWritethroughSnapshot(unit);
          this.writethroughs.get(payload.sessionId)?.flush();
          this.notifyChanged();
        },
      ),
      // usage 事件（stream-metrics-tokens）：run 级累计 completionTokens 直达
      // unit.ingestUsage 覆盖 heuristic（事件即归账，不经缓冲节拍——与
      // textChars 同口径；风暴面由事件总线 microtask 合批兜住）。生效才把
      // 写通快照 append 进 coalescer（陈旧事件不产生持久层写）。
      bus.subscribe(
        EVENT_AGENT_STREAM_USAGE,
        (payload: AgentStreamUsagePayload) => {
          const unit = this.units.get(payload.sessionId);
          if (
            unit != null &&
            unit.ingestUsage(payload.runId, payload.completionTokens)
          ) {
            this.appendWritethroughSnapshot(unit);
          }
        },
      ),
      // child-created：按 parentSessionId 路由进父单元登记（去重在单元内），
      // 同时记反查表供子会话终态摘除。无父单元（父 run 已结束/不在本进程）
      // 自然落空。
      bus.subscribe(
        EVENT_SUBAGENT_CHILD_SESSION_CREATED,
        (payload: SubagentChildSessionCreatedPayload) => {
          const unit = this.units.get(payload.parentSessionId);
          if (unit == null) {
            return;
          }
          const childId = payload.childSessionId;
          const parentId = payload.parentSessionId;
          this.pendingChildParentByChild.set(childId, parentId);
          if (
            unit.registerPendingChild(payload.childSessionId, payload.title)
          ) {
            // 链接变化进写通节流窗（不立即刷——低频事件，等下个窗口即可；
            // 重启恢复晚一个窗口可接受）。
            this.appendWritethroughSnapshot(unit);
            this.notifyChanged();
          }
        },
      ),
    ];

    // 通知点按：切 scope 到目标会话（已在目标会话则跳过切换）+ 导航 Chat tab。
    // onBackgroundEvent 为模块级一次注册（handler 引用替换），不随实例退订；
    // 这里只握 onForegroundEvent 的退订函数，dispose 时退订。
    this.offNotificationTap = registerAgentNotificationTapHandling(
      sessionId => {
        const bridge = this.scopeBridge;
        if (bridge?.getCurrentSessionId() !== sessionId) {
          void bridge?.setCurrentSession(sessionId).catch(() => undefined);
        }
        navigateToChatTabFromNotification();
      },
    );

    // 收尾校准探针（Step 7 自旧 run 探针的收尾方向迁入）：低频轮询 +
    // 前台回焦校准「running 单元 + registry 无注册」的悬挂现场，防 core
    // 终态事件丢失导致「生成中」永久残留。starting 单元不参与（runId 未
    // 回填；core 的 register 在 runAgentTurn 函数入口执行，受理即在途，
    // 与注册时机无关；该场景由 finally 兜底）。
    this.calibrationProbe = createRunFinishCalibrationProbe({
      activeSessionIds: () => this.listCalibratableSessionIds(),
      isRunRegistered: sessionId => this.runtime.abortRegistry.has(sessionId),
      // 校准收尾（终态事件丢失的兜底）：走与 FAILED 事件等效的收尾路径——
      // runId 所有权匹配则 settle('failed')，refcount/持久层/通知/保活照常
      // 收口。经 startRun 发起的 run 的 runAgentTurn promise 挂死场景同样
      // 被覆盖（finally 永不到达时这里是唯一收尾点）。
      onRunLost: sessionId => {
        const unit = this.units.get(sessionId);
        if (unit == null || !this.isActiveUnit(unit)) {
          return;
        }
        const runId = unit.getRunId();
        if (runId != null) {
          const failure: RunOutcome = {
            status: 'failed',
            errorMessage: '连接已断开，生成被中断',
          };
          this.finishRun(sessionId, runId, failure);
        }
      },
    });
    this.calibrationAppStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        this.calibrationProbe?.calibrate();
      }
    });

    // 注入了持久层服务即异步 kick 水合（完成前 snapshot 恒 null 的既有
    // 语义生效——Step 2 起逐行量子让步分片，忙期不霸占事件循环；失败时
    // 放行 markHydrated 而非卡死在无 run 态）。
    if (this.runStateStore != null) {
      void this.hydrate();
    }
  }

  /**
   * Provider ready 后注入 UI toast 桥。
   *
   * nm-style: keep-public — Provider 装配的跨层注入端口（Manager 在 React 树外）。
   */
  setUiBridge(bridge: SessionStreamUiBridge): void {
    this.uiBridge = bridge;
  }

  /**
   * Provider ready 后注入偏好读取桥。
   *
   * nm-style: keep-public — Provider 装配的跨层注入端口。
   */
  setPrefBridge(bridge: SessionStreamPrefBridge): void {
    this.prefBridge = bridge;
  }

  /**
   * Provider ready 后注入 scope 桥。
   *
   * nm-style: keep-public — Provider 装配的跨层注入端口。
   */
  setScopeBridge(bridge: SessionStreamScopeBridge): void {
    this.scopeBridge = bridge;
  }

  /**
   * 水合是否完成（完成前 snapshot 一律 null——会话呈现为无 run）。
   *
   * nm-style: keep-public — spec §7.1.3 点名的测试访问器之一（水合时序观测面）。
   */
  isHydrated(): boolean {
    return this.hydratedValue;
  }

  /**
   * 标记水合完成（Step 5 的水合流程收尾时调用；本节点无持久层，由装配方/
   * 测试在 manager 就绪后显式调用）。置位会触发一次投影通知。
   */
  markHydrated(): void {
    if (this.hydratedValue) {
      return;
    }
    this.hydratedValue = true;
    this.notifyChanged();
  }

  /**
   * 重启水合（Step 5）：扫持久层行恢复内存现场，单飞幂等。
   *
   * - `status IN (starting,running)` → 逐会话建 interrupted 态单元
   *   （partial/指标/startedAtMs/pendingChildren 从行恢复）；这些单元
   *   不挂写通 coalescer（run 已死，只读）；水合窗口内已被新 startRun
   *   受理的会话跳过（新 run 优先于陈旧行）；
   * - `status = settled` → 回填 settled 投影（sessionId → metrics 快照，
   *   settledAtMs 以 updated_at_ms 近似），供「上次生成」跨重启读取；
   * - 完成后 markHydrated（此前 snapshot 恒 null 的既有语义生效）。
   *
   * Step 2 起两个逐行循环按量子让步分片（yieldQuantum，缺省 16ms 量子 +
   * setTimeout(0)）：分片只拉长耗时，markHydrated 时机不变——全有或全无
   * 语义保持，期间不提前 expose 单元。每个让步点后复查 disposed（分片拉长
   * 窗口后 dispose 可能落在任意两行之间），命中即中止并直接放行。
   *
   * 失败策略：任一步失败则记日志并直接 markHydrated 放行（会话呈现为
   * 无 run，不阻塞 UI）。
   *
   * nm-style: keep-public — runtime 启动唯一水合入口，承载 dispose/幂等/
   * 量子让步状态机，调用方无法 own 这段生命周期。
   */
  hydrate(): Promise<void> {
    if (this.hydratePromise != null) {
      return this.hydratePromise;
    }
    const run = (async () => {
      bootTimingLog('hydrate begin');
      const store = this.runStateStore;
      if (store == null) {
        this.markHydrated();
        return;
      }
      const activeRows = await store.listByStatuses(['starting', 'running']);
      bootTimingLog(`hydrate active rows listed (n=${activeRows.length})`);
      if (this.disposed) {
        // dispose 已发生（慢扫描撞上 runtime 重建）：不再往死 manager 里
        // 建单元，直接放行。
        this.markHydrated();
        return;
      }
      for (const row of activeRows) {
        // Step 2 水合分片：逐行量子让步（忙期让出事件循环，交互可插队）。
        // 让步点后必须复查 disposed——分片拉长了水合窗口，dispose 可能落在
        // 任意两行之间；后续行不再 adopt，直接放行（不卡死在无 run 态）。
        // 全有或全无语义保持：markHydrated 只在循环收尾调用一次，分片期间
        // snapshot 恒 null、不提前 expose 单元。
        await this.yieldQuantum();
        if (this.disposed) {
          this.markHydrated();
          return;
        }
        const existing = this.units.get(row.sessionId);
        if (existing != null && this.isActiveUnit(existing)) {
          // 水合窗口内新受理的 run 优先：不 adopt、不覆盖。
          continue;
        }
        const unit = this.adoptInterruptedUnit(row.sessionId, row.projectId);
        let pendingChildren: readonly string[] = [];
        if (row.pendingChildrenJson != null) {
          try {
            const parsed: unknown = JSON.parse(row.pendingChildrenJson);
            if (Array.isArray(parsed)) {
              pendingChildren = parsed.filter(
                (id): id is string => typeof id === 'string',
              );
            }
          } catch {
            // 损坏的 JSON 按空链接处理，不阻断水合
          }
        }
        unit.hydrateFromRunState({
          runId: row.runId,
          startedAtMs: row.startedAtMs,
          settledAtMs: row.updatedAtMs,
          metrics: {
            textChars: row.textChars,
            thinkingChars: row.thinkingChars,
            completionTokens: row.completionTokens,
            tokenSource: row.tokenSource,
          },
          partialText: row.partialText ?? '',
          partialThinking: row.partialThinking ?? '',
          pendingChildren,
        });
      }
      const settledRows = await store.listByStatuses(['settled']);
      bootTimingLog(`hydrate settled rows listed (n=${settledRows.length})`);
      for (const row of settledRows) {
        // settled 回填同款分片让步 + disposed 复查：dispose 已清空的
        // settledProjections 不再被后续行回填（防死 manager 泄漏条目）。
        await this.yieldQuantum();
        if (this.disposed) {
          this.markHydrated();
          return;
        }
        // 冻结末值速率从 session KKV 读回（run_state 不存速率，见域常量注释）；
        // 行缺失/解析失败即省略速率段——不造数、不报错。
        const sid = row.sessionId;
        const kkv = this.runtime.sessionKkv;
        let rawRate: string | null = null;
        if (kkv != null) {
          rawRate = await kkv.get(sid, METRICS_DOMAIN, FINAL_RATE_KEY);
        }
        // 快照没带 runId（旧格式/身份未知）→ 兼容采用；带 runId 但与 settled
        // 行不一致（settled 行被新 run 覆盖、KKV 还留着上一轮残留的竞态窗口）
        // → 视为缺值，不把上一轮的速度拼到本轮「上次生成」上。
        const rateSnapshot = parseStreamFinalRateSnapshot(rawRate);
        const snapshotRunId = rateSnapshot?.runId;
        const mismatch = snapshotRunId != null && snapshotRunId !== row.runId;
        let finalRate: number | null = null;
        if (rateSnapshot != null && !mismatch) {
          finalRate = rateSnapshot.rate;
        }
        this.settledProjections.set(sid, {
          sessionId: sid,
          metrics: {
            textChars: row.textChars,
            thinkingChars: row.thinkingChars,
            completionTokens: row.completionTokens,
            tokenSource: row.tokenSource,
          },
          startedAtMs: row.startedAtMs,
          settledAtMs: row.updatedAtMs,
          elapsedMs: Math.max(0, row.updatedAtMs - row.startedAtMs),
          rateTokensPerSecond: finalRate,
        });
      }
      const activeCount = activeRows.length;
      const settledCount = settledRows.length;
      // prettier-ignore
      bootTimingLog(`hydrate complete (active=${activeCount}, settled=${settledCount})`);
      this.markHydrated();
    })();
    this.hydratePromise = run.catch(err => {
      log.error('hydrate failed', {err});
      this.markHydrated();
    });
    return this.hydratePromise;
  }

  /**
   * settled 投影读取（Step 6 指标条消费面）：该会话「上次生成」的冻结
   * 快照；无收尾记录为 null。运行中单元的实时指标走 snapshot(sessionId)
   * 的 metrics/startedAtMs（消费方按需合并两源）。
   *
   * 水合完成前恒 null（svc/C-1，与 snapshot 恒 null 语义对齐）——否则
   * 水合分片回填 settled 行期间会读到渐进增长的投影，指标条分批跳变。
   *
   * nm-style: keep-public — ChatStreamMetricsBarLive 的「上次生成」读取入口。
   */
  // prettier-ignore
  getSettledProjection(sessionId: string): SessionStreamSettledProjection | null {
    if (!this.hydratedValue) {
      return null;
    }
    return this.settledProjections.get(sessionId) ?? null;
  }

  /**
   * 速率读数口（token/秒）：活跃单元给实时滑窗值（暂停期随 nowMs 增长自然
   * 衰减）；终态单元给收尾冻结的末值（不随 nowMs 衰减）；无单元回落到
   * settled 投影的冻结末值（水合完成后可读）。
   *
   * 活跃但样本不足时返回 null 而不回落上一轮冻结值——否则新一轮首秒会
   * 显示上一轮的速度。
   */
  rateTokensPerSecond(sessionId: string, nowMs: number): number | null {
    const unit = this.units.get(sessionId);
    if (unit != null) {
      return isSessionStreamUnitSettled(unit.getStatus())
        ? unit.getFinalRateTokensPerSecond()
        : unit.getRateTokensPerSecond(nowMs);
    }
    if (!this.hydratedValue) {
      return null;
    }
    return this.settledProjections.get(sessionId)?.rateTokensPerSecond ?? null;
  }

  /**
   * 遗忘会话（Step 6 会话删除链路调用）：销毁该会话单元（在途写通
   * coalescer 一并 flush+dispose 收口）+ 清 settled 投影。
   *
   * 只清内存：持久层 session_run_state 行由 core 会话删除事务联动清理
   * （deleteSessionTree / 项目删除级联），此处不重复写库。活跃单元被
   * 遗忘时同步 decrement（对齐 dispose 的收口，防 refcount 泄漏）。
   */
  forgetSession(sessionId: string): void {
    // 反查表双向清理：该会话作为父（value 侧）的条目由 removeUnit 内的
    // clearPendingChildIndex 摘；作为子（key 侧）的条目在这里摘——会话删除
    // 后 id 不应残留映射（removeUnit 的 value 侧清理覆盖不到 key 侧）。
    for (const [childId, parent] of this.pendingChildParentByChild) {
      if (childId === sessionId || parent === sessionId) {
        this.pendingChildParentByChild.delete(childId);
      }
    }
    const unit = this.units.get(sessionId);
    if (unit != null) {
      if (
        !isSessionStreamUnitSettled(unit.getStatus()) &&
        !this.consumptiveSessions.has(sessionId)
      ) {
        decrementAgentActive();
      }
      this.removeUnit(sessionId, unit);
    } else {
      this.flushAndDisposeWritethrough(sessionId);
    }
    this.settledProjections.delete(sessionId);
    this.idleMessageViews.delete(sessionId);
    // 在途上翻一并作废：会话已被删除，窗口期落地时不得把它写回（否则
    // forgetSession 之后又凭空长出一条消息面）。
    this.idleLoadingMore.delete(sessionId);
    this.notifyChanged();
  }

  /**
   * 某 session 当前是否有进行中的 run（starting|running 单元）。
   *
   * nm-style: keep-public — spec §7.1.3 点名的测试访问器之一（活跃 run 观测面）。
   */
  hasActiveRun(sessionId: string): boolean {
    const unit = this.units.get(sessionId);
    return unit != null && this.isActiveUnit(unit);
  }

  /**
   * 当前有活跃 run（starting|running 单元，含消费型子会话 run）的
   * sessionId 列表（Step 6 会话列表「停止生成」入口的判活数据源）。
   */
  activeSessionIds(): readonly string[] {
    const ids: string[] = [];
    for (const [sessionId, unit] of this.units) {
      if (this.isActiveUnit(unit)) {
        ids.push(sessionId);
      }
    }
    return ids;
  }

  /**
   * 当前处于中断态（水合回填的 status='interrupted' 单元，常驻至替换或
   * LRU 淘汰）的 sessionId 集合（Step 9 会话列表「已中断」徽标的数据源）。
   * 变更沿与 activeSessionIds 同款：单元状态迁移均经 notifyChanged/subscribe
   * 通知，UI 侧订阅驱动刷新。
   *
   * 水合完成前恒空集（svc/C-1，与 snapshot 恒 null 语义对齐）——否则
   * 水合分片逐行 adopt interrupted 单元期间会读到渐进增长的集合，徽标
   * 分批跳变。
   */
  interruptedSessionIds(): ReadonlySet<string> {
    if (!this.hydratedValue) {
      return new Set<string>();
    }
    const ids = new Set<string>();
    for (const [sessionId, unit] of this.units) {
      if (unit.getStatus() === 'interrupted') {
        ids.add(sessionId);
      }
    }
    return ids;
  }

  /**
   * 请求该会话单元清掉流式投影并向全句柄广播 reset-stream（Step 6 屏幕
   * 接线：消息操作 rollback/fork 等场景，对应 webview 的 resetStream；
   * 无单元 no-op）。
   *
   * 顺序（P0-4）：先 `unit.clearStreamProjection()` 拿被清掉的 streamId →
   * 广播 `{streamIds}` → 通知 → 下一拍再 force-snapshot。force-snapshot 经
   * 适配器同步调宿主 `sendSessionSnapshotNow`，它起手读 Provider 的
   * streamingRows 闭包；必须等 `setUnitView` 提交后的下一拍发，否则
   * 「清空后的快照」仍带旧 partial。interrupted 单元另 best-effort settle
   * 持久层行，避免进程重启后水合回鬼影。
   *
   * nm-style: keep-public — useChatTabController 的消息操作（rollback/fork）
   * 唯一驱动入口，承载单元私有投影清理与下一拍 force-snapshot 时序。
   */
  requestStreamReset(sessionId: string): void {
    const unit = this.units.get(sessionId);
    if (unit == null) {
      return;
    }
    // 只清投影可见的行 id（已接管的 DB-backed 行不在列表里，P1-4）；无可见
    // 行时跳过广播，只补一次 force snapshot（少一次 generation 作废）。
    const removed = unit.clearStreamProjection();
    if (removed.length > 0) {
      unit.broadcastControlMessage({type: 'reset-stream', streamIds: removed});
    }
    this.notifyChanged();
    setTimeout(() => this.forceSnapshotSoon({sessionId, unit}), 0);
    if (unit.getStatus() === 'interrupted') {
      this.upsertSettledRunStateQuietly(unit);
    }
  }

  /**
   * 某 session 的单元投影：水合未完成为 null（会话呈现为无 run）；
   * 无单元为 null；starting 时 runId 为 null。UI 侧以此为唯一事实源，
   * 不自行推衡。事件同步总线保证 UI 侧同名事件回调执行时投影已更新
   * （Manager 订阅先于 UI 建立）。
   */
  snapshot(sessionId: string): SessionStreamUnitView | null {
    if (!this.hydratedValue) {
      return null;
    }
    return this.units.get(sessionId)?.snapshot() ?? null;
  }

  /**
   * 订阅投影变更（受理/状态迁移/收尾/宽限销毁/LRU 淘汰/替换/水合完成/
   * step 边界/child 链接变化，以及运行中单元的 apply 节拍≈64ms 均触发）
   * ——会话运行态视图的响应源。返回退订函数；dispose 后不再通知。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 当前注册表中的单元总数（含活跃与 settled；诊断/测试用）。
   *
   * nm-style: keep-public — spec §7.1.3 点名的测试访问器之一（LRU 淘汰观测面）。
   */
  unitCount(): number {
    return this.units.size;
  }

  /**
   * 把 webview 句柄挂到该会话的单元（Step 6 屏幕接线的消费面；无单元
   * no-op）。单元内会在 attach 时尝试注入本 step 已累积的 partial。
   */
  attachWebview(sessionId: string, handle: SessionStreamWebviewHandle): void {
    this.units.get(sessionId)?.attachWebview(handle);
  }

  /** 摘除该会话单元上的 webview 句柄（无单元/未注册 no-op）。 */
  detachWebview(sessionId: string, handleId: string): void {
    this.units.get(sessionId)?.detachWebview(handleId);
  }

  /**
   * tail 加载（Step 6 屏幕接线的消费面）：路由进该会话单元的消息管线。
   * 非 force = 会话切换水合语义（缓存命中不回源）；force = 无条件回源 DB。
   * 无单元（Step 7 收口）：走 idle 路径——view cache 命中即采纳、miss 回源
   * messageStore 窄窗，不建单元、不碰单元投影；projectId 供 view cache
   * 键用（缺省只回源、不读写缓存）。
   */
  // prettier-ignore
  async loadSessionTailMessages(sessionId: string, options?: {readonly force?: boolean; readonly projectId?: string}): Promise<readonly ChatMessageData[] | null> {
    const force = options?.force;
    const unit = this.units.get(sessionId);
    if (unit != null) {
      return unit.loadTailMessages(force != null ? {force} : undefined);
    }
    // 无单元（Step 7 收口）：idle 路径——缓存命中采纳（仅面空时窗口化）→
    // 回源单查询（多取一条判定 hasMore）→ 写缓存。Step 2 单查询化：tail 一次
    // 取 `页大小 + 1`，返回超过页大小即 hasMore=true 并裁去多取的最旧一行
    // （listBySessionTail 返回 seq 升序、最旧在前，多取的一行在数组头部）。
    const forceReload = force ?? false;
    const projectId = options?.projectId;
    let cacheKey: string | null = null;
    if (projectId != null) {
      cacheKey = sessionViewCacheKey(projectId, sessionId);
    }
    if (cacheKey != null && !forceReload) {
      const cached = getSessionViewCache(cacheKey);
      if (cached != null) {
        // 与单元路径同款守卫：只有冷启动水合才裁窗口。idle 视图已有消息面
        // 时（重进 / idle 分页翻出来的浏览史），整面采纳——截回去等于当着
        // 用户的面把转录塌掉。当前唯一调用方 loadSessionTailMessages 在
        // 重进场景确实会带着非空面进来，守卫不是空转。
        const idleCount = this.idleMessageViews.get(sessionId)?.messages.length ?? 0;
        const adopted = idleCount === 0 ? hydrateWindowFromCache(cached) : cached;
        this.applyIdleMessages(sessionId, adopted);
        return [...adopted.messages];
      }
    }
    const limit = SESSION_STREAM_MESSAGES_PAGE_SIZE + 1;
    const fetched = await this.runtime.messages.listBySessionTail(sessionId, {limit});
    const hasMore = fetched.length > SESSION_STREAM_MESSAGES_PAGE_SIZE;
    const list = hasMore ? fetched.slice(1) : fetched;
    if (cacheKey != null) {
      setSessionViewCache(cacheKey, {messages: list, hasMoreMessages: hasMore});
    }
    this.applyIdleMessages(sessionId, {messages: list, hasMoreMessages: hasMore});
    return [...list];
  }

  /**
   * 分页加载更早消息：有单元走单元管线；无单元走 idle 分页（以 idle 视图
   * 首行 seq 为锚向上翻页，结果写 view cache 与 idle 视图）。
   *
   * in-flight 标记与兜底基线都存在 `idleLoadingMore`（不参与 LRU 淘汰），
   * 不写进 LRU 表内：读-改-写跨一个 `await`，标记若在表内，窗口期内的
   * 淘汰会连标记带数据一起抹掉，本次上翻被静默丢弃（CR L1-5）。
   *
   * nm-style: keep-public — ChatTabProvider 的 idle 分页唯一入口，读写
   * manager 私有 idleMessageViews/idleLoadingMore 与视图缓存。
   */
  // prettier-ignore
  async loadOlderSessionMessages(sessionId: string, projectId?: string): Promise<void> {
    const unit = this.units.get(sessionId);
    if (unit != null) {
      return unit.loadOlderMessages();
    }
    const idle = this.idleMessageViews.get(sessionId);
    if (idle == null || this.idleLoadingMore.has(sessionId)) {
      return;
    }
    if (idle.messages.length === 0) {
      return;
    }
    const beforeSeq = idle.messages[0]?.seq;
    if (beforeSeq == null) {
      return;
    }
    this.idleLoadingMore.set(sessionId, {base: idle});
    this.notifyChanged();
    try {
      const page = {limit: SESSION_STREAM_MESSAGES_PAGE_SIZE, beforeSeq};
      const older = await this.runtime.messages.listBySessionPage(sessionId, page);
      const inFlight = this.idleLoadingMore.get(sessionId);
      if (inFlight == null) {
        // 窗口期内会话被遗忘（forgetSession）或 manager 已 dispose：本次结果
        // 不再落地（与 in-flight 标记仍在 LRU 表内的旧行为同语义）。
        return;
      }
      // 窗口期内本会话条目若被 LRU 淘汰（别的路径灌进 CAP+1 个 sessionId），
      // 用发起时的基线兜底合并——本次上翻的数据仍会 set 回 LRU，页面照常翻。
      const current = this.idleMessageViews.get(sessionId) ?? inFlight.base;
      if (older.length === 0) {
        this.idleLoadingMore.delete(sessionId);
        this.idleMessageViews.set(sessionId, {...current, hasMoreMessages: false});
        this.notifyChanged();
        return;
      }
      const hasMore = older.length === SESSION_STREAM_MESSAGES_PAGE_SIZE;
      const next = prependOlderMessages(current.messages, older);
      if (projectId != null) {
        const cacheKey = sessionViewCacheKey(projectId, sessionId);
        setSessionViewCache(cacheKey, {messages: next, hasMoreMessages: hasMore});
      }
      this.idleLoadingMore.delete(sessionId);
      this.idleMessageViews.set(sessionId, {
        messages: next,
        hasMoreMessages: hasMore,
        streamRowIds: current.streamRowIds,
      });
      this.notifyChanged();
    } finally {
      // 异常/早退路径的标记复位（成功路径已提前 delete，这里是幂等兜底）。
      if (this.idleLoadingMore.delete(sessionId)) {
        this.notifyChanged();
      }
    }
  }

  /**
   * 消息面统一读取口（Step 7 收口：Provider 消息显示的单一来源）：
   * - 有单元：走投影字段（tail/分页/step reload 均为单元消息面）——
   *   单元消息面为空且 idle 有值时回落 idle（新 run 替换沿 starting 单元
   *   尚未加载，回落防历史消息闪空）；
   * - 无单元：idle 视图（从未加载过为 null，消费方按空处理）。
   *
   * `loadingMoreMessages` 在 idle 分支从 `idleLoadingMore` 合成（不在 LRU
   * 表内，见该字段注释）；有单元分支仍取单元投影自带的同名标记。
   */
  readMessagesSnapshot(sessionId: string): IdleMessageView | null {
    const unit = this.units.get(sessionId);
    if (unit != null) {
      const snap = unit.snapshot();
      if (snap.messages.length > 0) {
        return {
          messages: snap.messages,
          hasMoreMessages: snap.hasMoreMessages,
          loadingMoreMessages: snap.loadingMoreMessages,
          streamRowIds: snap.streamRowIds,
        };
      }
      const idle = this.idleMessageViews.get(sessionId);
      if (idle != null) {
        return {
          ...idle,
          loadingMoreMessages: this.idleLoadingMore.has(sessionId),
        };
      }
      return {
        messages: snap.messages,
        hasMoreMessages: snap.hasMoreMessages,
        loadingMoreMessages: snap.loadingMoreMessages,
        streamRowIds: snap.streamRowIds,
      };
    }
    const idle = this.idleMessageViews.get(sessionId);
    return idle != null
      ? {...idle, loadingMoreMessages: this.idleLoadingMore.has(sessionId)}
      : null;
  }

  /**
   * 同步水合（会话切换防闪，原 useChatTabMessages.hydrateFromSessionCache
   * 的等价语义）：view cache 命中即采纳进 idle 视图、miss 清空；有单元
   * （投影接管消息面）no-op。写完通知一次。
   *
   * nm-style: keep-public — 会话切换防闪的唯一水合入口，读写 manager 私有
   * idleMessageViews 与 view cache，调用侧无法 own 这段状态。
   */
  hydrateSessionMessages(projectId: string, sessionId: string): void {
    if (this.units.has(sessionId)) {
      return;
    }
    const cacheKey = sessionViewCacheKey(projectId, sessionId);
    const cached = getSessionViewCache(cacheKey);
    if (cached != null) {
      const windowed = hydrateWindowFromCache(cached);
      this.idleMessageViews.set(sessionId, {
        messages: [...windowed.messages],
        hasMoreMessages: windowed.hasMoreMessages,
        streamRowIds: this.idleStreamRowIds(sessionId),
      });
    } else {
      this.idleMessageViews.set(sessionId, {
        messages: [],
        hasMoreMessages: false,
        streamRowIds: this.idleStreamRowIds(sessionId),
      });
    }
    this.notifyChanged();
  }

  /** 采纳 idle 消息面并通知（通知驱动 Provider 的消息快照刷新）。 */
  private applyIdleMessages(sessionId: string, view: SessionViewCache): void {
    this.idleMessageViews.set(sessionId, {
      messages: [...view.messages],
      hasMoreMessages: view.hasMoreMessages,
      streamRowIds: this.idleStreamRowIds(sessionId),
    });
    this.notifyChanged();
  }

  /**
   * idle 视图当前的接管映射（缺省空 Map）。所有 idleMessageViews.set 写入点
   * 都必须经它保留既有映射——单元出表后任意一次 tail/older 刷新丢了 map，
   * 已接管的 assistant 行就会回退 DB id（remount/闪动，P1-3）。
   */
  private idleStreamRowIds(sessionId: string): ReadonlyMap<string, string> {
    return (
      this.idleMessageViews.get(sessionId)?.streamRowIds ?? EMPTY_STREAM_ROW_IDS
    );
  }

  /**
   * 发起 run：per-session 门禁 + fire-and-forget。
   *
   * 门禁钉死「该会话存在 starting|running 单元或 abortRegistry.has 为真即
   * 拒绝，返回明确错误而非静默」——core 的 register 在 runAgentTurn 函数
   * 入口执行（受理即在途），单看 registry 仍会在受理空窗内漏放第二个同会话
   * run。settled 单元不阻塞：interrupted/finished/failed（含宽限中）
   * 的旧单元被替换吸收——删旧建新（run_id 更新、状态机回 starting、
   * partial/注入标记/metrics 随新单元重置），无双单元并存。
   *
   * 受理路径同步 increment refcount（对齐 desktop agent.ts 的形状），decrement
   * 由事件订阅 / finally 早退兜底负责；startRun 本身同步返回，不 await run。
   *
   * nm-style: keep-public — Composer/测试发起 run 的唯一跨层入口，承载
   * units 替换吸收、refcount increment 与持久层 starting 行写入。
   */
  // prettier-ignore
  startRun(sessionId: string, projectId: string, content: string, options?: SessionStreamStartOptions): SessionStreamStartResult {
    timingLog('startRun enter');
    if (this.disposed) {
      return {ok: false, error: '运行时正在重建，请稍后重试'};
    }
    const existing = this.units.get(sessionId);
    if (
      (existing != null && this.isActiveUnit(existing)) ||
      this.runtime.abortRegistry.has(sessionId)
    ) {
      return {ok: false, error: '该会话已有进行中的生成，请先等待完成或停止'};
    }

    // settled 旧单元（interrupted/finished/failed，含宽限中）替换吸收：删旧建新。
    // 句柄迁移：旧单元销毁会清空句柄注册表，而 hasUnit 在旧→新之间连续
    // （不触发屏幕侧 attach effect 重挂）——不迁移的话新 run 的流式推送
    // 全程无句柄（HANDLE-NULL：会话内不渲染、退出重进注入才可见）。
    let inheritedHandles: SessionStreamWebviewHandle[] = [];
    // 出表单元的映射交接给 idle；无单元时从 idle 承接（单元宽限销毁/LRU
    // 出表后新 run 必须继承，否则已接管的 assistant 行回退 DB id → remount，
    // I5/R5）。
    let inheritedIds = this.idleStreamRowIds(sessionId);
    if (existing != null) {
      inheritedHandles = existing.takeWebviewHandles();
      inheritedIds = existing.getStreamRowIds();
      this.removeUnit(sessionId, existing);
    }
    const unit = new SessionStreamUnit({
      sessionId,
      projectId,
      messageStore: this.runtime.messages,
      tokenEstimatorFactory: this.tokenEstimatorFactory,
      onSettled: options?.onSettled,
      settledGraceMs: this.settledGraceMs,
      onGraceExpired: expired => this.handleGraceExpired(sessionId, expired),
      onProjectionChanged: () => this.notifyChanged(),
    });
    unit.begin();
    unit.inheritStreamRowIds(inheritedIds);
    for (const handle of inheritedHandles) {
      unit.attachWebview(handle);
    }
    this.units.set(sessionId, unit);
    // Step 5：受理即写 starting 行（一次性事件不走节流；runId 未回填用
    // 空串占位，RUN_STARTED 到达后覆盖）。杀进程落在受理空窗内时，重启
    // 水合会把该行识别为中断现场。
    this.upsertRunStateQuietly({
      sessionId,
      projectId,
      runId: '',
      status: 'starting',
      startedAtMs: 0,
      textChars: 0,
      thinkingChars: 0,
      completionTokens: 0,
      tokenSource: 'heuristic',
      partialText: null,
      partialThinking: null,
      pendingChildrenJson: null,
      updatedAtMs: Date.now(),
    });
    this.notifyChanged();
    timingLog('notifyChanged done (metrics bar scheduled)');
    incrementAgentActive();
    // 受理后按需刷新保活通知：消息通知总开关开启才操作（开关关时受理不
    // 产生任何通知刷新）。两段式时序（Step 8 忙期优先）——第一段无标签调
    // startAgentKeepAliveService(sessionId) 登记受理意图（常驻模式下该调用
    // 是 no-op；通知启停决策权已收归模块内的常驻开关态）；第二段会话名/
    // 项目名两查询并发，查回后带标签再调同一函数，经既有 labelsVersion →
    // reconcileKeepAlive「同 id 原位刷新」把内容切到「正在生成 · 会话名」；
    // 取不到名字不阻塞、仅内容缺省。
    void (async () => {
      timingLog('keepalive: begin');
      const enabled = (await this.prefBridge?.isNotificationEnabled()) ?? false;
      if (!enabled) {
        timingLog('keepalive: disabled by pref, skip');
        return;
      }
      await startAgentKeepAliveService(sessionId);
      timingLog('keepalive: initial start (default content) returned');
      const titles = Promise.all([
        (async () => {
          try {
            const session = await this.runtime.sessions.get(sessionId);
            const title = session?.title ?? undefined;
            timingLog('keepalive: session title fetched');
            return title;
          } catch {
            // 名字取不到不阻塞保活
            return undefined;
          }
        })(),
        (async () => {
          try {
            const project = await this.runtime.projects.get(projectId);
            const name = project?.name ?? undefined;
            timingLog('keepalive: project name fetched');
            return name;
          } catch {
            // 同上
            return undefined;
          }
        })(),
      ]);
      const [sessionTitle, projectName] = await titles;
      await startAgentKeepAliveService(sessionId, {projectName, sessionTitle});
      timingLog('keepalive: label refresh returned');
    })().catch(err => {
      log.error('startKeepAlive failed', {sessionId, err});
    });

    timingLog('runAgentTurn invoke');
    void this.runAgentTurnFn(this.runtime, {projectId, sessionId}, content, {
      stream: options?.stream,
      annotateDrafts: options?.annotateDrafts,
      allowResumeWithoutInput: options?.allowResumeWithoutInput,
      // D9：区间扫描结果与掩码区间同步透传（白名单漏一处 = 静默断链；
      // core 对 attachments 过滤非 attach，对 excludedScanRanges 做掩码）。
      excludedScanRanges: options?.excludedScanRanges,
      attachments: options?.attachments,
      onUserMessageAppended: options?.onUserMessageAppended,
    })
      .then(result => {
        // 前奏期停止（2026-09-30）：core 在检查点命中 abort 时以合成 cancelled
        // 结果收尾（stepsExecuted=0、无模型请求）。
        //
        // r3-run-1 起 core 会在返回前补发一条终态事件：检查点命中发
        // FINISHED(runId:'')、前奏抛错发 FAILED(runId:'')——**事件路径优先
        // 收口**，所以这段 .then **降级为幂等兜底**：事件已收口过时单元已
        // settled，finishRun 的 settle 状态机把它挡成 no-op。之所以还留着，
        // 是为了兜住「事件真的丢了」的形态；受理时写的 starting 行与
        // starting 单元仍需按 FINISHED 同款语义收尾（cancelled 归 finished
        // 家族，流式中途停止同样走 finishRun('finished')）。
        // RunAgentTurnFn 契约是 Promise<unknown>，按 stopReason 字段窄化取用。
        if (
          (result as {stopReason?: unknown} | null | undefined)?.stopReason ===
          'cancelled'
        ) {
          const current = this.units.get(sessionId);
          if (current === unit && current.getRunId() == null) {
            this.finishRun(sessionId, '', {status: 'finished'});
          }
        }
      })
      .catch(err => {
        log.error('run failed', {
          sessionId,
          projectId,
          err:
            err instanceof Error
              ? {name: err.name, message: err.message}
              : String(err),
        });
        // toast 只由「throw 路径独占」的那一种形态弹：事件路径（core 必发
        // EVENT_AGENT_RUN_FAILED——runner 期带真实 runId，r3-run-1 之后前奏
        // 抛错也发 FAILED(runId:'')，事件收口 finishRun 里已经 onError 过
        // 一次）会在这里被 settled 判据拦下。缺了
        // `!isSessionStreamUnitSettled(...)` 这半个条件，前奏抛错会双弹。
        // 单元非本次（事件已收尾或已被替换）同理不弹。
        const current = this.units.get(sessionId);
        if (
          current === unit &&
          current.getRunId() == null &&
          !isSessionStreamUnitSettled(current.getStatus())
        ) {
          const message = err instanceof Error ? err.message : String(err);
          this.uiBridge?.onError(message);
        }
      })
      .finally(() => {
        const current = this.units.get(sessionId);
        if (
          current !== unit ||
          isSessionStreamUnitSettled(current.getStatus())
        ) {
          // 已被新一轮 startRun 替换（current !== unit），或事件路径已收尾
          // （单元已 settled 进宽限期）——不双减、不动宽限中的终态投影。
          // 与模板的差异：模板收尾即删 entry，所有权比对即可判收尾；单元化
          // 后 settled 单元仍留在注册表，须加终态判断。
          return;
        }
        // 安全性依据（对齐模板 MF-2）：事件总线是同步分发的——若事件路径
        // （FINISHED/FAILED）已收尾过，此刻单元必然已 settled（上面的终态
        // 判断拦下）或已被替换；因此走到这里时不可能再有终态事件来双减，
        // 一律收尾。这覆盖了「RUN_STARTED 已达但 core 在主 try 前抛错、
        // 无终态事件」的窗口（否则单元/refcount 永久泄漏）；finishRun 的
        // runId 所有权 + settle 状态守卫是另一道双保险。
        // 此路径不走 settle（非正常终态）：直接销毁单元出表。
        this.removeUnit(sessionId, unit);
        // r3-run-1 步骤 6（E3-A3/A4）：补一个终态出口。走到这里意味着
        // 「事件路径与 .then 兜底**双双失手**」——最窄的一例是
        // r3-run-1 之后 core 前奏抛错：FAILED(runId:'') 事件到达时若
        // getRunId() 因异常时序仍不匹配本单元，finishRun 的所有权校验就把它
        // 当 stale 丢掉了（设计如此，迟到的旧 run 事件不能动新 run 的单元）。
        // 没了这个 invokeOnSettled，草稿区不清理、token chip 不刷新——用户在
        // 界面上看不到任何收尾痕迹。invokeOnSettled 自带 try/catch 且对已
        // destroy 的单元安全，这里无条件调。
        unit.invokeOnSettled('failed');
        this.notifyChanged();
        decrementAgentActive();
        this.stopKeepAliveQuietly(sessionId);
      });

    return {ok: true};
  }

  /**
   * 停止指定会话的活跃 run（会话列表「停止生成」入口，Step 6 接线）。
   *
   * 走 abortRegistry 的 abort 语义（retain/freeze 时序由 core 负责）；
   * 未注册（无在途 controller）返回 false。后续 FINISHED 事件照常经
   * 事件路径收尾。
   */
  stopRun(sessionId: string): boolean {
    if (!this.runtime.abortRegistry.has(sessionId)) {
      timingLog('stopRun: no controller (dropped)');
      return false;
    }
    this.runtime.abortRegistry.abort(sessionId);
    timingLog('stopRun: abort dispatched');
    return true;
  }

  /**
   * 水合入口（Step 5 填实扫描逻辑后由水合流程调用）：为该会话建一个
   * interrupted 态单元入注册表（partial/指标/子会话链接由水合流程回填，
   * 本节点只立入口与替换/LRU 语义）。返回单元供回填；若该会话已有单元
   * （settled）则被替换销毁——活跃单元场景下水合流程不应调用。
   *
   * nm-style: keep-public — 水合流程的唯一建单元入口，承载 units 注册表/
   * 替换销毁/LRU 淘汰与 notifyChanged 时序。
   */
  // prettier-ignore
  adoptInterruptedUnit(sessionId: string, projectId: string): SessionStreamUnit {
    const unit = new SessionStreamUnit({
      sessionId,
      projectId,
      messageStore: this.runtime.messages,
      tokenEstimatorFactory: this.tokenEstimatorFactory,
      settledGraceMs: this.settledGraceMs,
      onProjectionChanged: () => this.notifyChanged(),
    });
    unit.settleAsInterrupted();
    const existing = this.units.get(sessionId);
    if (existing != null) {
      this.removeUnit(sessionId, existing);
    }
    this.units.set(sessionId, unit);
    this.evictSettledOverflow();
    this.notifyChanged();
    return unit;
  }

  /**
   * 建消费型单元（Step 6）：接收型落点，仅由 RUN_STARTED 路由在无单元时调用。
   * 状态机直接 idle → starting（begin），随后由调用方 markRunning 回填 runId。
   *
   * 宽限销毁与发起型 run 同口径（cr-fix-spec mobile-metrics/C-1）：不接
   * `onGraceExpired` 的话，宽限到期后单元会永久残留在注册表里（snapshot
   * 仍可读），LRU 也排在 settled 序列里不释放。`handleGraceExpired` 只做
   * removeUnit + notifyChanged，不动 refcount（消费型单元从未 increment，
   * 摘除是安全的）。
   */
  // prettier-ignore
  private adoptConsumptiveUnit(sessionId: string, projectId: string): SessionStreamUnit {
    const unit = new SessionStreamUnit({
      sessionId,
      projectId,
      messageStore: this.runtime.messages,
      tokenEstimatorFactory: this.tokenEstimatorFactory,
      settledGraceMs: this.settledGraceMs,
      onGraceExpired: expired => this.handleGraceExpired(sessionId, expired),
      onProjectionChanged: () => this.notifyChanged(),
    });
    unit.begin();
    // 首次 lazy 建单元（此前无单元、只有 idle 交接）同样承接接管映射：
    // 否则单元空 Map 会遮蔽 idle 的映射，已接管行回退 DB id（P1-3）。
    unit.inheritStreamRowIds(this.idleStreamRowIds(sessionId));
    this.consumptiveSessions.add(sessionId);
    this.units.set(sessionId, unit);
    return unit;
  }

  /** 清掉指向某父会话的全部反查条目（父收尾/单元出表时调用）。 */
  private clearPendingChildIndex(parentSessionId: string): void {
    for (const [childId, parent] of this.pendingChildParentByChild) {
      if (parent === parentSessionId) {
        this.pendingChildParentByChild.delete(childId);
      }
    }
  }

  /** FINISHED/FAILED 收尾：runId 匹配才 settle 单元 + decrement + onSettled/通知。 */
  // prettier-ignore
  private finishRun(sessionId: string, runId: string, outcome: RunOutcome): void {
    const status = outcome.status;
    const errorMessage = outcome.errorMessage;
    timingLog(`finishRun(${status}) entered`);
    // 子会话 run 终态（sessionId 为子会话 id）不摘除父单元的 pending 链接：
    // 并行 task 批的 tool_results 要等最慢子 agent 完成才整批落库
    // （meta.subagentSessionId 才接管任务卡可点性），窗口期里 pending 映射
    // 是任务卡唯一可点数据源。链接由父 run 收尾（settle 内
    // clearPendingChildren + 下方父分支 clearPendingChildIndex）统一清空。
    const unit = this.units.get(sessionId);
    // runId='' 允许匹配「RUN_STARTED 未达」的受理期单元（getRunId()==null）：
    // 前奏期停止（core runAgentTurn 以合成 cancelled 结果收尾、不发事件）由
    // startRun 的 .then 补调 finishRun('', 'finished')——受理时写的 starting
    // 行必须收成 settled 行，否则重启水合会把「用户已停止的发送」误判为中断现场。
    const unitRunId = unit?.getRunId() ?? null;
    if (
      unit == null ||
      (unitRunId !== runId && !(runId === '' && unitRunId == null))
    ) {
      return;
    }
    // settle 状态守卫（已销毁/已收尾的单元不再收尾——防同 runId 双事件或
    // 与 finally 兜底竞态的双减；正常运行时不会走到，纯防御）。
    if (!unit.settle(status)) {
      return;
    }
    // 消费型单元（subagent 子会话 run，Step 6）：只收状态机（消息面 reload、
    // pendingChildren 清理、宽限销毁）。refcount/持久层/完成通知/保活均不
    // 参与——refcount 与持久层语义只覆盖经 startRun 发起的 run。
    if (this.consumptiveSessions.has(sessionId)) {
      this.clearPendingChildIndex(sessionId);
      // 消费型 run（subagent 子会话）也产出**内存级** settled 投影：子会话屏
      // 需要一个「上次生成」落点——单元宽限销毁/被 LRU 淘汰后指标条才有源。
      // 只写投影，不写 run_state、不落 session KKV（子会话 run 没有持久层行，
      // 跨重启也没有读回路径，落库只会留无人读的垃圾）；速率随投影一并冻结，
      // 与主会话同语义（末值快照）。
      this.settledProjections.set(sessionId, this.buildSettledProjection(unit));
      this.evictSettledOverflow();
      this.notifyChanged();
      return;
    }
    // Step 5：先丢弃写通 coalescer 的在途 pending 再写 settled 行——
    // 不 flush（pending 里的旧 partial 马上要被 settle 覆盖，flush 只是
    // 多一次无效写；更重要的是杜绝在途定时器把 settled 行覆盖回 running）。
    const inflight = this.writethroughs.get(sessionId);
    if (inflight != null) {
      this.writethroughs.delete(sessionId);
      inflight.dispose();
    }
    // 父收尾：settle 内已清空单元的 pendingChildren，这里同步清反查条目。
    this.clearPendingChildIndex(sessionId);
    // settled 行落库（partial 清空、metrics 保留——由 core settle 服务端
    // 强制）+ manager 级 settled 投影更新（「上次生成」常驻，不随单元
    // 宽限销毁/LRU 淘汰清除）。
    const snap = unit.snapshot();
    this.upsertSettledRunStateQuietly(unit);
    // 末值速率（stream-metrics-tokens）：随 settled 投影冻结显示，并落
    // session KKV 供跨重启水合读回。展示派生值——写失败只丢速率段。
    const projection = this.buildSettledProjection(unit);
    this.settledProjections.set(sessionId, projection);
    const kkv = this.runtime.sessionKkv;
    const finalRate = projection.rateTokensPerSecond;
    if (kkv != null && finalRate != null) {
      // runId 为本次 run 身份（加固字段，cr-fix-spec mobile-metrics/B-1）：
      // 水合读回时与 settled 行的 runId 比对，不一致即当缺值。空串（受理
      // 空窗内死亡的 run）省略该字段，写出的就是旧格式值。
      const payload = {
        rate: finalRate,
        tokens: snap.metrics.completionTokens,
        atMs: Date.now(),
        ...(snap.runId != null && snap.runId.length > 0
          ? {runId: snap.runId}
          : {}),
      };
      const serialized = serializeStreamFinalRateSnapshot(payload);
      // prettier-ignore
      const write = kkv.set(sessionId, METRICS_DOMAIN, FINAL_RATE_KEY, serialized);
      void write.catch(err =>
        log.warn('final rate persist failed', {sessionId, err}),
      );
    } else if (kkv != null) {
      // 本轮无速率（零输出/单样本不足）：必须清掉上一轮残留的 KKV 值——
      // 水合只按 sessionId 读，残留旧值会被拼到本轮「上次生成」上，等于
      // 凭空造数（cr-fix-spec mobile-metrics/B-1，缺值即省略速率段）。
      const removal = kkv.delete(sessionId, METRICS_DOMAIN, FINAL_RATE_KEY);
      void removal.catch(err =>
        log.warn('final rate delete failed', {sessionId, err}),
      );
    }
    this.evictSettledOverflow();
    this.notifyChanged();
    decrementAgentActive();
    this.stopKeepAliveQuietly(sessionId);

    if (status === 'failed') {
      // 失败反馈也收口在所有权校验之后：无主 FAILED 不弹 toast；
      // 桥未注入时用 log.error 兜底，不留无任何痕迹的失败。
      if (this.uiBridge != null) {
        this.uiBridge.onError(errorMessage ?? '生成失败');
      } else {
        log.error('run failed (uiBridge not ready)', {
          sessionId,
          runId,
          error: errorMessage,
        });
      }
    }

    unit.invokeOnSettled(status);
    // 完成通知：开关开才发（桥未注入时降级不发）；会话名尽力取、取不到不阻塞。
    void (async () => {
      if (this.prefBridge == null) {
        return;
      }
      const enabled = await this.prefBridge.isNotificationEnabled();
      if (!enabled) {
        return;
      }
      let sessionTitle: string | null | undefined;
      try {
        sessionTitle = (await this.runtime.sessions.get(sessionId))?.title;
      } catch {
        // 会话名取不到不阻塞通知
      }
      await notifyAgentRunFinished({sessionId, sessionTitle, status});
    })().catch(() => undefined);
  }

  /** 单会话收尾：摘标签（剩余会话由通知模块维持）；吞错但留日志，防 unhandled rejection。 */
  private stopKeepAliveQuietly(sessionId: string): void {
    void stopAgentKeepAliveService(sessionId).catch(err => {
      log.error('stopKeepAlive failed', {sessionId, err});
    });
  }

  /** 宽限到期：单元销毁出注册表（被替换/已销毁的不再处理）。 */
  private handleGraceExpired(sessionId: string, unit: SessionStreamUnit): void {
    if (this.units.get(sessionId) !== unit) {
      return;
    }
    this.removeUnit(sessionId, unit);
    this.notifyChanged();
  }

  /**
   * LRU 收口：settled 单元（含宽限中的与水合常驻的）超过上限时，按
   * settledAt 从旧到新淘汰，直到回到上限内。活跃单元不占槽、不参与淘汰。
   */
  private evictSettledOverflow(): void {
    const settled = [...this.units.values()].filter(unit =>
      isSessionStreamUnitSettled(unit.getStatus()),
    );
    if (settled.length <= this.maxSettledUnits) {
      return;
    }
    settled.sort(
      (a, b) => (a.getSettledAtMs() ?? 0) - (b.getSettledAtMs() ?? 0),
    );
    const excess = settled.length - this.maxSettledUnits;
    for (const unit of settled.slice(0, excess)) {
      this.removeUnit(unit.sessionId, unit);
    }
    this.notifyChanged();
  }

  /**
   * 单元出表统一收口：摘注册表 + 清子会话反查条目 + 写通 coalescer
   * 「尽力 flush + dispose」（T-U12 防旧写覆盖新 run 的行）+ 销毁单元。
   *
   * flush 而非直接丢弃的场景：finally 兜底（异常死亡、无终态事件）与
   * manager.dispose（runtime 重建前）——行留在 running 态 + 最新 partial
   * 落盘，重启水合恢复出的中断现场最完整。已收尾的单元（finishRun 已丢弃
   * 写通 coalescer）与水合 interrupted 单元（本就无 coalescer）在这里
   * 天然 no-op。
   */
  private removeUnit(sessionId: string, unit: SessionStreamUnit): void {
    // 消息面交接（Step 7 收口）：销毁前把投影消息面挪进 idle 视图——宽限
    // 销毁/LRU 淘汰/替换沿上，消息显示源从投影切 idle 无缝不断档。单元
    // 消息面为空时保留既有 idle（防 run 前历史消息被闪掉）。接管映射同批
    // 交接（R5）：丢了它，已接管的 assistant 行会回退 DB id → remount。
    const handover = unit.snapshot();
    if (handover.messages.length > 0) {
      const base = this.idleStreamRowIds(sessionId);
      const incoming = handover.streamRowIds;
      let changed = false;
      for (const [messageId, streamId] of incoming) {
        if (base.get(messageId) !== streamId) {
          changed = true;
          break;
        }
      }
      let streamRowIds = base;
      if (changed) {
        const merged = new Map(base);
        for (const [messageId, streamId] of incoming) {
          merged.set(messageId, streamId);
        }
        // 与单元侧同口径有界化：合并两代映射后不能突破 200 条（P1-3）。
        if (merged.size > STREAM_ROW_IDS_LIMIT) {
          streamRowIds = new Map([...merged].slice(-STREAM_ROW_IDS_LIMIT));
        } else {
          streamRowIds = merged;
        }
      }
      this.idleMessageViews.set(sessionId, {
        messages: [...handover.messages],
        hasMoreMessages: handover.hasMoreMessages,
        streamRowIds,
      });
    }
    this.units.delete(sessionId);
    this.consumptiveSessions.delete(sessionId);
    this.clearPendingChildIndex(sessionId);
    this.flushAndDisposeWritethrough(sessionId);
    unit.destroy();
  }

  /** 把单元当前快照 append 进该会话的写通 coalescer（无 coalescer no-op）。 */
  private appendWritethroughSnapshot(unit: SessionStreamUnit): void {
    const writethrough = this.writethroughs.get(unit.sessionId);
    if (writethrough == null) {
      return;
    }
    writethrough.append(this.runStateRowFromSnapshot(unit));
  }

  /** 单元快照 → run_state 行（partial 全量覆盖写；空值存 null）。 */
  private runStateRowFromSnapshot(unit: SessionStreamUnit): SessionRunState {
    const snap = unit.snapshot();
    return {
      sessionId: unit.sessionId,
      projectId: unit.projectId,
      runId: snap.runId ?? '',
      status: 'running',
      startedAtMs: snap.startedAtMs,
      textChars: snap.metrics.textChars,
      thinkingChars: snap.metrics.thinkingChars,
      completionTokens: snap.metrics.completionTokens,
      tokenSource: snap.metrics.tokenSource,
      partialText: snap.partialText.length > 0 ? snap.partialText : null,
      partialThinking:
        snap.partialThinking.length > 0 ? snap.partialThinking : null,
      pendingChildrenJson:
        snap.pendingChildren.length > 0
          ? JSON.stringify([...snap.pendingChildren])
          : null,
      updatedAtMs: Date.now(),
    };
  }

  /** upsert 覆盖写（fire-and-forget，失败吞错留日志；无持久层 no-op）。 */
  private upsertRunStateQuietly(state: SessionRunState): void {
    if (this.runStateStore == null) {
      return;
    }
    this.runStateStore.upsert(state).catch(err => {
      log.error('run_state upsert failed', {sessionId: state.sessionId, err});
    });
  }

  /** settle 收尾写（fire-and-forget，失败吞错留日志；无持久层 no-op）。 */
  private upsertSettledRunStateQuietly(unit: SessionStreamUnit): void {
    const store = this.runStateStore;
    if (store == null) {
      return;
    }
    const snap = unit.snapshot();
    const sessionId = unit.sessionId;
    const state: SessionRunStateSettleInput = {
      sessionId,
      projectId: unit.projectId,
      runId: snap.runId ?? '',
      startedAtMs: snap.startedAtMs,
      textChars: snap.metrics.textChars,
      thinkingChars: snap.metrics.thinkingChars,
      completionTokens: snap.metrics.completionTokens,
      tokenSource: snap.metrics.tokenSource,
      updatedAtMs: Date.now(),
    };
    store.settle(state).catch(err => {
      log.error('run_state settle failed', {sessionId, err});
    });
  }

  /**
   * settled 投影装配单点（消费型与非消费型两条收尾分支共用）：
   * 冻结指标 + 历时（settledAtMs 缺省补当前时刻）+ 末值速率快照。
   *
   * 两分支的字段口径只在这里维护，防一侧改动另一侧漂移
   * （cr-fix-spec mobile-metrics/C-2）。持久层/KKV 的差异留在调用方：
   * 消费型 run 只进内存投影，发起型 run 另落 run_state 与 session KKV。
   */
  // prettier-ignore
  private buildSettledProjection(unit: SessionStreamUnit): SessionStreamSettledProjection {
    const snap = unit.snapshot();
    return {
      sessionId: unit.sessionId,
      metrics: snap.metrics,
      startedAtMs: snap.startedAtMs,
      settledAtMs: snap.settledAtMs ?? Date.now(),
      elapsedMs: snap.elapsedMs ?? 0,
      rateTokensPerSecond: unit.getFinalRateTokensPerSecond(),
    };
  }

  /** 写通 coalescer 收口（尽力 flush + dispose + 出表；flush 内部吞错）。 */
  private flushAndDisposeWritethrough(sessionId: string): void {
    const writethrough = this.writethroughs.get(sessionId);
    if (writethrough == null) {
      return;
    }
    this.writethroughs.delete(sessionId);
    writethrough.flush();
    writethrough.dispose();
  }

  private isActiveUnit(unit: SessionStreamUnit): boolean {
    const status = unit.getStatus();
    return status === 'starting' || status === 'running';
  }

  /**
   * 校准探针的活跃会话列举：只含 runId 已回填的 running 单元。starting
   * 单元（runId 由 RUN_STARTED 回填）不参与校准——**判据是 runId 非空，与
   * registry 注册时机无关**（core 的 register 在 runAgentTurn 函数入口执行，
   * 受理即在途）；该形态的死单由 startRun 的 promise 链尾 finally 兜底收口。
   */
  private listCalibratableSessionIds(): readonly string[] {
    const ids: string[] = [];
    for (const [sessionId, unit] of this.units) {
      if (this.isActiveUnit(unit) && unit.getRunId() != null) {
        ids.push(sessionId);
      }
    }
    return ids;
  }

  private notifyChanged(): void {
    // 校准轮询随活跃单元启停（空闲零常驻定时器）——notifyChanged 是单元
    // 状态变化的总线，这里同步一次即可覆盖受理/回填/收尾/销毁全部沿。
    const calibratableCount = this.listCalibratableSessionIds().length;
    this.calibrationProbe?.setPollingEnabled(calibratableCount > 0);
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  /**
   * Provider retry 重建 runtime 前的销毁：退订事件总线、销毁全部单元、
   * 按「活跃单元」逐个递减模块级 refcount（settled 单元收尾时已减过，
   * 不双减；decrement 对 0 幂等）、停止前台服务。
   *
   * 必须在 closeMobileConnection 之前调用（先 detach、后销毁连接）。
   * 不撤销已透传给 core 的回调；dispose 后旧 Manager 不再触发 onSettled，
   * 在途 run 的后续 FINISHED/FAILED 由新 Manager 接管（无单元不 decrement，
   * 防负）。
   */
  dispose(): void {
    this.disposed = true;
    this.offNotificationTap?.();
    this.offNotificationTap = undefined;
    this.calibrationProbe?.dispose();
    this.calibrationProbe = undefined;
    this.calibrationAppStateSub?.remove();
    this.calibrationAppStateSub = undefined;
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions.length = 0;
    for (const unit of [...this.units.values()]) {
      // 模块级计数不随 runtime 重建归零，必须由 dispose 显式清零——
      // 但只清活跃 run 的计数（settled 单元在 finishRun 时已 decrement；
      // 消费型单元从未 increment）。
      if (
        !isSessionStreamUnitSettled(unit.getStatus()) &&
        !this.consumptiveSessions.has(unit.sessionId)
      ) {
        decrementAgentActive();
      }
      this.removeUnit(unit.sessionId, unit);
    }
    this.pendingChildParentByChild.clear();
    this.consumptiveSessions.clear();
    // 写通兜底：单元出表路径已逐一收口，理论上表空；防御性清一遍残留
    //（同样尽力 flush——连接可能已关，失败由 coalescer 吞掉不阻塞）。
    for (const sessionId of [...this.writethroughs.keys()]) {
      this.flushAndDisposeWritethrough(sessionId);
    }
    this.settledProjections.clear();
    this.idleMessageViews.clear();
    this.idleLoadingMore.clear();
    this.notifyChanged();
    this.listeners.clear();
    void stopAgentKeepAliveService().catch(() => undefined);
  }

  /**
   * test-only 尺寸探针（形态对齐 `chat-session-view-cache` 的 `*CacheSize()` 先例）：
   * 两张表是 private 且无注入口，LRU 封顶只能靠外部灌数 + 读 size 观测。
   * 生产代码零调用；随这两张表的实现一起回滚。
   *
   * nm-style: keep-public — spec §7.1.3 点名的测试访问器之一。
   */
  idleMessageViewsSize(): number {
    return this.idleMessageViews.size;
  }

  /**
   * test-only 尺寸探针（语义同 {@link idleMessageViewsSize}）。
   *
   * nm-style: keep-public — spec §7.1.3 点名的测试访问器之一。
   */
  settledProjectionsSize(): number {
    return this.settledProjections.size;
  }
}
