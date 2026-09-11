/**
 * 会话流式单元：per-session run 的独立载体（React 树外）。
 *
 * 状态机：idle → starting → running → settled(interrupted|finished|failed)
 *        →（宽限）销毁。
 * - starting = startRun 已受理、RUN_STARTED 未达（封住受理→core register 空窗）；
 * - settled(finished|failed) 由 FINISHED/FAILED 事件收尾进入，宽限期后销毁
 *   出注册表（宽限仅供 UI 终态投影平滑过渡，长期「上次生成」走 manager 级
 *   settled 投影，不依赖单元存活）；
 * - settled(interrupted) 仅来自重启水合（Step 5），不启动宽限定时器——水合
 *   出来的中断现场要长期驻留，直到被同会话新 run 替换/吸收或 LRU 淘汰。
 *
 * Step 3 填实的运行态语义（蓝本 = 六个旧 hook + stream-metrics-store）：
 * - 事件管线：delta/step 由 manager 按 sessionId 路由进管线方法，
 *   runId 所有权 + 活跃态双守卫（陈旧事件不进缓冲、不计指标）；
 * - 流式缓冲：32ms ingress 合并 + 64ms apply（蓝本 useSessionBatch），
 *   单元自持定时器、销毁即清理，不依赖 React；
 * - 单一注入：webview attach 时把本 step 已累积的 partial 经
 *   pushStreamDelta 等价载荷注入该句柄，恰好一次；step 边界与句柄摘除
 *   均复位标记（重进/新 step 需重新注入）；
 * - 指标字段化：textChars/thinkingChars 事件即归账（run 级累计，step 边界
 *   不清）、startedAtMs 于 RUN_STARTED 回填时置位（重进连续计时）、
 *   settle 时冻结 elapsedMs 为「上次生成」；
 * - 子会话链接：pendingChildren 登记（同 title 覆盖、同 id 去重）、child
 *   终态摘除（manager 反查路由）、父收尾清空（蓝本 subagentChildSessions
 *   ByParent 语义，防陈旧条目串到下一 run）。
 *
 * @module services/session-stream-unit
 */
import type {StreamWireChunk, StreamWireKind} from './stream-wire-queue';
import {appendWireChunk, coalesceWireQueue} from './stream-wire-queue';
import {createStreamApplyBuffer} from './stream-apply-buffer';
import type {StreamApplyBuffer} from './stream-apply-buffer';

/** settled(finished|failed) 后的默认宽限销毁时长（毫秒）；测试可经构造参数覆盖。 */
export const SESSION_STREAM_SETTLED_GRACE_PERIOD_MS = 30_000;

/** ingress 合并窗口（毫秒）：高频 delta 先入队，32ms 内合并后再进 apply 缓冲。 */
export const SESSION_STREAM_INGRESS_COALESCE_MS = 32;

/** apply 缓冲的节流间隔（毫秒）：合并段按此节拍下发（对齐蓝本渲染节奏）。 */
export const SESSION_STREAM_APPLY_INTERVAL_MS = 64;

/** 单元的活跃态：idle=已建未受理，starting=已受理未回填 runId，running=run 进行中。 */
export type SessionStreamUnitActiveStatus = 'idle' | 'starting' | 'running';

/** 单元的终态子类型：interrupted 仅来自水合，finished/failed 来自事件收尾。 */
export type SessionStreamUnitSettledStatus =
  | 'interrupted'
  | 'finished'
  | 'failed';

/** 单元全量状态（状态机节点）。 */
export type SessionStreamUnitStatus =
  | SessionStreamUnitActiveStatus
  | SessionStreamUnitSettledStatus;

/** 状态是否为终态（settled 单元不阻塞同会话新 run，仅占 LRU 槽位）。 */
export function isSessionStreamUnitSettled(
  status: SessionStreamUnitStatus,
): status is SessionStreamUnitSettledStatus {
  return (
    status === 'interrupted' || status === 'finished' || status === 'failed'
  );
}

/** 事件收尾驱动的 run 终态（interrupted 不经事件路径，故不在其列）。 */
export type SessionStreamRunSettledStatus = 'finished' | 'failed';

