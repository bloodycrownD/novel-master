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
 * - 子会话链接：pendingChildren 登记（同 title 覆盖、同 id 去重）、父收尾
 *   清空（蓝本 subagentChildSessionsByParent 语义，防陈旧条目串到下一
 *   run）。子会话终态不摘除——并行 task 批整批 fork-join，落库 result
 *   meta 要等最慢子 agent 完成才接管任务卡，窗口期里 pending 映射是任务
 *   卡唯一可点数据源；
 *
 * Step 4 填实的消息管线（蓝本 = useChatTabMessages 的纯数据部分）：
 * - tail 加载：非 force 先读视图缓存（命中即采纳，不回源）、miss/force 走
 *   DB tail + hasMore 探针；加载完成无条件写视图缓存——无 webview attach
 *   的后台会话照常刷缓存（PRD「后台会话不蒸发」的消息面：收尾会话重进即
 *   最新）；
 * - 分页：以当前消息首行 seq 为锚向上翻页，prepend 后同步写缓存；
 * - step 级 reload：STEP_COMMITTED 冲刷 partial 后 force 回源拿落库行；
 *   settle（FINISHED/FAILED）同样 force reload——蓝本 flushRunUi 语义；
 * - force 快照驱动：pendingChildren 变化时向全句柄广播 force-snapshot
 *   控制消息（蓝本 ChatTranscriptWebView 的 pendingSubagentSessions
 *   force 直发触发平移到单元侧，屏幕 Step 6 接线消费）。
 *   作用域守卫（蓝本 sessionIdRef）结构性消失：结果只可能落回自己家。
 *
 * @module services/session-stream-unit
 */
import type {ChatMessage} from '@novel-master/core/chat';
import type {StreamWireChunk, StreamWireKind} from './stream-wire-queue';
import {appendWireChunk, coalesceWireQueue} from './stream-wire-queue';
import {createStreamApplyBuffer} from './stream-apply-buffer';
import type {StreamApplyBuffer} from './stream-apply-buffer';
import {
  getSessionViewCache,
  sessionViewCacheKey,
  setSessionViewCache,
} from './chat-session-view-cache';
import {prependOlderMessages} from './message-paging';

/** settled(finished|failed) 后的默认宽限销毁时长（毫秒）；测试可经构造参数覆盖。 */
export const SESSION_STREAM_SETTLED_GRACE_PERIOD_MS = 30_000;

/** ingress 合并窗口（毫秒）：高频 delta 先入队，32ms 内合并后再进 apply 缓冲。 */
export const SESSION_STREAM_INGRESS_COALESCE_MS = 32;

/** apply 缓冲的节流间隔（毫秒）：合并段按此节拍下发（对齐蓝本渲染节奏）。 */
export const SESSION_STREAM_APPLY_INTERVAL_MS = 64;

/** 消息管线分页大小（对齐蓝本 useChatTabMessages 的 CHAT_PAGE_SIZE）。 */
export const SESSION_STREAM_MESSAGES_PAGE_SIZE = 40;

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
 * 控制类消息（onControlMessage 的线上形状；Step 6 屏幕接线消费）：
 * - reset-stream：对应 webview 的 resetStream；
 * - force-snapshot：要求句柄侧立即直发全量快照（绕过 defer/streamActive
 *   拦截）——subagent 长任务期间消息可见的驱动面，蓝本是 webview 组件内
 *   pendingSubagentSessions 变化时的 force 直发。
 */
export type SessionStreamUnitControlMessage =
  | {readonly type: 'reset-stream'}
  | {readonly type: 'force-snapshot'};

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

/**
 * 消息仓库窄口（单元消息管线回源 DB 用）。
 *
 * 单元本体不持有 runtime——由 manager 构造时从 runtime.messages 透传
 * （结构上就是 core MessageService 的子集）。
 */
