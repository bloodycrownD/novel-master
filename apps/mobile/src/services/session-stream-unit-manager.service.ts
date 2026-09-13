/**
 * 会话流式单元编排器（SessionStreamUnitManager，React 树外）。
 *
 * 以 agent-run-manager.service.ts 为模板原样吸收其契约（Step 2；旧文件的
 * 拆除与调用方接线分别在 Step 7 / Step 6 完成）：
 * - per-session 门禁：该会话存在 starting|running 状态的单元，或
 *   abortRegistry.has(sessionId) 任一为真即拒绝（封住「受理 → core register」
 *   之间的异步空窗）；settled 单元（interrupted/finished/failed，含宽限中）
 *   不阻塞新 run——interrupted 单元在 startRun 时被替换/吸收（删旧建新：
 *   run_id 更新、状态机回 starting、partial/注入标记与 metrics 随新单元
 *   天然重置），不产生双单元并存；
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
 * 走 finishRun('failed') 等效收尾；starting 单元不参与（受理空窗防误杀）。
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
  EVENT_SUBAGENT_CHILD_SESSION_CREATED,
} from '@novel-master/core/events';
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
  AgentStepCommittedPayload,
  AgentStreamTextDeltaPayload,
  AgentStreamThinkingDeltaPayload,
  SubagentChildSessionCreatedPayload,
} from '@novel-master/core/events';
import type {SendAnnotateDraft} from '@novel-master/core/chat';
import type {ChatMessage} from '@novel-master/core/chat';
import type {EventSubscription} from '@novel-master/core/events';
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
import {timingLog} from '@/debug/run-timing';
import {
  ensureAgentNotificationPermission,
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
} from '@/services/session-stream-unit';
import type {
  SessionStreamRunSettledStatus,
  SessionStreamUnitMetrics,
  SessionStreamUnitView,
  SessionStreamWebviewHandle,
} from '@/services/session-stream-unit';
import {createRunStateWritethrough} from '@/services/run-state-writethrough';
import type {RunStateWritethrough} from '@/services/run-state-writethrough';
import {
  createRunFinishCalibrationProbe,
  type RunFinishCalibrationProbe,
} from '@/services/run-finish-calibration-probe';
import {
  getSessionViewCache,
  sessionViewCacheKey,
  setSessionViewCache,
} from '@/services/chat-session-view-cache';
import {prependOlderMessages} from '@/services/message-paging';
import {createQuantumYield} from '@/services/yield-quantum';
import {AppState} from 'react-native';

/** settled 单元并存的 LRU 上限（含宽限中的与水合常驻的；活跃单元不占槽）。 */
export const SESSION_STREAM_MAX_SETTLED_UNITS = 8;

/**
 * 无单元会话的消息面视图（Step 7 消息面收口：非运行态会话的消息兜底，
 * 原 useChatTabMessages 数据管线的等价语义迁入 manager）。
 */
interface IdleMessageView {
  readonly messages: readonly ChatMessage[];
  readonly hasMoreMessages: boolean;
  readonly loadingMoreMessages: boolean;
}

/** Manager 实际依赖的 runtime 子集（测试可传 mock）。messages 为 Step 4 消息管线所需。 */
export type SessionStreamManagerRuntime = Pick<
  MobileNovelMasterRuntime,
  'eventBus' | 'abortRegistry' | 'sessions' | 'projects' | 'messages'
>;

/** fire-and-forget 的 runAgentTurn 形状（测试可注入 mock）。 */
type RunAgentTurnFn = (
  runtime: SessionStreamManagerRuntime,
  scope: {projectId: string; sessionId: string},
  content: string,
  options?: SessionStreamStartOptions,
) => Promise<unknown>;

/** startRun 的 options 契约（供 ChatComposer.executeRun 等 UI 侧消费）。 */
export interface SessionStreamStartOptions {
  /** 原样透传给 runAgentTurn。 */
  readonly stream?: boolean;
  readonly annotateDrafts?: readonly SendAnnotateDraft[];
  readonly allowResumeWithoutInput?: boolean;
  /**
   * 用户消息 append 成功后回调（透传 runAgentTurn 同名回调）——
   * UI 侧在此清批注草稿与输入草稿（失败不丢草稿的既有语义不变）。
   */
  readonly onUserMessageAppended?: () => void | Promise<void>;
  /** run 终态回调（由事件订阅驱动，与 UI 面板可见性无关）。 */
  readonly onSettled?: (status: SessionStreamRunSettledStatus) => void;
}

/** startRun 同步返回的受理/拒绝结果（拒绝时带明确错误信息）。 */
export type SessionStreamStartResult =
  | {readonly ok: true}
  | {readonly ok: false; readonly error: string};

/** 失败 toast 上浮桥（Manager 在 React 外，经 Provider 注入）。 */
export interface SessionStreamUiBridge {
  onError(message: string): void;
}

/** 通知偏好读取桥（appUi 通道）：isNotificationEnabled = 消息通知总开关
 * （默认开）——同时管生成结束通知与生成期间常驻保活，一个开关整体启停。 */
