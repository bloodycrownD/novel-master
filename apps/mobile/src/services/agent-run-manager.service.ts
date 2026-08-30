/**
 * app 级 Agent run 编排（fire-and-forget）。
 *
 * 参照 desktop main 的 activeRuns + attachAgentRunLifecycleListeners 形状：
 * - per-session 门禁：RunEntry 存在（starting/running）或 abortRegistry.has
 *   任一为真即拒绝，返回明确错误（封住「受理 → core register」之间的异步空窗）；
 * - 全局 refcount 收口：increment 在 startRun 受理路径同步执行、decrement 由
 *   全量 FINISHED/FAILED 事件订阅驱动（不经 UI 面板的 sessionId 过滤，修掉
 *   「切走会话后 FINISHED 被丢弃 → refcount 泄漏」的缺陷）；
 * - promise 链尾 finally 兕底：只要 entry 仍归本次 startRun 所有（未被事件
 *   路径收尾、未被新 run 替换）即清 entry + decrement——事件总线同步分发，
 *   不存在「事件还会再来双减」的组合（对齐 desktop agent.ts 的 C-orch-1）。
 *
 * Manager 在 React 树外（runtime 装配层）实例化；UI toast / 偏好 / scope
 * 经 Provider 注入的桥访问，桥未注入期间降级：失败 toast 与完成通知不发，
 * 仅 console.error 兜底；refcount 与 RunEntry 维护不依赖桥，始终生效。
 *
 * @module services/agent-run-manager
 */
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
} from '@novel-master/core/events';
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
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

/** run 终态（abort 收场归 'finished'——FINISHED/FAILED 无结构化 abort 标记）。 */
export type AgentRunSettledStatus = 'finished' | 'failed';

/** Manager 实际依赖的 runtime 子集（测试可传 mock）。 */
export type AgentRunManagerRuntime = Pick<
  MobileNovelMasterRuntime,
  'eventBus' | 'abortRegistry' | 'sessions'
>;

/** fire-and-forget 的 runAgentTurn 形状（测试可注入 mock）。 */
type RunAgentTurnFn = (
  runtime: AgentRunManagerRuntime,
  scope: {projectId: string; sessionId: string},
  content: string,
  options?: AgentRunStartOptions,
) => Promise<unknown>;

/** startRun 的 options 契约（供 ChatComposer.executeRun 等 UI 侧消费）。 */
export interface AgentRunStartOptions {
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
  readonly onSettled?: (status: AgentRunSettledStatus) => void;
}

/** startRun 同步返回的受理/拒绝结果（拒绝时带明确错误信息）。 */
export type AgentRunStartResult =
  | {readonly ok: true}
  | {readonly ok: false; readonly error: string};

/** 失败 toast 上浮桥（Manager 在 React 外，经 Provider 注入）。 */
export interface AgentRunUiBridge {
  onError(message: string): void;
}

/** 「生成结束通知」开关读取桥（appUi 通道）。 */
export interface AgentRunPrefBridge {
  isEnabled(): Promise<boolean>;
}

/** scope 同步桥：通知点按后切换会话（React 外）。 */
export interface AgentRunScopeBridge {
  setCurrentSession(sessionId: string): Promise<void>;
}

/** per-session run 记录：starting = 已受理、RUN_STARTED 未达。 */
interface RunEntry {
  runId: string | null;
  status: 'starting' | 'running';
  onSettled?: (status: AgentRunSettledStatus) => void;
}

export interface AgentRunManagerParams {
  readonly runtime: AgentRunManagerRuntime;
  /** 测试注入用；默认走 services/agent-run.service 的包装。 */
  readonly runAgentTurn?: RunAgentTurnFn;
}

/**
 * app 级单会话串行 / 跨会话并行的 run 编排器。
 *
 * 生命周期跟随 runtime：Provider retry 重建时须先 {@link dispose} 再销毁连接。
 */
export class AgentRunManager {
  private readonly runtime: AgentRunManagerRuntime;
  private readonly runAgentTurnFn: RunAgentTurnFn;
  private readonly entries = new Map<string, RunEntry>();
  private readonly subscriptions: EventSubscription[] = [];

  private uiBridge: AgentRunUiBridge | undefined;
  private prefBridge: AgentRunPrefBridge | undefined;
  private scopeBridge: AgentRunScopeBridge | undefined;
  /** onForegroundEvent 点按监听的退订函数（dispose 时退订，防 retry 重建累积）。 */
  private offNotificationTap: (() => void) | undefined;
  private disposed = false;
  private permissionEnsured = false;