/**
 * 流式载荷（onStreamPayload 的线上形状；Step 6 适配层映射到
 * ChatTranscriptWebViewHandle 的 pushStreamBatch / pushStreamDelta）：
 * - stream-batch：apply 缓冲下发的合并段（对应 pushStreamBatch({segments})）；
 * - stream-delta：注入路径的单条大段（对应 pushStreamDelta(kind, delta)）。
 */
export type SessionStreamUnitStreamPayload =
  | {
      readonly type: 'stream-batch';
      readonly segments: readonly StreamWireChunk[];
    }
  | {
      readonly type: 'stream-delta';
      readonly kind: StreamWireKind;
      readonly delta: string;
    };

/**
 * 控制类消息（onControlMessage 的线上形状；Step 4 消息管线 / Step 6 接线
 * 消费，本节点只立形状）。reset-stream 对应 webview 的 resetStream。
 */
export type SessionStreamUnitControlMessage = {readonly type: 'reset-stream'};

/**
 * webview 句柄（多句柄注册表的成员）。
 *
 * 流式推送只发给「最后 attach 的可见句柄」；控制类消息对全句柄广播。
 * 载荷/消息的具体类型由 Step 3 事件管线与 Step 6 屏幕接线填实，
 * 本节点以 unknown 立形状。
 */
export interface SessionStreamWebviewHandle {
  /** 句柄唯一标识（attach/detach 对账用）。 */
  readonly handleId: string;
  /** 句柄是否可见（缺省视为可见；不可见句柄不收流式推送）。 */
  isVisible?(): boolean;
  /** 流式消息回调（仅流式目标句柄收到）。 */
  onStreamPayload?(payload: unknown): void;
  /** 控制类消息回调（全句柄广播收到）。 */
  onControlMessage?(message: unknown): void;
}

/** 指标快照：run 级累计（新 run 重置=新单元天然零值；step 边界不清）。 */
export interface SessionStreamUnitMetrics {
  readonly textChars: number;
  readonly thinkingChars: number;
}

/** 单元只读投影：snapshot(sessionId) 的返回形状，屏幕订阅的唯一消费面。 */
export interface SessionStreamUnitView {
  readonly sessionId: string;
  readonly projectId: string;
  readonly status: SessionStreamUnitStatus;
  /** null = 已受理但 RUN_STARTED 未达（starting）。 */
  readonly runId: string | null;
  /** 进入终态的时间戳（毫秒）；活跃态为 null。LRU 淘汰按此排序。 */
  readonly settledAtMs: number | null;
  /** 指标：run 级累计字数（事件即归账，不经缓冲节拍）。 */
  readonly metrics: SessionStreamUnitMetrics;
  /** run 开始时刻（毫秒，RUN_STARTED 回填时置位）；未开始为 0。运行中重进连续计时。 */
  readonly startedAtMs: number;
  /** 终态冻结的历时（毫秒）=「上次生成」；活跃态为 null（消费方按 startedAtMs 实时算）。 */
  readonly elapsedMs: number | null;
  /** 本 step 的 in-flight partial（step 边界随 core streamRegistry 重置清零）。 */
  readonly partialText: string;
  readonly partialThinking: string;
  /** 本 step 内是否已向句柄注入过 partial（step 边界/句柄摘除复位）。 */
  readonly injected: boolean;
  /** 子会话链接：run 进行中创建、尚未终态的 child session id（插入序）。 */
  readonly pendingChildren: readonly string[];
}

/** 单元构造参数。 */
export interface SessionStreamUnitOptions {
  readonly sessionId: string;
  readonly projectId: string;
  /** run 终态回调（由 manager 的事件收尾路径触发，吞错）。 */
  readonly onSettled?: (status: SessionStreamRunSettledStatus) => void;
  /** settled(finished|failed) 的宽限销毁时长；缺省用模块默认值。 */
  readonly settledGraceMs?: number;
  /** 宽限到期回调：manager 负责把本单元从注册表摘除并销毁。 */
  readonly onGraceExpired?: (unit: SessionStreamUnit) => void;
  /** 投影变更回调（apply 节拍 / 字段变化时触发，manager 接 notifyChanged）。 */
  readonly onProjectionChanged?: () => void;
}