export interface SessionStreamMessageStore {
  listBySessionTail(
    sessionId: string,
    options: {limit: number},
  ): Promise<readonly ChatMessage[]>;
  listBySessionPage(
    sessionId: string,
    options: {limit: number; beforeSeq?: number},
  ): Promise<readonly ChatMessage[]>;
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
  /**
   * 子会话链接的 title → childSessionId 映射（Step 6 屏幕接线：任务卡
   * 可点性的数据源——ChatTranscriptWebView 的 pendingSubagentSessions
   * props 形状）。每次快照新 Map，消费方只读。
   */
  readonly pendingChildrenByTitle: ReadonlyMap<string, string>;
  /**
   * 消息面（Step 4 消息管线）：本会话当前持有的消息行（tail 加载/分页/
   * step 级 reload 的结果）。无消息仓库且缓存未命中时为空数组。
   */
  readonly messages: readonly ChatMessage[];
  /** 是否还有更早的消息可翻页（tail 探针/分页结果推导）。 */
  readonly hasMoreMessages: boolean;
  /** 分页加载是否在途（防重入）。 */
  readonly loadingMoreMessages: boolean;
}

/** 单元构造参数。 */
export interface SessionStreamUnitOptions {
  readonly sessionId: string;
  readonly projectId: string;
  /** 消息仓库窄口（消息管线回源 DB 用；由 manager 从 runtime.messages 透传）。 */
  readonly messageStore?: SessionStreamMessageStore;
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

  /** 消息面状态（Step 4：tail/分页/step 级 reload 的落点）。 */
  private messagesValue: readonly ChatMessage[] = [];
  private hasMoreMessagesValue = false;
  private loadingMoreMessagesValue = false;
  /** force tail reload 在途去重（蓝本 reloadInFlightRef：force 合流不重发）。 */
  private tailReloadInFlight: Promise<readonly ChatMessage[]> | null = null;

  private readonly webviewHandles: SessionStreamWebviewHandle[] = [];
  private readonly messageStore?:
    | SessionStreamMessageStore
    | undefined;
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
    this.messageStore = options.messageStore;
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
    // 收尾消息面：force 回源拿最终落库行并刷视图缓存（蓝本 FINISHED 的
    // flushRunUi reload 语义）。无 webview attach 的后台会话照常执行——
    // 缓存刷新不依赖屏幕在场（「后台会话不蒸发」）。异步吞错（DB 失败不
    // 阻碍收尾状态机）。
    this.kickTailReloadQuietly();
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

