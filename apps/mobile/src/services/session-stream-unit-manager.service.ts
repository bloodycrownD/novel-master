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
import type {EventSubscription} from '@novel-master/core/events';
import {
  decrementAgentActive,
  incrementAgentActive,
} from '@/runtime/agent-activity';
import {runAgentTurn as defaultRunAgentTurn} from '@/services/agent-run.service';
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
} from '@/services/session-stream-unit';
import type {
  SessionStreamRunSettledStatus,
  SessionStreamUnitView,
  SessionStreamWebviewHandle,
} from '@/services/session-stream-unit';

/** settled 单元并存的 LRU 上限（含宽限中的与水合常驻的；活跃单元不占槽）。 */
export const SESSION_STREAM_MAX_SETTLED_UNITS = 8;

/** Manager 实际依赖的 runtime 子集（测试可传 mock）。 */
export type SessionStreamManagerRuntime = Pick<
  MobileNovelMasterRuntime,
  'eventBus' | 'abortRegistry' | 'sessions' | 'projects'
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

/** 通知偏好读取桥（appUi 通道）：isEnabled = 生成结束通知（默认开）。 */
export interface SessionStreamPrefBridge {
  isEnabled(): Promise<boolean>;
  /** 后台保活开关（默认关——历史行为完全兼容，开启后才起常驻通知/前台服务）。 */
  isKeepAliveEnabled(): Promise<boolean>;
}

/** scope 同步桥：通知点按后切换会话（React 外）；读取当前会话用于去重切换。 */
export interface SessionStreamScopeBridge {
  /** 当前会话 id（无会话/未就绪为 null）。 */
  getCurrentSessionId(): string | null;
  setCurrentSession(sessionId: string): Promise<void>;
}

export interface SessionStreamUnitManagerParams {
  readonly runtime: SessionStreamManagerRuntime;
  /** 测试注入用；默认走 services/agent-run.service 的包装。 */
  readonly runAgentTurn?: RunAgentTurnFn;
  /** settled(finished/failed) 的宽限销毁时长；缺省用单元模块默认值（测试可覆盖）。 */
  readonly settledGraceMs?: number;
  /** settled 单元 LRU 上限；缺省 SESSION_STREAM_MAX_SETTLED_UNITS（测试可覆盖）。 */
  readonly maxSettledUnits?: number;
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
   * 子会话 run 的终态事件（sessionId 为子会话 id，经 finishRun 路由）靠它
   * 找回父单元摘除 pendingChild；父收尾/单元出表时批量清相关条目。
   */
  private readonly pendingChildParentByChild = new Map<string, string>();
  private readonly settledGraceMs: number | undefined;
  private readonly maxSettledUnits: number;

  private uiBridge: SessionStreamUiBridge | undefined;
  private prefBridge: SessionStreamPrefBridge | undefined;
  private scopeBridge: SessionStreamScopeBridge | undefined;
  /** 投影变更监听：单元集合或单元状态每次变更后同步通知。 */
  private readonly listeners = new Set<() => void>();
  /** onForegroundEvent 点按监听的退订函数（dispose 时退订，防 retry 重建累积）。 */
  private offNotificationTap: (() => void) | undefined;
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
    this.subscriptions.push(
      this.runtime.eventBus.subscribe(
        EVENT_AGENT_STREAM_TEXT_DELTA,
        (payload: AgentStreamTextDeltaPayload) => {
          this.units
            .get(payload.sessionId)
            ?.ingestTextDelta(payload.runId, payload.text);
        },
      ),
      this.runtime.eventBus.subscribe(
        EVENT_AGENT_STREAM_THINKING_DELTA,
        (payload: AgentStreamThinkingDeltaPayload) => {
          this.units
            .get(payload.sessionId)
            ?.ingestThinkingDelta(payload.runId, payload.text);
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

  /** 某 session 当前是否有进行中的 run（starting|running 单元）。 */
  hasActiveRun(sessionId: string): boolean {
    const unit = this.units.get(sessionId);
    return unit != null && this.isActiveUnit(unit);
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
      onSettled: options?.onSettled,
      settledGraceMs: this.settledGraceMs,
      onGraceExpired: expired => this.handleGraceExpired(sessionId, expired),
      onProjectionChanged: () => this.notifyChanged(),
    });
    unit.begin();
    this.units.set(sessionId, unit);
    this.notifyChanged();
    incrementAgentActive();
    this.startKeepAliveQuietly(sessionId, projectId);
    void this.maybeEnsureNotificationPermission();

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
    const unit = this.units.get(payload.sessionId);
    if (unit == null || !unit.markRunning(payload.runId)) {
      return;
    }
    this.notifyChanged();
  }

  /**
   * STEP_COMMITTED：step 边界冲刷 + partial 清零 + 注入标记复位。
   * 单元内含 runId 所有权守卫，生效才触发投影通知。
   */
  private onStepCommitted(payload: AgentStepCommittedPayload): void {
    const unit = this.units.get(payload.sessionId);
    if (unit == null || !unit.handleStepCommitted(payload.runId)) {
      return;
    }
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
      this.notifyChanged();
    }
  }