/**
 * 会话流式单元本体。
 *
 * 生命周期由 manager 驱动（受理/事件收尾/宽限到期/LRU 淘汰）；单元自身
 * 维护状态机、流式缓冲、partial/指标与句柄注册表，不持有 runtime、
 * 不直接订阅事件总线。
 */
export class SessionStreamUnit {
  readonly sessionId: string;
  readonly projectId: string;

  private status: SessionStreamUnitStatus = 'idle';
  private runIdValue: string | null = null;
  private settledAtMsValue: number | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private metricsAcc = {textChars: 0, thinkingChars: 0};
  private startedAtMsValue = 0;
  private elapsedMsValue: number | null = null;
  private partialTextValue = '';
  private partialThinkingValue = '';
  private injectedValue = false;
  /** 子会话链接：title → childSessionId（同 title 覆盖；投影按 id 去重）。 */
  private readonly pendingChildIdsByTitle = new Map<string, string>();
  private pendingChildrenValue: readonly string[] = [];

  /** ingress 合并队列（32ms 窗口内相邻同 kind 合并，禁止 kind 重排）。 */
  private ingressQueue: StreamWireChunk[] = [];
  private ingressTimer: ReturnType<typeof setTimeout> | null = null;
  /** 64ms apply 缓冲（蓝本 useSessionBatch 的纯数据部分，单元自持）。 */
  private readonly applyBuffer: StreamApplyBuffer;

  private readonly webviewHandles: SessionStreamWebviewHandle[] = [];
  private readonly onSettled?:
    | ((status: SessionStreamRunSettledStatus) => void)
    | undefined;
  private readonly settledGraceMs: number;
  private readonly onGraceExpired?:
    | ((unit: SessionStreamUnit) => void)
    | undefined;
  private readonly onProjectionChanged?: (() => void) | undefined;

  constructor(options: SessionStreamUnitOptions) {
    this.sessionId = options.sessionId;
    this.projectId = options.projectId;
    this.onSettled = options.onSettled;
    this.onGraceExpired = options.onGraceExpired;
    this.onProjectionChanged = options.onProjectionChanged;
    this.settledGraceMs =
      options.settledGraceMs ?? SESSION_STREAM_SETTLED_GRACE_PERIOD_MS;
    this.applyBuffer = createStreamApplyBuffer(
      segments => this.applyStreamSegments(segments),
      {flushIntervalMs: SESSION_STREAM_APPLY_INTERVAL_MS},
    );
  }

  /** run 受理：idle → starting。非 idle（含销毁后）拒绝，返回是否迁移成功。 */
  begin(): boolean {
    if (this.destroyed || this.status !== 'idle') {
      return false;
    }
    this.status = 'starting';
    return true;
  }

  /**
   * RUN_STARTED 回填：starting → running。
   *
   * 同时置位指标计时起点（蓝本 noteRunStarted 语义：startedAtMs = run
   * 开始时刻，重进连续计时不从零）；同一 runId 的重复 STARTED（回填双发）
   * 被状态守卫拒绝，天然不重置。
   */
  markRunning(runId: string): boolean {
    if (this.destroyed || this.status !== 'starting') {
      return false;
    }
    this.status = 'running';
    this.runIdValue = runId;
    this.startedAtMsValue = Date.now();
    return true;
  }

  /**
   * 事件收尾：running → settled(finished|failed)，并启动宽限销毁定时器。
   *
   * 收尾前先冲刷两段缓冲（蓝本：FINISHED/FAILED 先 flush，保证在途 delta
   * 先于落库 reload 到达、不被 clear 丢弃）；历时冻结为「上次生成」。
   * 仅 running 可收尾（事件路径的 runId 所有权校验在 manager 侧；
   * 这里是状态机第二道守卫）。
   */
  settle(status: SessionStreamRunSettledStatus): boolean {
    if (this.destroyed || this.status !== 'running') {
      return false;
    }
    this.flushStreamBuffers();
    this.status = status;
    this.settledAtMsValue = Date.now();
    this.elapsedMsValue =
      this.startedAtMsValue > 0
        ? Math.max(0, this.settledAtMsValue - this.startedAtMsValue)
        : 0;
    // 父 run 收尾即清空子会话链接：落库 result meta 接管任务卡可点性，
    // 且避免同 title 陈旧条目串到下一 run（蓝本父 FINISHED 清理语义）。
    this.clearPendingChildren();
    this.scheduleGraceDestroy();
    return true;
  }