  /**
   * 水合回填（Step 5）：从持久层 run_state 行恢复中断现场。
   *
   * 仅 interrupted 态可回填（manager 的水合流程先 adoptInterruptedUnit
   * 再调这里）。partial/指标/startedAtMs 从行恢复；pendingChildren 只
   * 存了 id 序列（title→id 映射不可恢复，后续同 title 新 child 的覆盖
   * 语义自然退化为按 id 追加）；settledAtMs 用行的 updated_at_ms 近似
   * 中断时刻，保证多次重启不刷新 LRU 新旧序。本单元不挂写通 coalescer
   * （run 已死，只读）。
   */
  hydrateFromRunState(state: {
    readonly runId: string;
    readonly startedAtMs: number;
    readonly settledAtMs: number;
    readonly metrics: SessionStreamUnitMetrics;
    readonly partialText: string;
    readonly partialThinking: string;
    readonly pendingChildren: readonly string[];
  }): boolean {
    if (this.destroyed || this.status !== 'interrupted') {
      return false;
    }
    this.runIdValue = state.runId;
    this.startedAtMsValue = state.startedAtMs;
    this.settledAtMsValue = state.settledAtMs;
    this.metricsAcc = {...state.metrics};
    this.partialTextValue = state.partialText;
    this.partialThinkingValue = state.partialThinking;
    this.pendingChildrenValue = [...state.pendingChildren];
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
      pendingChildrenByTitle: new Map(this.pendingChildIdsByTitle),
      messages: [...this.messagesValue],
      hasMoreMessages: this.hasMoreMessagesValue,
      loadingMoreMessages: this.loadingMoreMessagesValue,
    };
  }

  /**
   * 文本 delta 入口（manager 按 sessionId 路由）。
   *
   * 指标在事件到达即归账（不经缓冲节拍，蓝本 noteTextDelta 对齐）；
   * 正文进 32ms ingress 合并缓冲。runId 与当前 run 不符（陈旧事件）
   * 或非 running 态时整体忽略。返回是否生效（Step 5 起 manager 以此
   * 决定是否把最新快照 append 进写通 coalescer——settled/interrupted
   * 单元的陈旧 delta 不产生持久层写）。
   */
  ingestTextDelta(runId: string, text: string): boolean {
    return this.ingestDelta(runId, 'text', text);
  }

  /** 思考 delta 入口：语义同 {@link ingestTextDelta}。 */
  ingestThinkingDelta(runId: string, text: string): boolean {
    return this.ingestDelta(runId, 'thinking', text);
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
    // step 落库行进消息面：partial 清零后 force 回源 reload（蓝本
    // flushAgentStepUi 的 reload 方向；webview 侧的 streamCommit 是 Step 6
    // 接线，这里只管数据面）。异步吞错。
    this.kickTailReloadQuietly();
    return true;
  }

  /**
   * child-created 登记（manager 按 parentSessionId 路由）。
   *
   * 去重语义对齐蓝本 Map<title, childSessionId>：同 title 再次创建覆盖
   * （新 child 接管该 title 的任务卡，旧 child 若无其他 title 归属则一并
   * 摘除）；同 childSessionId 已登记则不重复入投影。水合流程（Step 5）
   * 恢复链接也走本入口逐条回填。返回投影是否变化（变化才触发通知）。
   */
  registerPendingChild(childSessionId: string, title: string): boolean {
    if (this.destroyed || childSessionId.length === 0) {
      return false;
    }
    const previousId = this.pendingChildIdsByTitle.get(title);
    this.pendingChildIdsByTitle.set(title, childSessionId);
    if (previousId === childSessionId) {
      return false;
    }
    let changed = false;
    if (
      previousId != null &&
      previousId !== childSessionId &&
      !this.isChildIdReferenced(previousId)
    ) {
      this.pendingChildrenValue = this.pendingChildrenValue.filter(
        id => id !== previousId,
      );
      changed = true;
    }
    if (!this.pendingChildrenValue.includes(childSessionId)) {
      this.pendingChildrenValue = [
        ...this.pendingChildrenValue,
        childSessionId,
      ];
      changed = true;
    }
    if (changed) {
      // pending 集合变化 = 蓝本 pendingSubagentSessions 变化：任务卡要立即
      // 进基线，广播 force 快照让可见句柄直发全量（subagent 长任务期间
      // 消息可见）。
      this.requestForceSnapshot();
    }
    return changed;
  }

  /** 该 childSessionId 是否仍被任一 title 指向（覆盖判重的辅助）。 */
  private isChildIdReferenced(childSessionId: string): boolean {
    for (const id of this.pendingChildIdsByTitle.values()) {
      if (id === childSessionId) {
        return true;
      }
    }
    return false;
  }

  /** 清空全部子会话链接（父 run 收尾时由 settle 内部调用）。 */
  private clearPendingChildren(): void {
    if (this.pendingChildrenValue.length > 0) {
      this.requestForceSnapshot();
    }
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

  /**
   * 请求全量快照直发（force-snapshot 控制消息广播到全句柄）。
   *
   * Step 6 屏幕接线的消费面：subagent 屏/主屏句柄把它接到 webview 的
   * force snapshot 直发。pendingChildren 变化时单元内部也会自动触发。
   */
  requestForceSnapshot(): void {
    this.broadcastControlMessage({type: 'force-snapshot'});
  }

  /**
   * tail 加载（蓝本 reloadMessages 的方法本体）：
   * - 非 force：先读视图缓存（会话切换水合语义——命中即采纳、不回源 DB），
   *   miss 才回源；force：无条件回源 DB 拿最新落库行；
   * - 回源结果（含 hasMore 探针）无条件写视图缓存——后台会话（无 attach）
   *   收尾后重进即最新；
   * - force 在途去重：并发的 force 合流到同一 promise（蓝本 reloadInFlightRef）。
   *
   * 蓝本的 sessionIdRef 作用域守卫在这里结构性消失：单元 per-session，
   * 结果只会落回自己家的状态与缓存键。
   */
  async loadTailMessages(options?: {
    readonly force?: boolean;
  }): Promise<readonly ChatMessage[]> {
    const force = options?.force ?? false;
    if (force && this.tailReloadInFlight != null) {
      return this.tailReloadInFlight;
    }
    const task = this.performTailReload(force);
    if (!force) {
      return task;
    }
    this.tailReloadInFlight = task;
    try {
      return await task;
    } finally {
      if (this.tailReloadInFlight === task) {
        this.tailReloadInFlight = null;
      }
    }
  }

  /** 分页加载更早消息（蓝本 loadOlderMessages）：以当前首行 seq 为锚向上翻页。 */
  async loadOlderMessages(): Promise<void> {
    if (
      this.destroyed ||
      this.loadingMoreMessagesValue ||
      this.messagesValue.length === 0
    ) {
      return;
    }
    const beforeSeq = this.messagesValue[0]?.seq;
    if (beforeSeq == null) {
      return;
    }
    if (this.messageStore == null) {
      return;
    }
    this.loadingMoreMessagesValue = true;
    this.onProjectionChanged?.();
    try {
      const older = await this.messageStore.listBySessionPage(
        this.sessionId,
        {limit: SESSION_STREAM_MESSAGES_PAGE_SIZE, beforeSeq},
      );
      if (this.destroyed) {
        return;
      }
      if (older.length === 0) {
        // 没有更早的了：只收 hasMore，不动消息与缓存（蓝本同路径）。
        this.hasMoreMessagesValue = false;
        this.onProjectionChanged?.();
        return;
      }
      const hasMore = older.length === SESSION_STREAM_MESSAGES_PAGE_SIZE;
      const next = prependOlderMessages(this.messagesValue, older);
      setSessionViewCache(sessionViewCacheKey(this.projectId, this.sessionId), {
        messages: next,
        hasMoreMessages: hasMore,
      });
      this.messagesValue = next;
      this.hasMoreMessagesValue = hasMore;
      this.onProjectionChanged?.();
    } finally {
      this.loadingMoreMessagesValue = false;
      this.onProjectionChanged?.();
    }
  }

  /** step/settle 边界的 fire-and-forget force reload（错误吞掉不阻塞状态机）。 */
  private kickTailReloadQuietly(): void {
    void this.loadTailMessages({force: true}).catch(err => {
      console.error(
        '[novel-master/session-stream-unit] tail reload failed',
        err,
      );
    });
  }

  /**
   * tail reload 本体：缓存命中采纳（非 force）→ DB tail + hasMore 探针 →
   * 无条件写缓存 → 采纳进消息面。
   *
   * 缓存写在状态采纳之前：单元若在中途被销毁/替换（宽限到期、LRU 淘汰、
   * 新 run 替换吸收），缓存仍刷新到位——重进会话水合的就是最终行。同会话
   * 新 run 的后续 reload 会覆盖写，旧单元晚到的写入是幂等 tail 读、无害。
   */
  private async performTailReload(
    force: boolean,
  ): Promise<readonly ChatMessage[]> {
    const cacheKey = sessionViewCacheKey(this.projectId, this.sessionId);
    if (!force) {
      const cached = getSessionViewCache(cacheKey);
      if (cached != null) {
        this.applyMessages(cached.messages, cached.hasMoreMessages);
        return [...cached.messages];
      }
    }
    if (this.messageStore == null) {
      // 未装配消息仓库（防御降级，正常装配不会走到）：保持现状返回。
      return [...this.messagesValue];
    }
    const list = await this.messageStore.listBySessionTail(this.sessionId, {
      limit: SESSION_STREAM_MESSAGES_PAGE_SIZE,
    });
    let hasMore = false;
    const oldestSeq = list[0]?.seq;
    if (oldestSeq != null) {
      const older = await this.messageStore.listBySessionPage(this.sessionId, {
        limit: 1,
        beforeSeq: oldestSeq,
      });
      hasMore = older.length > 0;
    }
    // 无条件刷新视图缓存（含无 attach 的后台收尾场景——消息丢失回归的
    // 守卫点）；键是本会话自己的，天然不串会话。
    setSessionViewCache(cacheKey, {messages: list, hasMoreMessages: hasMore});
    this.applyMessages(list, hasMore);
    return [...list];
  }

  /** 采纳消息面并触发投影通知（销毁后跳过状态更新——缓存已照常写）。 */
  private applyMessages(
    messages: readonly ChatMessage[],
    hasMore: boolean,
  ): void {
    if (this.destroyed) {
      return;
    }
    this.messagesValue = [...messages];
    this.hasMoreMessagesValue = hasMore;
    this.onProjectionChanged?.();
  }

  /** delta 统一入口：守卫 → 指标归账 → 入队 → 调度 32ms 合并。返回是否生效。 */
  private ingestDelta(
    runId: string,
    kind: StreamWireKind,
    text: string,
  ): boolean {
    if (this.destroyed || text.length === 0) {
      return false;
    }
    if (this.status !== 'running' || this.runIdValue !== runId) {
      return false;
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
    return true;
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