  constructor(params: AgentRunManagerParams) {
    this.runtime = params.runtime;
    // 默认实现的完整 options 类型比 AgentRunStartOptions 宽，调用点只传子集，安全断言。
    this.runAgentTurnFn =
      params.runAgentTurn ?? (defaultRunAgentTurn as RunAgentTurnFn);

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

    // 通知点按：切 scope 到目标会话 + 导航 Chat tab。
    // onBackgroundEvent 为模块级一次注册（handler 引用替换），不随实例退订；
    // 这里只握 onForegroundEvent 的退订函数，dispose 时退订（MF-5）。
    this.offNotificationTap = registerAgentNotificationTapHandling(sessionId => {
      void this.scopeBridge?.setCurrentSession(sessionId).catch(() => undefined);
      navigateToChatTabFromNotification();
    });
  }

  /** Provider ready 后注入 UI toast 桥。 */
  setUiBridge(bridge: AgentRunUiBridge): void {
    this.uiBridge = bridge;
  }

  /** Provider ready 后注入偏好读取桥。 */
  setPrefBridge(bridge: AgentRunPrefBridge): void {
    this.prefBridge = bridge;
  }

  /** Provider ready 后注入 scope 桥。 */
  setScopeBridge(bridge: AgentRunScopeBridge): void {
    this.scopeBridge = bridge;
  }

  /** 某 session 当前是否有 Manager 记录的 in-flight run（starting/running）。 */
  hasRun(sessionId: string): boolean {
    return this.entries.has(sessionId);
  }