  /** 水合终态：idle → interrupted。不启动宽限定时器（常驻至替换或 LRU 淘汰）。 */
  settleAsInterrupted(): boolean {
    if (this.destroyed || this.status !== 'idle') {
      return false;
    }
    this.status = 'interrupted';
    this.settledAtMsValue = Date.now();
    return true;
  }

  /** 触发 onSettled 回调（manager 事件收尾路径调用；回调异常吞掉不影响收尾）。 */
  invokeOnSettled(status: SessionStreamRunSettledStatus): void {
    try {
      this.onSettled?.(status);
    } catch (err) {
      console.error(
        '[novel-master/session-stream-unit] onSettled failed',
        err,
      );
    }
  }

  /**
   * 销毁：清宽限定时器、流式缓冲（两段）与句柄注册表（幂等）。
   *
   * 由 manager 在摘除注册表后调用（宽限到期 / LRU 淘汰 / startRun 替换
   * 吸收 / dispose）。销毁后一切状态迁移均拒绝。
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.graceTimer != null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    if (this.ingressTimer != null) {
      clearTimeout(this.ingressTimer);
      this.ingressTimer = null;
    }
    this.applyBuffer.dispose();
    this.webviewHandles.length = 0;
  }

  getStatus(): SessionStreamUnitStatus {
    return this.status;
  }

  getRunId(): string | null {
    return this.runIdValue;
  }

  getSettledAtMs(): number | null {
    return this.settledAtMsValue;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** 只读投影快照（每次调用新对象；屏幕订阅消费的唯一形状）。 */
  snapshot(): SessionStreamUnitView {
    return {
      sessionId: this.sessionId,
      projectId: this.projectId,
      status: this.status,
      runId: this.runIdValue,
      settledAtMs: this.settledAtMsValue,
      metrics: {...this.metricsAcc},
      startedAtMs: this.startedAtMsValue,
      elapsedMs: this.elapsedMsValue,
      partialText: this.partialTextValue,
      partialThinking: this.partialThinkingValue,
      injected: this.injectedValue,
      pendingChildren: [...this.pendingChildrenValue],
    };
  }

  /**
   * 文本 delta 入口（manager 按 sessionId 路由）。
   *
   * 指标在事件到达即归账（不经缓冲节拍，蓝本 noteTextDelta 对齐）；
   * 正文进 32ms ingress 合并缓冲。runId 与当前 run 不符（陈旧事件）
   * 或非 running 态时整体忽略。
   */
  ingestTextDelta(runId: string, text: string): void {
    this.ingestDelta(runId, 'text', text);
  }

  /** 思考 delta 入口：语义同 {@link ingestTextDelta}。 */
  ingestThinkingDelta(runId: string, text: string): void {
    this.ingestDelta(runId, 'thinking', text);
  }

  /**
   * step 边界（STEP_COMMITTED，manager 按 sessionId 路由）。
   *
   * 先冲刷两段缓冲（蓝本：step commit 前 flush，防被后续 reload/clear 丢弃），
   * 再把 partial 清零（core 侧 streamRegistry 在 step 提交后重置，下一 step
   * 从空开始，单元对齐）并复位注入标记（新 step 后再 attach 需重新注入）。
   * 指标是 run 级累计，不在 step 边界清。返回是否生效（生效才触发投影通知）。
   */
  handleStepCommitted(runId: string): boolean {
    if (
      this.destroyed ||
      this.status !== 'running' ||
      this.runIdValue !== runId
    ) {
      return false;
    }
    this.flushStreamBuffers();
    this.partialTextValue = '';
    this.partialThinkingValue = '';
    this.injectedValue = false;
    return true;
  }

