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
 *   不清）、startedAtMs 于 begin() 受理时置位（重进连续计时）、
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
import {
  composeStreamTokens,
  createTokenRateSampler,
  reanchorStreamTokenBase,
} from '@novel-master/core/format';
import type {
  IncrementalTokenCounter,
  StreamTokenSource,
  TokenRateSampler,
} from '@novel-master/core/format';
import {CHARACTERS_PER_TOKEN_RATIO} from '@novel-master/core/provider';
import type {StreamWireChunk, StreamWireKind} from './stream-wire-queue';
import {appendWireChunk, coalesceWireQueue} from './stream-wire-queue';
import {createStreamApplyBuffer} from './stream-apply-buffer';
import type {StreamApplyBuffer} from './stream-apply-buffer';
import {
  getSessionViewCache,
  hydrateWindowFromCache,
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

/**
 * 指标快照：run 级累计（新 run 重置=新单元天然零值；step 边界不清）。
 *
 * token 字段（stream-metrics-tokens / stream-metrics-native ①）：
 * `completionTokens = max(0, 基线 + 增量估算)`，其中
 * - 增量估算：未注入 token 估算器（②）时是启发式 `ceil(totalChars /
 *   CHARACTERS_PER_TOKEN_RATIO)`（与 `HeuristicTokenCounter.countText` 单次
 *   全量计数严格一致）；注入估算器时是「文本 + 思考尾窗增量估算」之和；
 * - 基线：usage 事件到达时重锚为 `usageValue − 当时的增量估算`——真值成为
 *   基线，此后每个 delta 的增量继续叠加上去（第二步文本流不再冻结在上一
 *   步 usage 值上）。多步 run 的数字因此单调增长，而不是停在旧真值。
 * `tokenSource` 记录当前基线的来源（usage=基线来自事件真值；heuristic=基线
 * 为 0 的纯估算），不再表示「真值后不再回写」。
 */
export interface SessionStreamUnitMetrics {
  readonly textChars: number;
  readonly thinkingChars: number;
  readonly completionTokens: number;
  readonly tokenSource: SessionStreamUnitTokenSource;
}

/** token 计数来源：usage=基线来自事件真值（run 级累计），读值=基线+增量；
 * heuristic=基线为 0 的纯估算。
 * 复用 core 的中立类型（别名）——联合字面量单一声明在 core 的
 * `StreamTokenSource`，消费端不再各写一份。 */
export type SessionStreamUnitTokenSource = StreamTokenSource;

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
  /** run 开始时刻（毫秒，begin() 受理时置位）；未开始为 0。运行中重进连续计时。 */
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
   * props 形状）。返回内部引用且仅在内容变化时换新引用（copy-on-write）：
   * 消费方（webview memo / effect 依赖）按引用比较判断变化，无谓新引用
   * 会打穿 memo 使隐藏 webview 被记脏。调用方只读、不得 mutate。
   */
  readonly pendingChildrenByTitle: ReadonlyMap<string, string>;
  /**
   * 消息面（Step 4 消息管线）：本会话当前持有的消息行（tail 加载/分页/
   * step 级 reload 的结果）。无消息仓库且缓存未命中时为空数组。
   * 返回内部引用（写入点均为内容变化时整体换新数组，见 applyMessages
   * 的引用稳定守卫）——引用稳定是消费方 webview memo 比较成立的必要
   * 条件。调用方只读、不得 mutate。
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
  /**
   * 实时 token 估算器工厂（stream-metrics-native ②）：由 runtime 装配方注入
   * （真 tiktoken 绑定），单元为正文/思考各建一条独立估算器。
   * **不注入 = 旧启发式行为**（`ceil(totalChars / 3.35)`），**未收到 usage 前**
   * 与旧口径严格一致；usage 到达后按 ①「基线 + 增量」口径。工厂返回 null
   * （构造失败）同样回退。
   */
  readonly tokenEstimatorFactory?: (
    sessionId: string,
  ) => IncrementalTokenCounter | null;
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

  /** 指标累积器（可变内部形状；snapshot 时展开为 readonly 投影）。 */
  private metricsAcc: {
    textChars: number;
    thinkingChars: number;
    completionTokens: number;
    tokenSource: SessionStreamUnitTokenSource;
  } = {
    textChars: 0,
    thinkingChars: 0,
    completionTokens: 0,
    tokenSource: 'heuristic',
  };
  /**
   * usage 基线（stream-metrics-native ①）：`completionTokens = max(0, 基线 +
   * 增量估算)`。未收到 usage 时为 0（退化为纯估算）；usage 到达时重锚为
   * `usageValue − 当时的增量估算`，此后 delta 的增量继续叠加（多步 run 不再
   * 冻结在上一 step 的真值上）。
   *
   * **不是 metricsAcc 的字段**：snapshot() 会把 metricsAcc 整体透出，多个
   * 用例按精确形状比对，内部状态不得混进投影。
   */
  private baseTokens = 0;
  /**
   * 实时 token 估算器（stream-metrics-native ②）：正文/思考各一条独立尾窗
   * 计数器（`createIncrementalTokenCounter` 的宿主绑定由装配方经
   * `tokenEstimatorFactory` 注入）。工厂不在构造函数里调、在 `begin()` 里
   * 调（首建编码表 180–420ms，水合 / 懒建路径不经 `begin()` 天然免付）；
   * 两条都建不起来（未注入/构造失败）时保持 null，走启发式兜底——投影形状
   * 与既有行为不变。
   */
  private readonly tokenEstimatorFactory:
    | ((sessionId: string) => IncrementalTokenCounter | null)
    | undefined;
  private textTokenEstimator: IncrementalTokenCounter | null = null;
  private thinkingTokenEstimator: IncrementalTokenCounter | null = null;
  /**
   * 实时速率采样器（stream-metrics-tokens）：token 每变一次记一样本，
   * 渲染侧只读（rateTokensPerSecond）；收尾时 freeze 出「上次生成」的
   * 末值速率（窗口以最后样本时刻收尾，不受收尾前停顿影响）。单元自持而
   * 非组件持有——冻结值要与实时值同源，且须跨单元存活/水合后的读取。
   */
  private readonly rateSampler: TokenRateSampler = createTokenRateSampler();
  private startedAtMsValue = 0;
  private elapsedMsValue: number | null = null;
  /**
   * 本 step 的 in-flight partial 累积分段（数组追加，不做 per-delta 字符串
   * `+=`——64ms 节拍下的全量重建会随流长超线性）。物化点收敛到读取处
   * （snapshot / 句柄注入），配 dirty 标志缓存：同一节拍内的多次读取
   * （manager 的 appendWritethroughSnapshot 逐 delta 事件调 snapshot）只
   * join 一次，物化频率受 apply 节拍约束而非 delta 事件频率。
   */
  private partialTextSegments: string[] = [];
  private partialThinkingSegments: string[] = [];
  private partialTextCache = '';
  private partialThinkingCache = '';
  private partialTextDirty = false;
  private partialThinkingDirty = false;
  private injectedValue = false;
  /**
   * 子会话链接：title → childSessionId（同 title 覆盖；投影按 id 去重）。
   * copy-on-write：内容变化时整体换新 Map（snapshot 返回内部引用），引用
   * 稳定是消费方（webview memo / effect 依赖）判断变化的前提。
   */
  private pendingChildIdsByTitle = new Map<string, string>();
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
    // 实时 token 估算器**不在这里建**（构造时机＝会话切换时空闲预热，未就绪
    // 时在 `begin()` 同步兜底，见下）：首建 tiktoken 编码表约 180–420ms，
    // 放在构造函数里会让「启动水合 / 子会话懒建」白付一次启动卡顿。两条都
    // 建成才启用估算器路径——半套状态会让正文/思考的增量口径不一致，
    // 不如整体回退。
    this.tokenEstimatorFactory = options.tokenEstimatorFactory;
    this.applyBuffer = createStreamApplyBuffer(
      segments => this.applyStreamSegments(segments),
      {flushIntervalMs: SESSION_STREAM_APPLY_INTERVAL_MS},
    );
  }

  /**
   * run 受理：idle → starting。非 idle（含销毁后）拒绝，返回是否迁移成功。
   *
   * 受理即置指标计时起点（用户请求时刻）——starting 阶段指标条就显示，
   * 不等 RUN_STARTED 事件回填（事件晚到/丢失不影响状态条出现）。
   */
  begin(): boolean {
    if (this.destroyed || this.status !== 'idle') {
      return false;
    }
    this.status = 'starting';
    this.startedAtMsValue = Date.now();
    // 估算器在此建（不在构造函数）：会话切换时的空闲预热多半已备好编码表、
    // 这里命中缓存；没备好才真付一次 180–420ms。必须在请求发出前完成，
    // 不推迟首个 delta。水合 / 中断单元不经 `begin()`，天然免付这一次。
    this.buildTokenEstimators();
    // 新 run：速率采样序列重 seed（防跨 run 差分污染首个窗口）；token 基线
    // 与两条估算器一并归零（新 run 从零起算）。
    this.rateSampler.reset();
    this.baseTokens = 0;
    this.textTokenEstimator?.reset();
    this.thinkingTokenEstimator?.reset();
    return true;
  }

  /**
   * 经注入的工厂建正文/思考两条估算器（`begin()` 里调用）。
   *
   * 两条都建成才启用——半套状态会让正文/思考的增量口径不一致，宁可整条
   * 回退启发式；工厂抛错同样吞掉（构造失败只是「这次退启发式」，不该把
   * run 受理打断）。
   */
  private buildTokenEstimators(): void {
    const factory = this.tokenEstimatorFactory;
    if (factory == null) {
      return;
    }
    try {
      const text = factory(this.sessionId);
      const thinking = text == null ? null : factory(this.sessionId);
      if (text != null && thinking != null) {
        this.textTokenEstimator = text;
        this.thinkingTokenEstimator = thinking;
      }
    } catch (err) {
      console.warn(
        '[novel-master/session-stream-unit] token estimator init failed, fallback to heuristic',
        err,
      );
    }
  }

  /**
   * RUN_STARTED 回填：starting → running。
   *
   * 计时起点已随 begin() 置位于请求受理时刻（用户感知口径：从点发送
   * 起算），此处不重置；重进连续计时不从零的语义不变。同一 runId 的
   * 重复 STARTED（回填双发）被状态守卫拒绝，天然不重复迁移。
   */
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
   * 收尾前先冲刷两段缓冲（蓝本：FINISHED/FAILED 先 flush，保证在途 delta
   * 先于落库 reload 到达、不被 clear 丢弃）；历时冻结为「上次生成」。
   * 仅 running 可收尾（事件路径的 runId 所有权校验在 manager 侧；
   * 这里是状态机第二道守卫）。**starting 例外（2026-09-30）**：前奏期停止
   * 由 manager 补调 finishRun('', 'finished')——受理期单元同样要收
   * settled，否则 starting 行/单元无人收口（重启水合误判中断现场）。
   * **事件口径（r3-run-1 后）**：core 前奏终态发 FINISHED/FAILED(runId:'')，
   * 事件路径优先收口，manager 的 .then/.catch 仅为幂等兜底。starting 段
   * 无流缓冲、runId 未回填，下方各步对其天然 no-op；`startedAtMs` 仍由
   * begin() 置位，故 elapsed 按受理时刻起算（非 0）。
   */
  settle(status: SessionStreamRunSettledStatus): boolean {
    if (
      this.destroyed ||
      (this.status !== 'running' && this.status !== 'starting')
    ) {
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
    // 防御性重锚：回填的 completionTokens 是「中断时的最终读值」（可能含
    // usage 真值），基线锚成 `读值 − 当前增量估算`，保证水合后读值不被估算
    // 口径切换改写。本单元未经 `begin()`（构造时已不同步建估算器），故没有
    // 估算器、`estimateIncrementTokens()` 走的是启发式分支——重锚等价于
    // `读值 − ceil(chars/3.35)`。
    this.reanchorBase(state.metrics.completionTokens);
    // 回填的完整字符串直接充当物化缓存（无分段历史，无需 join）。
    this.partialTextSegments = [];
    this.partialThinkingSegments = [];
    this.partialTextCache = state.partialText;
    this.partialThinkingCache = state.partialThinking;
    this.partialTextDirty = false;
    this.partialThinkingDirty = false;
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

  /** 实时速率（token/秒；渲染节拍只读——暂停期随 nowMs 增长自然衰减）。 */
  getRateTokensPerSecond(nowMs: number): number | null {
    return this.rateSampler.rateAt(nowMs);
  }

  /**
   * run 收尾的末值速率快照（「上次生成」的速率段数据源）：窗口以最后一个
   * 样本时刻收尾，故收尾前的停顿不拉低它；样本不足以成窗口（如 openai
   * 真值只在收尾到达、翻转后没有第二个样本）时回落到校正前的末值。
   */
  getFinalRateTokensPerSecond(): number | null {
    return this.rateSampler.freeze();
  }

  /** 记一个速率样本（token 每次变化处调用；序列维护语义见 core 采样器）。 */
  private sampleRate(): void {
    this.rateSampler.sample(
      this.metricsAcc.completionTokens,
      this.metricsAcc.tokenSource,
      Date.now(),
    );
  }

  /**
   * 当前增量估算（不含基线）：注入估算器时 = 正文估算 + 思考估算（两条尾窗
   * 计数器各自累计）；未注入/构造失败时 = 旧启发式 `ceil(totalChars /
   * CHARACTERS_PER_TOKEN_RATIO)`（对**累计**字符取 ceil，与
   * `HeuristicTokenCounter.countText` 单次全量计数严格一致——逐 delta 浮点
   * 累加 len/3.35 再取整与全量 ceil 不等价）。
   */
  private estimateIncrementTokens(): number {
    const text = this.textTokenEstimator;
    const thinking = this.thinkingTokenEstimator;
    if (text != null && thinking != null) {
      return text.tokens + thinking.tokens;
    }
    return Math.ceil(
      (this.metricsAcc.textChars + this.metricsAcc.thinkingChars) /
        CHARACTERS_PER_TOKEN_RATIO,
    );
  }

  /** 重算 `completionTokens = max(0, 基线 + 增量估算)`（delta 归账后调用）。 */
  private recomputeCompletionTokens(): void {
    this.metricsAcc.completionTokens = composeStreamTokens(
      this.baseTokens,
      this.estimateIncrementTokens(),
    );
  }

  /**
   * 重锚基线（usage 事件到达 / 水合回填）：把 `value` 定为当前读值——
   * 基线 = value − 当前增量估算，后续 delta 的增量继续叠加上去。
   * 未收到 usage 前基线恒 0（纯估算），故重锚只发生在校正点。
   */
  private reanchorBase(value: number): void {
    this.baseTokens = reanchorStreamTokenBase(
      value,
      this.estimateIncrementTokens(),
    );
    this.metricsAcc.completionTokens = composeStreamTokens(value, 0);
  }

  /** 只读投影快照（每次调用新对象；messages/pendingChildrenByTitle 字段返回内部引用——见字段注释的引用稳定契约）。 */
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
      partialText: this.materializePartialText(),
      partialThinking: this.materializePartialThinking(),
      injected: this.injectedValue,
      pendingChildren: [...this.pendingChildrenValue],
      // 引用稳定（修隐藏 webview 被记脏）：messages 数组与 title 映射在内容
      // 未变时必须保持同一引用——ChatTranscriptWebView 的 memo 与
      // pendingSubagentSessions effect 都按引用比较，每次快照造新引用会让
      // 任意会话的 64ms 节拍通知打穿 memo、向隐藏 webview 发全量快照。
      // 两字段的写入点均为「内容变化才换新引用」（copy-on-write），见
      // applyMessages / registerPendingChild / clearPendingChildren。
      pendingChildrenByTitle: this.pendingChildIdsByTitle,
      messages: this.messagesValue,
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
   * usage 事件入口（manager 按 sessionId 路由，EVENT_AGENT_STREAM_USAGE）。
   *
   * 事件携带的是 **run 级累计** `completionTokens`（runner 已换算，消费端零
   * 算术）。到达即把它设为**基线**（`base = 真值 − 当前增量估算`）并置
   * `source=usage`——此后每个 delta 的增量继续叠在真值上（多步 run 的第二步
   * 文本流不再冻结在上一 step 的真值上；不再有「真值后 heuristic 不回写」的
   * 门）。openai 流中零事件段由估算撑显示，step done 后 runner 补发的 run 级
   * 终值经本入口重锚、把估值校正到真值。守卫同 delta：running 态 + runId
   * 所有权（陈旧事件不计指标）。返回是否生效（生效才触发写通快照 append）。
   */
  ingestUsage(runId: string, completionTokens: number): boolean {
    if (
      this.destroyed ||
      this.status !== 'running' ||
      this.runIdValue !== runId ||
      !Number.isFinite(completionTokens) ||
      completionTokens < 0
    ) {
      return false;
    }
    this.metricsAcc = {
      ...this.metricsAcc,
      tokenSource: 'usage',
    };
    this.reanchorBase(completionTokens);
    this.sampleRate();
    return true;
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
    this.resetPartial();
    this.injectedValue = false;
    // step 边界重置流式尾巴（reset-stream 广播）：partial 清零后下一 step
    // 从空开始，但 webview 侧的 stream tail 与 RN 组件的本地累积不清的话，
    // 下一 step 的 thinking/text delta 会追加进上一 step 的残留尾巴（正文/
    // 思考交替错段）。落库行由随后的 force 快照进基线，尾巴此时必须整体
    // 重置——resetStreamTail 的 cancel RAF 还能拦截本步残余 delta 的迟到
    // post（内容已由落库行接管，丢弃无碍）。
    this.broadcastControlMessage({type: 'reset-stream'});
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
    if (previousId === childSessionId) {
      // 重复登记（同 id 同 title）：内容未变，保持映射引用不变。
      return false;
    }
    // copy-on-write：映射内容变化才整体换新 Map——snapshot 返回内部引用，
    // 引用稳定是消费方（webview memo / pendingSubagentSessions effect 依赖）
    // 判断变化的前提，无谓新引用会打穿 memo。
    const nextByTitle = new Map(this.pendingChildIdsByTitle);
    nextByTitle.set(title, childSessionId);
    this.pendingChildIdsByTitle = nextByTitle;
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
    // 换新 Map 而非原位 clear：snapshot 返回内部引用，内容清空也必须换新
    // 引用（消费方按引用比较感知变化——任务卡 pending 态随父收尾消失）。
    this.pendingChildIdsByTitle = new Map();
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
   * 取出全部句柄并清空注册表（单元替换吸收时的迁移通道）：取出的句柄
   * 由 manager 转挂给替换者单元，保证流式推送目标在旧→新单元间不丢失。
   * 不复位 injectedValue——句柄只是搬家，本单元随后即被销毁。
   */
  takeWebviewHandles(): SessionStreamWebviewHandle[] {
    const handles = [...this.webviewHandles];
    this.webviewHandles.length = 0;
    return handles;
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
   * tail reload 本体：缓存命中采纳（非 force，**仅冷启动面空时窗口化**）→
   * 回源单查询（多取一条判定 hasMore，init-busy-yield Step 2）→ 无条件写
   * 缓存 → 采纳进消息面。
   *
   * 单查询化：tail 一次取 `页大小 + 1`，返回超过页大小即 hasMore=true 并
   * 裁去多取的最旧一行（listBySessionTail 返回 seq 升序、最旧在前，多取
   * 的一行在数组头部 list[0]）；hasMore 探针的第二次往返消除。
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
        // 只有冷启动水合才裁窗口：已有消息面是用户自己翻出来的（loadOlder
        // 会把整面写回缓存），截回去等于当着用户的面把转录塌掉。
        const adopted =
          this.messagesValue.length === 0
            ? hydrateWindowFromCache(cached)
            : cached;
        this.applyMessages(adopted.messages, adopted.hasMoreMessages);
        return [...adopted.messages];
      }
    }
    if (this.messageStore == null) {
      // 未装配消息仓库（防御降级，正常装配不会走到）：保持现状返回。
      return [...this.messagesValue];
    }
    const fetched = await this.messageStore.listBySessionTail(this.sessionId, {
      limit: SESSION_STREAM_MESSAGES_PAGE_SIZE + 1,
    });
    const hasMore = fetched.length > SESSION_STREAM_MESSAGES_PAGE_SIZE;
    const list = hasMore ? fetched.slice(1) : fetched;
    // 无条件刷新视图缓存（含无 attach 的后台收尾场景——消息丢失回归的
    // 守卫点）；键是本会话自己的，天然不串会话。
    setSessionViewCache(cacheKey, {messages: list, hasMoreMessages: hasMore});
    this.applyMessages(list, hasMore);
    return [...list];
  }

  /**
   * 采纳消息面并触发投影通知（销毁后跳过状态更新——缓存已照常写）。
   *
   * 引用稳定守卫：内容未变（长度一致且元素逐一同一引用）时保持原数组
   * 引用——messages 引用稳定是消费方 webview memo 比较成立的必要条件，
   * 事件到达但内容未变的重建（如缓存命中的重复采纳）会打穿 memo 使隐藏
   * webview 被记脏。hasMore 标志仍照常收口；两者均未变时不再触发通知。
   */
  private applyMessages(
    messages: readonly ChatMessage[],
    hasMore: boolean,
  ): void {
    if (this.destroyed) {
      return;
    }
    const unchanged =
      this.messagesValue.length === messages.length &&
      this.messagesValue.every((message, index) => message === messages[index]);
    if (!unchanged) {
      this.messagesValue = [...messages];
    }
    if (unchanged && this.hasMoreMessagesValue === hasMore) {
      return;
    }
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
      this.textTokenEstimator?.push(text);
    } else {
      this.metricsAcc.thinkingChars += text.length;
      this.thinkingTokenEstimator?.push(text);
    }
    // token 估算（stream-metrics-native ①②）：每个 delta 归账后重算
    // `基线 + 增量估算`。注入估算器时增量来自尾窗真 BPE 计数（正文/思考各
    // 一条）；未注入时是旧启发式 `ceil(累计字符 / 3.35)`（基线为 0 时与既有
    // 行为严格一致）。usage 真值成为基线后增量继续叠加——数字持续增长，
    // 不再停在上一条 usage 的累计值上（多步 run 冻结缺陷的修复点）。
    this.recomputeCompletionTokens();
    this.sampleRate();
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
        this.partialTextSegments.push(seg.delta);
        this.partialTextDirty = true;
      } else {
        this.partialThinkingSegments.push(seg.delta);
        this.partialThinkingDirty = true;
      }
    }
    this.pushStreamPayload({type: 'stream-batch', segments});
    this.onProjectionChanged?.();
  }

  /**
   * 物化本 step 的正文 partial（读取处 join 一次；未置脏直接回缓存）。
   * 读频受 apply 节拍约束：置脏发生在 applyStreamSegments（64ms），之后
   * 同一节拍内的任意多次读取（快照/注入/写通载荷）共享同一次 join。
   */
  private materializePartialText(): string {
    if (this.partialTextDirty) {
      this.partialTextCache = this.partialTextSegments.join('');
      this.partialTextDirty = false;
    }
    return this.partialTextCache;
  }

  /** 物化本 step 的思考 partial（语义同 {@link materializePartialText}）。 */
  private materializePartialThinking(): string {
    if (this.partialThinkingDirty) {
      this.partialThinkingCache = this.partialThinkingSegments.join('');
      this.partialThinkingDirty = false;
    }
    return this.partialThinkingCache;
  }

  /** 清零两段 partial（step 边界）：分段与缓存一起复位。 */
  private resetPartial(): void {
    this.partialTextSegments = [];
    this.partialThinkingSegments = [];
    this.partialTextCache = '';
    this.partialThinkingCache = '';
    this.partialTextDirty = false;
    this.partialThinkingDirty = false;
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
    const text = this.materializePartialText();
    const thinking = this.materializePartialThinking();
    if (text.length === 0 && thinking.length === 0) {
      return;
    }
    this.injectedValue = true;
    if (text.length > 0) {
      this.emitStreamPayload(handle, {
        type: 'stream-delta',
        kind: 'text',
        delta: text,
      });
    }
    if (thinking.length > 0) {
      this.emitStreamPayload(handle, {
        type: 'stream-delta',
        kind: 'thinking',
        delta: thinking,
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