export interface SessionStreamPrefBridge {
  isNotificationEnabled(): Promise<boolean>;
}

/** scope 同步桥：通知点按后切换会话（React 外）；读取当前会话用于去重切换。 */
export interface SessionStreamScopeBridge {
  /** 当前会话 id（无会话/未就绪为 null）。 */
  getCurrentSessionId(): string | null;
  setCurrentSession(sessionId: string): Promise<void>;
}

/**
 * run 状态持久层窄口（manager 只消费这三个方法；真装配为 core 的
 * `createSessionRunStateService(conn)`，测试注入 mock）。不注入时
 * manager 无持久化行为（纯内存，Step 2-4 的既有语义）。
 */
export interface SessionStreamRunStateStore {
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
export interface SessionStreamSettledProjection {
  readonly sessionId: string;
  /** 冻结的最终指标（「上次生成」的数据源）。 */
  readonly metrics: SessionStreamUnitMetrics;
  /** run 开始时刻（毫秒）；starting 阶段中断的 run 可能为 0。 */
  readonly startedAtMs: number;
  /** 收尾时刻（毫秒）；持久层回填时以 updated_at_ms 近似。 */
  readonly settledAtMs: number;
  /** 终态冻结的历时 =「上次生成」；回填时以 settledAtMs-startedAtMs 近似。 */
  readonly elapsedMs: number;
}

export interface SessionStreamUnitManagerParams {
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
  private readonly subscriptions: EventSubscription[] = [];
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
  private readonly runStateStore:
    | SessionStreamRunStateStore
    | undefined;
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
  /** settled 投影常驻 map（独立于单元生命周期，见接口注释）。 */
  private readonly settledProjections = new Map<
    string,
    SessionStreamSettledProjection
  >();
  /** 无单元会话的消息面（Step 7 收口：idle 会话 tail/分页的落点）。 */
  private readonly idleMessageViews = new Map<string, IdleMessageView>();
  /** 水合流程的单飞 promise（构造 kick 一次；hydrate 幂等复用）。 */
  private hydratePromise: Promise<void> | null = null;

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
  private permissionEnsured = false;
  private hydratedValue = false;