  /**
   * child-created 登记（manager 按 parentSessionId 路由）。
   *
   * 去重语义对齐蓝本 Map<title, childSessionId>：同 title 再次创建覆盖
   * （新 child 接管该 title 的任务卡）；同 childSessionId 已登记则不重复
   * 入投影。水合流程（Step 5）恢复链接也走本入口逐条回填。返回投影是否
   * 变化（变化才触发通知）。
   */
  registerPendingChild(childSessionId: string, title: string): boolean {
    if (this.destroyed || childSessionId.length === 0) {
      return false;
    }
    this.pendingChildIdsByTitle.set(title, childSessionId);
    if (this.pendingChildrenValue.includes(childSessionId)) {
      return false;
    }
    this.pendingChildrenValue = [
      ...this.pendingChildrenValue,
      childSessionId,
    ];
    return true;
  }

  /**
   * child 终态摘除（manager 由 FINISHED/FAILED 反查路由）：该子会话的
   * pending 态消失，落库 result meta 接管。返回投影是否变化。
   */
  removePendingChild(childSessionId: string): boolean {
    let removedTitle = false;
    for (const [title, id] of this.pendingChildIdsByTitle) {
      if (id === childSessionId) {
        this.pendingChildIdsByTitle.delete(title);
        removedTitle = true;
      }
    }
    if (!removedTitle) {
      return false;
    }
    this.pendingChildrenValue = this.pendingChildrenValue.filter(
      id => id !== childSessionId,
    );
    return true;
  }

  /** 清空全部子会话链接（父 run 收尾时由 settle 内部调用）。 */
  private clearPendingChildren(): void {
    this.pendingChildIdsByTitle.clear();
    this.pendingChildrenValue = [];
  }

  /** 注册 webview 句柄（重复 handleId 先移除旧条目再追加，保持「最后 attach」序）。 */
  attachWebview(handle: SessionStreamWebviewHandle): void {
    this.detachWebview(handle.handleId);
    this.webviewHandles.push(handle);
    // 新句柄挂上即尝试注入本 step 已累积的 partial（run 活跃且未注入过才生效）
    this.tryInjectPartialInto(handle);
  }

  /**
   * 摘除句柄（未注册的 handleId 静默 no-op）。
   *
   * 摘除即作废本 step 的注入标记：句柄走了（webview 卸载/切走），重进
   * （再 attach）需重新注入——蓝本「mount 复位」的单元化等价。
   */
  detachWebview(handleId: string): void {
    const index = this.webviewHandles.findIndex(
      handle => handle.handleId === handleId,
    );
    if (index >= 0) {
      this.webviewHandles.splice(index, 1);
      this.injectedValue = false;
    }
  }

  /** 最后 attach 的可见句柄（从后往前找第一个可见；无句柄或全不可见为 null）。 */
  resolveStreamingWebview(): SessionStreamWebviewHandle | null {
    for (let i = this.webviewHandles.length - 1; i >= 0; i -= 1) {
      const handle = this.webviewHandles[i];
      if (handle == null) {
        continue;
      }
      if (handle.isVisible?.() ?? true) {
        return handle;
      }
    }
    return null;
  }

  /** 流式载荷只推给流式目标句柄（管线调用；句柄回调异常吞掉防断流）。 */
  pushStreamPayload(payload: unknown): void {
    const target = this.resolveStreamingWebview();
    if (target != null) {
      this.emitStreamPayload(target, payload);
    }
  }

  /** 控制类消息全句柄广播（单个句柄抛错不影响其余句柄收到）。 */
  broadcastControlMessage(message: unknown): void {
    for (const handle of [...this.webviewHandles]) {
      try {
        handle.onControlMessage?.(message);
      } catch (err) {
        console.error(
          '[novel-master/session-stream-unit] onControlMessage failed',
          err,
        );
      }
    }
  }

  /** 当前句柄数（诊断/测试用）。 */
  getWebviewCount(): number {
    return this.webviewHandles.length;
  }