  /** 子会话 run 终态：反查父单元并摘除 pending 链接（无条目 no-op）。 */
  private removePendingChildIfAny(childSessionId: string): void {
    const parentSessionId = this.pendingChildParentByChild.get(childSessionId);
    if (parentSessionId == null) {
      return;
    }
    this.pendingChildParentByChild.delete(childSessionId);
    if (
      this.units.get(parentSessionId)?.removePendingChild(childSessionId) ===
      true
    ) {
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
    // 子会话 run 终态（sessionId 为子会话 id、本表无单元）：反查父单元
    // 摘除 pending 链接——任务卡 pending 态消失，落库 result meta 接管。
    // 无反查条目时 no-op，不影响下方父单元收尾路径。
    this.removePendingChildIfAny(sessionId);

    const unit = this.units.get(sessionId);
    if (unit == null || unit.getRunId() !== runId) {
      return;
    }
    // settle 状态守卫（已销毁/已收尾的单元不再收尾——防同 runId 双事件或
    // 与 finally 兜底竞态的双减；正常运行时不会走到，纯防御）。
    if (!unit.settle(status)) {
      return;
    }
    // 父收尾：settle 内已清空单元的 pendingChildren，这里同步清反查条目。
    this.clearPendingChildIndex(sessionId);
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
    const enabled = await this.prefBridge.isEnabled();
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
    const enabled = await this.prefBridge?.isEnabled();
    if (enabled !== true) {
      return;
    }
    this.permissionEnsured = true;
    await ensureAgentNotificationPermission().catch(() => false);
  }

  /**
   * 受理后按需启动保活：开关（默认关）开启才起常驻通知，并带上
   * 项目 · 会话名标签（取不到名字时仍启动，仅内容缺省）。
   */
  private async startKeepAliveFor(
    sessionId: string,
    projectId: string,
  ): Promise<void> {
    const enabled = (await this.prefBridge?.isKeepAliveEnabled()) ?? false;
    if (!enabled) {
      return;
    }
    let sessionTitle: string | undefined;
    let projectName: string | undefined;
    try {
      sessionTitle =
        (await this.runtime.sessions.get(sessionId))?.title ?? undefined;
    } catch {
      // 名字取不到不阻塞保活
    }
    try {
      projectName =
        (await this.runtime.projects.get(projectId))?.name ?? undefined;
    } catch {
      // 同上
    }
    await startAgentKeepAliveService(sessionId, {projectName, sessionTitle});
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

  /** 单元出表统一收口：摘注册表 + 清子会话反查条目 + 销毁单元。 */
  private removeUnit(sessionId: string, unit: SessionStreamUnit): void {
    this.units.delete(sessionId);
    this.clearPendingChildIndex(sessionId);
    unit.destroy();
  }

  private isActiveUnit(unit: SessionStreamUnit): boolean {
    const status = unit.getStatus();
    return status === 'starting' || status === 'running';
  }

  private notifyChanged(): void {
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
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions.length = 0;
    for (const unit of [...this.units.values()]) {
      // 模块级计数不随 runtime 重建归零，必须由 dispose 显式清零——
      // 但只清活跃 run 的计数（settled 单元在 finishRun 时已 decrement）。
      if (!isSessionStreamUnitSettled(unit.getStatus())) {
        decrementAgentActive();
      }
      this.removeUnit(unit.sessionId, unit);
    }
    this.pendingChildParentByChild.clear();
    this.notifyChanged();
    this.listeners.clear();
    void stopAgentKeepAliveService().catch(() => undefined);
  }
}