  constructor(params: SessionStreamUnitManagerParams) {
    this.runtime = params.runtime;
    // 默认实现的完整 options 类型比 SessionStreamStartOptions 宽，调用点只传子集，安全断言。
    this.runAgentTurnFn =
      params.runAgentTurn ?? (defaultRunAgentTurn as RunAgentTurnFn);
    this.settledGraceMs = params.settledGraceMs;
    this.maxSettledUnits =
      params.maxSettledUnits ?? SESSION_STREAM_MAX_SETTLED_UNITS;
    this.runStateStore = params.runStateService;
    this.writethroughOptions = params.writethrough;
    this.yieldQuantum = params.yieldQuantum ?? createQuantumYield();

    // 全量订阅 run 生命周期事件（不经 UI 面板过滤）。
    this.subscriptions.push(
      this.runtime.eventBus.subscribe(
        EVENT_AGENT_RUN_STARTED,
        (payload: AgentRunStartedPayload) => this.onRunStarted(payload),
      ),
      this.runtime.eventBus.subscribe(
        EVENT_AGENT_RUN_FINISHED,
        (payload: AgentRunFinishedPayload) => this.onRunFinished(payload),
      ),
      this.runtime.eventBus.subscribe(
        EVENT_AGENT_RUN_FAILED,
        (payload: AgentRunFailedPayload) => this.onRunFailed(payload),
      ),
    );

    // 流式事件订阅（Step 3）：按 sessionId 路由进对应单元的管线方法——
    // 无单元（子会话 run / 旧连接残留）自然落空。delta 高频不触发投影通知，
    // 通知由单元的 apply 节拍（64ms）回调 onProjectionChanged 驱动。
    // Step 5：delta 生效（ingest 返回 true）即把最新快照 append 进该会话
    // 的写通 coalescer（250ms 合并；settled/interrupted 单元的陈旧 delta
    // 被 ingest 守卫拦截，不产生持久层写）。
    this.subscriptions.push(
      this.runtime.eventBus.subscribe(
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
      this.runtime.eventBus.subscribe(
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
      this.runtime.eventBus.subscribe(
        EVENT_AGENT_STEP_COMMITTED,
        (payload: AgentStepCommittedPayload) => this.onStepCommitted(payload),
      ),
      this.runtime.eventBus.subscribe(
        EVENT_SUBAGENT_CHILD_SESSION_CREATED,
        (payload: SubagentChildSessionCreatedPayload) =>
          this.onChildSessionCreated(payload),
      ),
    );

    // 通知点按：切 scope 到目标会话（已在目标会话则跳过切换）+ 导航 Chat tab。
    // onBackgroundEvent 为模块级一次注册（handler 引用替换），不随实例退订；
    // 这里只握 onForegroundEvent 的退订函数，dispose 时退订。
    this.offNotificationTap = registerAgentNotificationTapHandling(
      sessionId => {
        if (this.scopeBridge?.getCurrentSessionId() !== sessionId) {
          void this.scopeBridge
            ?.setCurrentSession(sessionId)
            .catch(() => undefined);
        }
        navigateToChatTabFromNotification();
      },
    );

    // 收尾校准探针（Step 7 自旧 run 探针的收尾方向迁入）：低频轮询 +
    // 前台回焦校准「running 单元 + registry 无注册」的悬挂现场，防 core
    // 终态事件丢失导致「生成中」永久残留。starting 单元不参与（受理空窗
    // 内 registry 尚未注册，校准必误杀；该场景由 finally 兜底）。
    this.calibrationProbe = createRunFinishCalibrationProbe({
      activeSessionIds: () => this.listCalibratableSessionIds(),
      isRunRegistered: sessionId => this.runtime.abortRegistry.has(sessionId),
      onRunLost: sessionId => this.finishLostRun(sessionId),
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

  /** Provider ready 后注入 UI toast 桥。 */
  setUiBridge(bridge: SessionStreamUiBridge): void {
    this.uiBridge = bridge;
  }

  /** Provider ready 后注入偏好读取桥。 */
  setPrefBridge(bridge: SessionStreamPrefBridge): void {
    this.prefBridge = bridge;
  }

  /** Provider ready 后注入 scope 桥。 */
  setScopeBridge(bridge: SessionStreamScopeBridge): void {
    this.scopeBridge = bridge;
  }

  /** 水合是否完成（完成前 snapshot 一律 null——会话呈现为无 run）。 */
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
   */
  hydrate(): Promise<void> {
    if (this.hydratePromise != null) {
      return this.hydratePromise;
    }
    const run = (async () => {
      const store = this.runStateStore;
      if (store == null) {
        this.markHydrated();
        return;
      }
      const activeRows = await store.listByStatuses([
        'starting',
        'running',
      ]);
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
        const unit = this.adoptInterruptedUnit(
          row.sessionId,
          row.projectId,
        );
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
          },
          partialText: row.partialText ?? '',
          partialThinking: row.partialThinking ?? '',
          pendingChildren,
        });
      }
      const settledRows = await store.listByStatuses(['settled']);
      for (const row of settledRows) {
        // settled 回填同款分片让步 + disposed 复查：dispose 已清空的
        // settledProjections 不再被后续行回填（防死 manager 泄漏条目）。
        await this.yieldQuantum();
        if (this.disposed) {
          this.markHydrated();
          return;
        }
        this.settledProjections.set(row.sessionId, {
          sessionId: row.sessionId,
          metrics: {
            textChars: row.textChars,
            thinkingChars: row.thinkingChars,
          },
          startedAtMs: row.startedAtMs,
          settledAtMs: row.updatedAtMs,
          elapsedMs: Math.max(0, row.updatedAtMs - row.startedAtMs),
        });
      }
      this.markHydrated();
    })();
    this.hydratePromise = run.catch(err => {
      console.error(
        '[novel-master/session-stream-unit-manager] hydrate failed',
        err,
      );
      this.markHydrated();
    });
    return this.hydratePromise;
  }

  /**
   * settled 投影读取（Step 6 指标条消费面）：该会话「上次生成」的冻结
   * 快照；无收尾记录为 null。运行中单元的实时指标走 snapshot(sessionId)
   * 的 metrics/startedAtMs（消费方按需合并两源）。
   */
  getSettledProjection(
    sessionId: string,
  ): SessionStreamSettledProjection | null {
    return this.settledProjections.get(sessionId) ?? null;
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
    this.notifyChanged();
  }

  /** 某 session 当前是否有进行中的 run（starting|running 单元）。 */
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
   * 请求该会话单元向全句柄广播 reset-stream 控制消息（Step 6 屏幕接线：
   * 消息操作 rollback/fork 等场景清流式显示的单元等效，对应 webview 的
   * resetStream；无单元 no-op）。
   */
  requestStreamReset(sessionId: string): void {
    this.units
      .get(sessionId)
      ?.broadcastControlMessage({type: 'reset-stream'});
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

  /** 当前注册表中的单元总数（含活跃与 settled；诊断/测试用）。 */
  unitCount(): number {
    return this.units.size;
  }

  /**
   * 把 webview 句柄挂到该会话的单元（Step 6 屏幕接线的消费面；无单元
   * no-op）。单元内会在 attach 时尝试注入本 step 已累积的 partial。
   */
  attachWebview(
    sessionId: string,
    handle: SessionStreamWebviewHandle,
  ): void {
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
  async loadSessionTailMessages(
    sessionId: string,
    options?: {readonly force?: boolean; readonly projectId?: string},
  ): Promise<readonly ChatMessage[] | null> {
    const unit = this.units.get(sessionId);
    if (unit != null) {
      return unit.loadTailMessages(
        options?.force != null ? {force: options.force} : undefined,
      );
    }
    return this.loadIdleTailMessages(sessionId, options);
  }

  /**
   * 分页加载更早消息：有单元走单元管线；无单元走 idle 分页（以 idle 视图
   * 首行 seq 为锚向上翻页，结果写 view cache 与 idle 视图）。
   */
  loadOlderSessionMessages(
    sessionId: string,
    projectId?: string,
  ): Promise<void> {
    const unit = this.units.get(sessionId);
    if (unit != null) {
      return unit.loadOlderMessages();
    }
    return this.loadIdleOlderMessages(sessionId, projectId);
  }

  /**
   * 消息面统一读取口（Step 7 收口：Provider 消息显示的单一来源）：
   * - 有单元：走投影字段（tail/分页/step reload 均为单元消息面）——
   *   单元消息面为空且 idle 有值时回落 idle（新 run 替换沿 starting 单元
   *   尚未加载，回落防历史消息闪空）；
   * - 无单元：idle 视图（从未加载过为 null，消费方按空处理）。
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
        };
      }
      const idle = this.idleMessageViews.get(sessionId);
      if (idle != null) {
        return {...idle};
      }
      return {
        messages: snap.messages,
        hasMoreMessages: snap.hasMoreMessages,
        loadingMoreMessages: snap.loadingMoreMessages,
      };
    }
    const idle = this.idleMessageViews.get(sessionId);
    return idle != null ? {...idle} : null;
  }

  /**
   * 同步水合（会话切换防闪，原 useChatTabMessages.hydrateFromSessionCache
   * 的等价语义）：view cache 命中即采纳进 idle 视图、miss 清空；有单元
   * （投影接管消息面）no-op。写完通知一次。
   */
  hydrateSessionMessages(projectId: string, sessionId: string): void {
    if (this.units.has(sessionId)) {
      return;
    }
    const cached = getSessionViewCache(
      sessionViewCacheKey(projectId, sessionId),
    );
    if (cached != null) {
      this.idleMessageViews.set(sessionId, {
        messages: [...cached.messages],
        hasMoreMessages: cached.hasMoreMessages,
        loadingMoreMessages: false,
      });
    } else {
      this.idleMessageViews.set(sessionId, {
        messages: [],
        hasMoreMessages: false,
        loadingMoreMessages: false,
      });
    }
    this.notifyChanged();
  }

  /** idle 路径 tail 加载：缓存命中采纳 → 回源窄窗 + hasMore 探针 → 写缓存。 */
  private async loadIdleTailMessages(
    sessionId: string,
    options?: {readonly force?: boolean; readonly projectId?: string},
  ): Promise<readonly ChatMessage[] | null> {
    const force = options?.force ?? false;
    const projectId = options?.projectId;
    if (projectId != null && !force) {
      const cached = getSessionViewCache(
        sessionViewCacheKey(projectId, sessionId),
      );
      if (cached != null) {
        this.applyIdleMessages(sessionId, cached.messages, cached.hasMoreMessages);
        return [...cached.messages];
      }
    }
    const list = await this.runtime.messages.listBySessionTail(sessionId, {
      limit: SESSION_STREAM_MESSAGES_PAGE_SIZE,
    });
    let hasMore = false;
    const oldestSeq = list[0]?.seq;
    if (oldestSeq != null) {
      const older = await this.runtime.messages.listBySessionPage(sessionId, {
        limit: 1,
        beforeSeq: oldestSeq,
      });
      hasMore = older.length > 0;
    }
    if (projectId != null) {
      setSessionViewCache(sessionViewCacheKey(projectId, sessionId), {
        messages: list,
        hasMoreMessages: hasMore,
      });
    }
    this.applyIdleMessages(sessionId, list, hasMore);
    return [...list];
  }

  /** idle 路径分页：以 idle 视图首行 seq 为锚向上翻页，prepend 后写缓存。 */
  private async loadIdleOlderMessages(
    sessionId: string,
    projectId?: string,
  ): Promise<void> {
    const idle = this.idleMessageViews.get(sessionId);
    if (idle == null || idle.loadingMoreMessages || idle.messages.length === 0) {
      return;
    }
    const beforeSeq = idle.messages[0]?.seq;
    if (beforeSeq == null) {
      return;
    }
    this.idleMessageViews.set(sessionId, {...idle, loadingMoreMessages: true});
    this.notifyChanged();
    try {
      const older = await this.runtime.messages.listBySessionPage(sessionId, {
        limit: SESSION_STREAM_MESSAGES_PAGE_SIZE,
        beforeSeq,
      });
      const current = this.idleMessageViews.get(sessionId);
      if (current == null) {
        return;
      }
      if (older.length === 0) {
        this.idleMessageViews.set(sessionId, {
          ...current,
          hasMoreMessages: false,
          loadingMoreMessages: false,
        });
        this.notifyChanged();
        return;
      }
      const hasMore = older.length === SESSION_STREAM_MESSAGES_PAGE_SIZE;
      const next = prependOlderMessages(current.messages, older);
      if (projectId != null) {
        setSessionViewCache(sessionViewCacheKey(projectId, sessionId), {
          messages: next,
          hasMoreMessages: hasMore,
        });
      }
      this.idleMessageViews.set(sessionId, {
        messages: next,
        hasMoreMessages: hasMore,
        loadingMoreMessages: false,
      });
      this.notifyChanged();
    } finally {
      const current = this.idleMessageViews.get(sessionId);
      if (current?.loadingMoreMessages) {
        this.idleMessageViews.set(sessionId, {
          ...current,
          loadingMoreMessages: false,
        });
        this.notifyChanged();
      }
    }
  }

  /** 采纳 idle 消息面并通知（通知驱动 Provider 的消息快照刷新）。 */
  private applyIdleMessages(
    sessionId: string,
    messages: readonly ChatMessage[],
    hasMore: boolean,
  ): void {
    this.idleMessageViews.set(sessionId, {
      messages: [...messages],
      hasMoreMessages: hasMore,
      loadingMoreMessages: false,
    });
    this.notifyChanged();
  }

  /**
   * 请求该会话单元向全句柄广播 force 快照（subagent 长任务期间消息可见
   * 的屏幕驱动入口；无单元 no-op）。
   */
  requestForceSnapshot(sessionId: string): void {
    this.units.get(sessionId)?.requestForceSnapshot();
  }

  /**
   * 发起 run：per-session 门禁 + fire-and-forget。
   *
   * 门禁钉死「该会话存在 starting|running 单元或 abortRegistry.has 为真即
   * 拒绝，返回明确错误而非静默」——core 的 register 要到 run-agent-turn 内
   * 用户消息 append 之后才执行，只看 registry 会在受理空窗内漏放第二个
   * 同会话 run。settled 单元不阻塞：interrupted/finished/failed（含宽限中）
   * 的旧单元被替换吸收——删旧建新（run_id 更新、状态机回 starting、
   * partial/注入标记/metrics 随新单元重置），无双单元并存。
   *
   * 受理路径同步 increment refcount（对齐 desktop agent.ts 的形状），decrement
   * 由事件订阅 / finally 早退兜底负责；startRun 本身同步返回，不 await run。
   */
  startRun(
    sessionId: string,
    projectId: string,
    content: string,
    options?: SessionStreamStartOptions,
  ): SessionStreamStartResult {
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
    if (existing != null) {
      this.removeUnit(sessionId, existing);
    }
    const unit = new SessionStreamUnit({
      sessionId,
      projectId,
      messageStore: this.runtime.messages,
      onSettled: options?.onSettled,
      settledGraceMs: this.settledGraceMs,
      onGraceExpired: expired => this.handleGraceExpired(sessionId, expired),
      onProjectionChanged: () => this.notifyChanged(),
    });
    unit.begin();
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
      partialText: null,
      partialThinking: null,
      pendingChildrenJson: null,
      updatedAtMs: Date.now(),
    });
    this.notifyChanged();
    timingLog('notifyChanged done (metrics bar scheduled)');
    incrementAgentActive();
    this.startKeepAliveQuietly(sessionId, projectId);
    void this.maybeEnsureNotificationPermission();

    timingLog('runAgentTurn invoke');
    void this.runAgentTurnFn(this.runtime, {projectId, sessionId}, content, {
        stream: options?.stream,
        annotateDrafts: options?.annotateDrafts,
        allowResumeWithoutInput: options?.allowResumeWithoutInput,
        onUserMessageAppended: options?.onUserMessageAppended,
      })
      .catch(err => {
        console.error('[novel-master/session-stream-unit-manager] run failed', {
          sessionId,
          projectId,
          err:
            err instanceof Error
              ? {name: err.name, message: err.message}
              : String(err),
        });
        // 仅 resolve/register 阶段错误（RUN_STARTED 未达，FAILED 事件永远不会来）
        // 才由 throw 路径兜底 toast；RUN_STARTED 已达的失败 core 必发
        // EVENT_AGENT_RUN_FAILED，事件路径（finishRun）已 onError，这里再弹
        // 就是同一次失败的双 toast。单元非本次（事件已收尾或已被替换）同理不弹。
        const current = this.units.get(sessionId);
        if (current === unit && current.getRunId() == null) {
          this.uiBridge?.onError(
            err instanceof Error ? err.message : String(err),
          );
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
      return false;
    }
    this.runtime.abortRegistry.abort(sessionId);
    return true;
  }

  /**
   * 水合入口（Step 5 填实扫描逻辑后由水合流程调用）：为该会话建一个
   * interrupted 态单元入注册表（partial/指标/子会话链接由水合流程回填，
   * 本节点只立入口与替换/LRU 语义）。返回单元供回填；若该会话已有单元
   * （settled）则被替换销毁——活跃单元场景下水合流程不应调用。
   */
  adoptInterruptedUnit(sessionId: string, projectId: string): SessionStreamUnit {
    const unit = new SessionStreamUnit({
      sessionId,
      projectId,
      messageStore: this.runtime.messages,
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

  /** RUN_STARTED 只做单元状态迁移与 runId 回填，不碰 refcount。 */
  private onRunStarted(payload: AgentRunStartedPayload): void {
    timingLog(`RUN_STARTED arrived (s=${payload.sessionId.slice(0, 4)})`);
    let unit = this.units.get(payload.sessionId);
    if (unit == null) {
      // Step 6 消费型单元：非本 manager 发起的 run（subagent 子会话 run）。
      // 子会话屏订阅 manager 取投影/注入，需要子会话 run 有单元落点；
      // 该类单元不占 refcount（refcount 归属发起方 run 的 startRun）、
      // 不写持久层（session_run_state 行只记录经 startRun 发起的 run）。
      unit = this.adoptConsumptiveUnit(payload.sessionId, payload.projectId);
    }
    if (!unit.markRunning(payload.runId)) {
      return;
    }
    if (!this.consumptiveSessions.has(payload.sessionId)) {
      // Step 5：挂写通 coalescer（供后续 delta append）+ 直接写 running 行
      //（runId/startedAtMs 回填；一次性事件不走节流）。消费型单元跳过。
      this.ensureWritethrough(payload.sessionId);
      const snap = unit.snapshot();
      this.upsertRunStateQuietly(this.runStateRowFromSnapshot(unit, snap));
    }
    this.notifyChanged();
  }

  /**
   * 建消费型单元（Step 6）：接收型落点，仅由 onRunStarted 在无单元时调用。
   * 状态机直接 idle → starting（begin），随后由调用方 markRunning 回填 runId。
   */
  private adoptConsumptiveUnit(
    sessionId: string,
    projectId: string,
  ): SessionStreamUnit {
    const unit = new SessionStreamUnit({
      sessionId,
      projectId,
      messageStore: this.runtime.messages,
      onProjectionChanged: () => this.notifyChanged(),
    });
    unit.begin();
    this.consumptiveSessions.add(sessionId);
    this.units.set(sessionId, unit);
    return unit;
  }

  /**
   * STEP_COMMITTED：step 边界冲刷 + partial 清零 + 注入标记复位。
   * 单元内含 runId 所有权守卫，生效才触发投影通知。Step 5：生效后把
   * partial 已清零的新快照 append 进 coalescer 并立即 flush（step 边界
   * 立即刷——落盘行反映 step 边界状态，而非 append 时刻的旧 partial）。
   */
  private onStepCommitted(payload: AgentStepCommittedPayload): void {
    const unit = this.units.get(payload.sessionId);
    if (unit == null || !unit.handleStepCommitted(payload.runId)) {
      return;
    }
    this.appendWritethroughSnapshot(unit);
    this.writethroughs.get(payload.sessionId)?.flush();
    this.notifyChanged();
  }

  /**
   * child-created：按 parentSessionId 路由进父单元登记（去重在单元内），
   * 同时记反查表供子会话终态摘除。无父单元（父 run 已结束/不在本进程）
   * 自然落空。
   */
  private onChildSessionCreated(
    payload: SubagentChildSessionCreatedPayload,
  ): void {
    const unit = this.units.get(payload.parentSessionId);
    if (unit == null) {
      return;
    }
    this.pendingChildParentByChild.set(
      payload.childSessionId,
      payload.parentSessionId,
    );
    if (unit.registerPendingChild(payload.childSessionId, payload.title)) {
      // 链接变化进写通节流窗（不立即刷——低频事件，等下个窗口即可；
      // 重启恢复晚一个窗口可接受）。
      this.appendWritethroughSnapshot(unit);
      this.notifyChanged();
    }
  }

  /** 清掉指向某父会话的全部反查条目（父收尾/单元出表时调用）。 */
  private clearPendingChildIndex(parentSessionId: string): void {
    for (const [childId, parent] of this.pendingChildParentByChild) {
      if (parent === parentSessionId) {
        this.pendingChildParentByChild.delete(childId);
      }
    }
  }

  private onRunFinished(payload: AgentRunFinishedPayload): void {
    this.finishRun(payload.sessionId, payload.runId, 'finished');
  }

  private onRunFailed(payload: AgentRunFailedPayload): void {
    // toast / 兜底日志收口在 finishRun 的所有权匹配分支内：无单元或 runId
    // 不匹配的 FAILED（subagent 子 run、旧连接残留）不弹也不刷日志。
    this.finishRun(payload.sessionId, payload.runId, 'failed', payload.error);
  }

  /** FINISHED/FAILED 收尾：runId 匹配才 settle 单元 + decrement + onSettled/通知。 */
  private finishRun(
    sessionId: string,
    runId: string,
    status: SessionStreamRunSettledStatus,
    errorMessage?: string,
  ): void {
    // 子会话 run 终态（sessionId 为子会话 id）不摘除父单元的 pending 链接：
    // 并行 task 批的 tool_results 要等最慢子 agent 完成才整批落库
    // （meta.subagentSessionId 才接管任务卡可点性），窗口期里 pending 映射
    // 是任务卡唯一可点数据源。链接由父 run 收尾（settle 内
    // clearPendingChildren + 下方父分支 clearPendingChildIndex）统一清空。
    const unit = this.units.get(sessionId);
    if (unit == null || unit.getRunId() !== runId) {
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
      this.evictSettledOverflow();
      this.notifyChanged();
      return;
    }
    // Step 5：先丢弃写通 coalescer 的在途 pending 再写 settled 行——
    // 不 flush（pending 里的旧 partial 马上要被 settle 覆盖，flush 只是
    // 多一次无效写；更重要的是杜绝在途定时器把 settled 行覆盖回 running）。
    this.discardWritethrough(sessionId);
    // 父收尾：settle 内已清空单元的 pendingChildren，这里同步清反查条目。
    this.clearPendingChildIndex(sessionId);
    // settled 行落库（partial 清空、metrics 保留——由 core settle 服务端
    // 强制）+ manager 级 settled 投影更新（「上次生成」常驻，不随单元
    // 宽限销毁/LRU 淘汰清除）。
    const snap = unit.snapshot();
    this.upsertSettledRunStateQuietly(sessionId, unit.projectId, snap);
    this.settledProjections.set(sessionId, {
      sessionId,
      metrics: snap.metrics,
      startedAtMs: snap.startedAtMs,
      settledAtMs: snap.settledAtMs ?? Date.now(),
      elapsedMs: snap.elapsedMs ?? 0,
    });
    this.evictSettledOverflow();
    this.notifyChanged();
    decrementAgentActive();
    this.stopKeepAliveQuietly(sessionId);

    if (status === 'failed') {
      // 失败反馈也收口在所有权校验之后：无主 FAILED 不弹 toast；
      // 桥未注入时用 console.error 兜底，不留无任何痕迹的失败。
      if (this.uiBridge != null) {
        this.uiBridge.onError(errorMessage ?? '生成失败');
      } else {
        console.error(
          '[novel-master/session-stream-unit-manager] run failed (uiBridge not ready)',
          {sessionId, runId, error: errorMessage},
        );
      }
    }

    unit.invokeOnSettled(status);
    void this.notifySettled(sessionId, status).catch(() => undefined);
  }

  /** 完成通知：开关开才发（桥未注入时降级不发）；会话名尽力取、取不到不阻塞。 */
  private async notifySettled(
    sessionId: string,
    status: SessionStreamRunSettledStatus,
  ): Promise<void> {
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
  }

  /**
   * 通知权限申请：时机钉死为「首次发起 run 且开关为开」。
   *
   * 仅在开关开启时申请；已申请过 / 已拒绝后不再重复（内部降级标记）。
   */
  private async maybeEnsureNotificationPermission(): Promise<void> {
    if (this.permissionEnsured) {
      return;
    }
    const enabled = await this.prefBridge?.isNotificationEnabled();
    if (enabled !== true) {
      return;
    }
    this.permissionEnsured = true;
    timingLog('notif-permission: request begin');
    await ensureAgentNotificationPermission().catch(() => false);
    timingLog('notif-permission: request done');
  }

  /**
   * 受理后按需启动保活：消息通知总开关开启才起常驻通知，并带上
   * 项目 · 会话名标签（取不到名字时仍启动，仅内容缺省）。
   */
  private async startKeepAliveFor(
    sessionId: string,
    projectId: string,
  ): Promise<void> {
    timingLog('keepalive: begin');
    const enabled =
      (await this.prefBridge?.isNotificationEnabled()) ?? false;
    if (!enabled) {
      timingLog('keepalive: disabled by pref, skip');
      return;
    }
    let sessionTitle: string | undefined;
    let projectName: string | undefined;
    try {
      sessionTitle =
        (await this.runtime.sessions.get(sessionId))?.title ?? undefined;
      timingLog('keepalive: session title fetched');
    } catch {
      // 名字取不到不阻塞保活
    }
    try {
      projectName =
        (await this.runtime.projects.get(projectId))?.name ?? undefined;
      timingLog('keepalive: project name fetched');
    } catch {
      // 同上
    }
    await startAgentKeepAliveService(sessionId, {projectName, sessionTitle});
    timingLog('keepalive: startAgentKeepAliveService returned');
  }

  /** 单会话收尾：摘标签；仍有多会话在跑时由通知模块维持运行并刷新内容。 */
  private stopKeepAliveFor(sessionId: string): Promise<void> {
    return stopAgentKeepAliveService(sessionId);
  }

  /** fire-and-forget 包装：吞错但留日志，防 unhandled rejection。 */
  private startKeepAliveQuietly(sessionId: string, projectId: string): void {
    void this.startKeepAliveFor(sessionId, projectId).catch(err => {
      console.error(
        '[novel-master/session-stream-unit-manager] startKeepAlive failed',
        err,
      );
    });
  }

  private stopKeepAliveQuietly(sessionId: string): void {
    void this.stopKeepAliveFor(sessionId).catch(err => {
      console.error(
        '[novel-master/session-stream-unit-manager] stopKeepAlive failed',
        err,
      );
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
    for (const unit of settled.slice(0, settled.length - this.maxSettledUnits)) {
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
   * 落盘，重启水合恢复出的中断现场最完整。已收尾的单元（settle 时已
   * discardWritethrough）与水合 interrupted 单元（本就无 coalescer）在
   * 这里天然 no-op。
   */
  private removeUnit(sessionId: string, unit: SessionStreamUnit): void {
    // 消息面交接（Step 7 收口）：销毁前把投影消息面挪进 idle 视图——宽限
    // 销毁/LRU 淘汰/替换沿上，消息显示源从投影切 idle 无缝不断档。单元
    // 消息面为空时保留既有 idle（防 run 前历史消息被闪掉）。
    const handover = unit.snapshot();
    if (handover.messages.length > 0) {
      this.idleMessageViews.set(sessionId, {
        messages: [...handover.messages],
        hasMoreMessages: handover.hasMoreMessages,
        loadingMoreMessages: false,
      });
    }
    this.units.delete(sessionId);
    this.consumptiveSessions.delete(sessionId);
    this.clearPendingChildIndex(sessionId);
    this.flushAndDisposeWritethrough(sessionId);
    unit.destroy();
  }

  /** 挂写通 coalescer（RUN_STARTED 时调用；已存在则保持——markRunning 一次性保证不重建）。 */
  private ensureWritethrough(sessionId: string): void {
    if (this.runStateStore == null || this.writethroughs.has(sessionId)) {
      return;
    }
    this.writethroughs.set(
      sessionId,
      createRunStateWritethrough(
        state => this.runStateStore!.upsert(state),
        this.writethroughOptions,
      ),
    );
  }

  /** 把单元当前快照 append 进该会话的写通 coalescer（无 coalescer no-op）。 */
  private appendWritethroughSnapshot(unit: SessionStreamUnit): void {
    const writethrough = this.writethroughs.get(unit.sessionId);
    if (writethrough == null) {
      return;
    }
    writethrough.append(
      this.runStateRowFromSnapshot(unit, unit.snapshot()),
    );
  }

  /** 单元快照 → run_state 行（partial 全量覆盖写；空值存 null）。 */
  private runStateRowFromSnapshot(
    unit: SessionStreamUnit,
    snap: SessionStreamUnitView,
  ): SessionRunState {
    return {
      sessionId: unit.sessionId,
      projectId: unit.projectId,
      runId: snap.runId ?? '',
      status: 'running',
      startedAtMs: snap.startedAtMs,
      textChars: snap.metrics.textChars,
      thinkingChars: snap.metrics.thinkingChars,
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
      console.error(
        '[novel-master/session-stream-unit-manager] run_state upsert failed',
        err,
      );
    });
  }

  /** settle 收尾写（fire-and-forget，失败吞错留日志；无持久层 no-op）。 */
  private upsertSettledRunStateQuietly(
    sessionId: string,
    projectId: string,
    snap: SessionStreamUnitView,
  ): void {
    if (this.runStateStore == null) {
      return;
    }
    this.runStateStore
      .settle({
        sessionId,
        projectId,
        runId: snap.runId ?? '',
        startedAtMs: snap.startedAtMs,
        textChars: snap.metrics.textChars,
        thinkingChars: snap.metrics.thinkingChars,
        updatedAtMs: Date.now(),
      })
      .catch(err => {
        console.error(
          '[novel-master/session-stream-unit-manager] run_state settle failed',
          err,
        );
      });
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

  /** 写通 coalescer 直接丢弃（finishRun 用：settle 行即将覆盖，无需 flush）。 */
  private discardWritethrough(sessionId: string): void {
    const writethrough = this.writethroughs.get(sessionId);
    if (writethrough == null) {
      return;
    }
    this.writethroughs.delete(sessionId);
    writethrough.dispose();
  }

  private isActiveUnit(unit: SessionStreamUnit): boolean {
    const status = unit.getStatus();
    return status === 'starting' || status === 'running';
  }

  /**
   * 校准探针的活跃会话列举：只含 runId 已回填的 running 单元。starting
   * 单元（受理空窗内 registry 尚未注册）不参与校准——查 registry 必为
   * false，会把正常受理中的 run 误判为丢失；该形态的死单由 startRun 的
   * promise 链尾 finally 兜底收口。
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

  /**
   * 校准收尾（终态事件丢失的兜底）：走与 FAILED 事件等效的收尾路径——
   * runId 所有权匹配则 settle('failed')，refcount/持久层/通知/保活照常
   * 收口。经 startRun 发起的 run 的 runAgentTurn promise 挂死场景同样
   * 被覆盖（finally 永不到达时这里是唯一收尾点）。
   */
  private finishLostRun(sessionId: string): void {
    const unit = this.units.get(sessionId);
    if (unit == null || !this.isActiveUnit(unit)) {
      return;
    }
    const runId = unit.getRunId();
    if (runId == null) {
      return;
    }
    this.finishRun(sessionId, runId, 'failed', '连接已断开，生成被中断');
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
    this.notifyChanged();
    this.listeners.clear();
    void stopAgentKeepAliveService().catch(() => undefined);
  }
}