  /**
   * 发起 run：per-session 门禁 + fire-and-forget。
   *
   * 门禁钉死「RunEntry 存在（starting/running）或 abortRegistry.has 为真即拒绝，
   * 返回明确错误而非静默」——core 的 register 要到 run-agent-turn 内用户消息
   * append 之后才执行，只看 registry 会在受理空窗内漏放第二个同会话 run。
   *
   * 受理路径同步 increment refcount（对齐 desktop agent.ts 的形状），decrement
   * 由事件订阅 / finally 早退兜底负责；startRun 本身同步返回，不 await run。
   */
  startRun(
    sessionId: string,
    projectId: string,
    content: string,
    options?: AgentRunStartOptions,
  ): AgentRunStartResult {
    if (this.disposed) {
      return {ok: false, error: '运行时正在重建，请稍后重试'};
    }
    if (this.entries.has(sessionId) || this.runtime.abortRegistry.has(sessionId)) {
      return {ok: false, error: '该会话已有进行中的生成，请先等待完成或停止'};
    }

    const entry: RunEntry = {
      runId: null,
      status: 'starting',
      onSettled: options?.onSettled,
    };
    this.entries.set(sessionId, entry);
    incrementAgentActive();
    void startAgentKeepAliveService().catch(() => undefined);
    void this.maybeEnsureNotificationPermission();

    void this.runAgentTurnFn(this.runtime, {projectId, sessionId}, content, {
      stream: options?.stream,
      annotateDrafts: options?.annotateDrafts,
      allowResumeWithoutInput: options?.allowResumeWithoutInput,
      onUserMessageAppended: options?.onUserMessageAppended,
    })
      .catch(err => {
        console.error('[novel-master/agent-run-manager] run failed', {
          sessionId,
          projectId,
          err:
            err instanceof Error
              ? {name: err.name, message: err.message}
              : String(err),
        });
        // 仅 resolve/register 阶段错误（RUN_STARTED 未达，FAILED 事件永远不会来）
        // 才由 throw 路径兜底 toast；RUN_STARTED 已达的失败 core 必发
        // EVENT_AGENT_RUN_FAILED，事件路径（onRunFailed）已 onError，这里再弹
        // 就是同一次失败的双 toast。entry 非本次（事件已收尾或已被替换）同理不弹。
        const current = this.entries.get(sessionId);
        if (current === entry && current.runId == null) {
          this.uiBridge?.onError(
            err instanceof Error ? err.message : String(err),
          );
        }
      })
      .finally(() => {
        const current = this.entries.get(sessionId);
        if (current !== entry) {
          // 事件路径已收尾（entry 已删）或已被新一轮 startRun 替换，不双减。
          return;
        }
        // 安全性依据（MF-2）：事件总线是同步分发的——若事件路径（FINISHED/FAILED）
        // 已收尾过，此刻 entries.get(sessionId) 必然不等于 entry（已 delete 或被
        // 新一轮 startRun 替换）；因此 current === entry 时不可能再有终态事件
        // 来双减，一律收尾。这覆盖了「RUN_STARTED 已达但 core 在主 try 前抛错、
        // 无终态事件」的窗口（否则 entry/refcount 永久泄漏）；finishRun 的
        // entry+runId 所有权校验是另一道双保险。
        this.entries.delete(sessionId);
        decrementAgentActive();
        this.syncKeepAliveQuietly();
      });

    return {ok: true};
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

  /** RUN_STARTED 只做 entry 状态迁移与 runId 回填，不碰 refcount。 */
  private onRunStarted(payload: AgentRunStartedPayload): void {
    const entry = this.entries.get(payload.sessionId);
    if (entry == null) {
      return;
    }
    entry.status = 'running';
    entry.runId = payload.runId;
  }

  private onRunFinished(payload: AgentRunFinishedPayload): void {
    this.finishRun(payload.sessionId, payload.runId, 'finished');
  }

  private onRunFailed(payload: AgentRunFailedPayload): void {
    // toast / 兕底日志收口在 finishRun 的所有权匹配分支内（MF-1）：无 entry
    // 或 runId 不匹配的 FAILED（subagent 子 run、旧连接残留）不弹也不刷日志。
    this.finishRun(payload.sessionId, payload.runId, 'failed', payload.error);
  }

  /** FINISHED/FAILED 收尾：runId 匹配才清 entry + decrement + 触发 onSettled/通知。 */
  private finishRun(
    sessionId: string,
    runId: string,
    status: AgentRunSettledStatus,
    errorMessage?: string,
  ): void {
    const entry = this.entries.get(sessionId);
    if (entry == null || entry.runId !== runId) {
      return;
    }
    this.entries.delete(sessionId);
    decrementAgentActive();
    this.syncKeepAliveQuietly();

    if (status === 'failed') {
      // 失败反馈也收口在所有权校验之后：无主 FAILED 不弹 toast（MF-1）；
      // 桥未注入时用 console.error 兕底，不留无任何痕迹的失败（MF-6）。
      if (this.uiBridge != null) {
        this.uiBridge.onError(errorMessage ?? '生成失败');
      } else {
        console.error(
          '[novel-master/agent-run-manager] run failed (uiBridge not ready)',
          {sessionId, runId, error: errorMessage},
        );
      }
    }

    try {
      entry.onSettled?.(status);
    } catch (err) {
      // UI 副作用回调失败不影响收尾（组件卸载后回调可能触发，UI 侧自行吞错）。
      console.error('[novel-master/agent-run-manager] onSettled failed', err);
    }
    void this.notifySettled(sessionId, status).catch(() => undefined);
  }

  /** 完成通知：开关开才发（桥未注入时降级不发）；会话名尽力取、取不到不阻塞。 */
  private async notifySettled(
    sessionId: string,
    status: AgentRunSettledStatus,
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

  /** 有活跃 run 才保活，全空闲即停止（起停与 run 生命周期严格绑定）。 */
  private async syncKeepAlive(): Promise<void> {
    if (this.entries.size > 0) {
      await startAgentKeepAliveService();
    } else {
      await stopAgentKeepAliveService();
    }
  }

  /** fire-and-forget 调 syncKeepAlive：吞错但留日志，防 unhandled rejection（MF-4）。 */
  private syncKeepAliveQuietly(): void {
    void this.syncKeepAlive().catch(err => {
      console.error('[novel-master/agent-run-manager] syncKeepAlive failed', err);
    });
  }

  /**
   * Provider retry 重建 runtime 前的销毁：退订事件总线、按 RunEntry 记录
   * 逐个递减模块级 refcount、停止前台服务。
   *
   * 必须在 closeMobileConnection 之前调用（先 detach、后销毁连接）。
   * 不撤销已透传给 core 的回调；dispose 后旧 Manager 不再触发 onSettled，
   * 在途 run 的后续 FINISHED/FAILED 由新 Manager 接管（无 entry 不 decrement，防负）。
   */
  dispose(): void {
    this.disposed = true;
    this.offNotificationTap?.();
    this.offNotificationTap = undefined;
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions.length = 0;
    // 模块级计数不随 runtime 重建归零，必须由 dispose 显式清零（decrement 对 0 幂等）。
    for (const sessionId of [...this.entries.keys()]) {
      this.entries.delete(sessionId);
      decrementAgentActive();
    }
    void stopAgentKeepAliveService().catch(() => undefined);
  }
}