  /** delta 统一入口：守卫 → 指标归账 → 入队 → 调度 32ms 合并。 */
  private ingestDelta(
    runId: string,
    kind: StreamWireKind,
    text: string,
  ): void {
    if (this.destroyed || text.length === 0) {
      return;
    }
    if (this.status !== 'running' || this.runIdValue !== runId) {
      return;
    }
    if (kind === 'text') {
      this.metricsAcc.textChars += text.length;
    } else {
      this.metricsAcc.thinkingChars += text.length;
    }
    appendWireChunk(this.ingressQueue, {kind, delta: text});
    if (this.ingressTimer == null) {
      this.ingressTimer = setTimeout(() => {
        this.ingressTimer = null;
        this.flushIngressToApplyBuffer();
      }, SESSION_STREAM_INGRESS_COALESCE_MS);
    }
  }

  /** ingress 队列合并后压进 apply 缓冲（空队列 no-op）。 */
  private flushIngressToApplyBuffer(): void {
    if (this.ingressQueue.length === 0) {
      return;
    }
    const coalesced = coalesceWireQueue(this.ingressQueue);
    this.ingressQueue = [];
    this.applyBuffer.pushAll(coalesced);
  }

  /**
   * 边界（step/settle）前手动冲刷：取消 ingress 的 32ms 定时器并把队列
   * 压进 apply 缓冲，再手动 flush 绕过 64ms 节流——两段缓冲一次清空，
   * 同步下发（蓝本 flushBuffers）。
   */
  private flushStreamBuffers(): void {
    if (this.ingressTimer != null) {
      clearTimeout(this.ingressTimer);
      this.ingressTimer = null;
      this.flushIngressToApplyBuffer();
    }
    this.applyBuffer.flush();
  }

  /**
   * apply 叶子：合并段累积进单元 partial + 推给最后 attach 的可见句柄 +
   * 触发投影变更通知（64ms 节拍，对齐蓝本 streamingText 的 setState 节奏）。
   *
   * 无句柄时推送自然落空，但 partial 照常累积——切走后事件仍消费（T-U2），
   * 重进靠注入补齐。
   */
  private applyStreamSegments(segments: readonly StreamWireChunk[]): void {
    if (segments.length === 0) {
      return;
    }
    for (const seg of segments) {
      if (seg.kind === 'text') {
        this.partialTextValue += seg.delta;
      } else {
        this.partialThinkingValue += seg.delta;
      }
    }
    this.pushStreamPayload({type: 'stream-batch', segments});
    this.onProjectionChanged?.();
  }

  /**
   * 单一注入实现（吸收 useChatStreamResumeInject + SubagentSessionScreen
   * 内联版的共同语义）：把本 step 已累积的 partial 经 stream-delta 载荷
   * 一次性注入指定句柄。
   *
   * 守卫顺序：未销毁 → 本 step 未注入过（恰好一次）→ run 活跃（结束后
   * 不注入，落库消息接管）→ partial 非空。注入后置标记，step 边界与
   * 句柄摘除复位。
   */
  private tryInjectPartialInto(handle: SessionStreamWebviewHandle): void {
    if (this.destroyed || this.injectedValue) {
      return;
    }
    if (this.status !== 'running') {
      return;
    }
    if (
      this.partialTextValue.length === 0 &&
      this.partialThinkingValue.length === 0
    ) {
      return;
    }
    this.injectedValue = true;
    if (this.partialTextValue.length > 0) {
      this.emitStreamPayload(handle, {
        type: 'stream-delta',
        kind: 'text',
        delta: this.partialTextValue,
      });
    }
    if (this.partialThinkingValue.length > 0) {
      this.emitStreamPayload(handle, {
        type: 'stream-delta',
        kind: 'thinking',
        delta: this.partialThinkingValue,
      });
    }
  }

  /** 定向发流式载荷给指定句柄（注入路径；回调异常吞掉防断流）。 */
  private emitStreamPayload(
    handle: SessionStreamWebviewHandle,
    payload: unknown,
  ): void {
    try {
      handle.onStreamPayload?.(payload);
    } catch (err) {
      console.error(
        '[novel-master/session-stream-unit] onStreamPayload failed',
        err,
      );
    }
  }

  private scheduleGraceDestroy(): void {
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.onGraceExpired?.(this);
    }, this.settledGraceMs);
  }
}
