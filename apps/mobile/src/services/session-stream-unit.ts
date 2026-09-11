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
 * 本文件是单元本体骨架（Step 2）：状态机、宽限销毁与 webview 句柄注册表
 * 为可测实现；partial/metrics/pendingChildren 为占位字段（事件管线、缓冲、
 * 单一注入与指标真语义在 Step 3+ 填实，届时只扩展字段不改状态机骨架）。
 *
 * @module services/session-stream-unit
 */

/** settled(finished|failed) 后的默认宽限销毁时长（毫秒）；测试可经构造参数覆盖。 */
export const SESSION_STREAM_SETTLED_GRACE_PERIOD_MS = 30_000;

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

/** 指标快照（占位字段；Step 3 吸收 stream-metrics-store 语义：新 run 重置、结束冻结）。 */
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
  /** 指标占位（Step 3 填实；新单元天然为 0，即「新 run 重置」语义的占位形态）。 */
  readonly metrics: SessionStreamUnitMetrics;
  /** partial 占位（Step 3 流式管线填实；新单元为空串）。 */
  readonly partialText: string;
  readonly partialThinking: string;
  /** 注入标记占位（Step 3 单一注入实现填实）。 */
  readonly injected: boolean;
  /** 子会话链接占位（Step 3 child-created 管线填实）。 */
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
}

/**
 * 会话流式单元本体。
 *
 * 生命周期由 manager 驱动（受理/事件收尾/宽限到期/LRU 淘汰）；单元自身
 * 只维护状态机、占位字段与句柄注册表，不持有 runtime、不直接订阅事件总线。
 */
export class SessionStreamUnit {
  readonly sessionId: string;
  readonly projectId: string;

  private status: SessionStreamUnitStatus = 'idle';
  private runIdValue: string | null = null;
  private settledAtMsValue: number | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private metricsValue: SessionStreamUnitMetrics = {
    textChars: 0,
    thinkingChars: 0,
  };
  private partialTextValue = '';
  private partialThinkingValue = '';
  private injectedValue = false;
  private pendingChildrenValue: readonly string[] = [];

  private readonly webviewHandles: SessionStreamWebviewHandle[] = [];
  private readonly onSettled?:
    | ((status: SessionStreamRunSettledStatus) => void)
    | undefined;
  private readonly settledGraceMs: number;
  private readonly onGraceExpired?:
    | ((unit: SessionStreamUnit) => void)
    | undefined;

  constructor(options: SessionStreamUnitOptions) {
    this.sessionId = options.sessionId;
    this.projectId = options.projectId;
    this.onSettled = options.onSettled;
    this.onGraceExpired = options.onGraceExpired;
    this.settledGraceMs =
      options.settledGraceMs ?? SESSION_STREAM_SETTLED_GRACE_PERIOD_MS;
  }

  /** run 受理：idle → starting。非 idle（含销毁后）拒绝，返回是否迁移成功。 */
  begin(): boolean {
    if (this.destroyed || this.status !== 'idle') {
      return false;
    }
    this.status = 'starting';
    return true;
  }

  /** RUN_STARTED 回填：starting → running。其余状态拒绝。 */
  markRunning(runId: string): boolean {
    if (this.destroyed || this.status !== 'starting') {
      return false;
    }
    this.status = 'running';
    this.runIdValue = runId;
    return true;
  }

  /**
   * 事件收尾：running → settled(finished|failed)，并启动宽限销毁定时器。
   *
   * 仅 running 可收尾（事件路径的 runId 所有权校验在 manager 侧；
   * 这里是状态机第二道守卫）。
   */
  settle(status: SessionStreamRunSettledStatus): boolean {
    if (this.destroyed || this.status !== 'running') {
      return false;
    }
    this.status = status;
    this.settledAtMsValue = Date.now();
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
   * 销毁：清宽限定时器与句柄注册表（幂等）。
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
      metrics: {...this.metricsValue},
      partialText: this.partialTextValue,
      partialThinking: this.partialThinkingValue,
      injected: this.injectedValue,
      pendingChildren: [...this.pendingChildrenValue],
    };
  }

  /** 注册 webview 句柄（重复 handleId 先移除旧条目再追加，保持「最后 attach」序）。 */
  attachWebview(handle: SessionStreamWebviewHandle): void {
    this.detachWebview(handle.handleId);
    this.webviewHandles.push(handle);
  }

  /** 摘除句柄（未注册的 handleId 静默 no-op）。 */
  detachWebview(handleId: string): void {
    const index = this.webviewHandles.findIndex(
      handle => handle.handleId === handleId,
    );
    if (index >= 0) {
      this.webviewHandles.splice(index, 1);
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

  /** 流式载荷只推给流式目标句柄（Step 3 管线调用；句柄回调异常吞掉防断流）。 */
  pushStreamPayload(payload: unknown): void {
    try {
      this.resolveStreamingWebview()?.onStreamPayload?.(payload);
    } catch (err) {
      console.error(
        '[novel-master/session-stream-unit] onStreamPayload failed',
        err,
      );
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

  private scheduleGraceDestroy(): void {
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.onGraceExpired?.(this);
    }, this.settledGraceMs);
  }
}
