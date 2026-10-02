/**
 * Agent 流式生成计时与输出 token 统计（不含 tool 参数计数）。
 *
 * token 口径（stream-metrics-tokens / stream-metrics-native ①，与 mobile unit
 * 语义一致）：
 * - 读值 = `max(0, 基线 + 增量估算)`；未收到 usage 时基线为 0，退化成纯估算
 *   （未注入 token 估算器时即 `ceil(totalChars / CHARACTERS_PER_TOKEN_RATIO)`，
 *   与 HeuristicTokenCounter.countText 单次全量计数严格一致）；
 * - usage 校正：run 级累计真值（EVENT_AGENT_STREAM_USAGE 经 useAgentStream
 *   的 ~250ms 尾随节流到达）到达时把真值设为**基线**（`base = 真值 − 当前
 *   增量估算`）、source 翻转为 usage——此后每个 delta 的增量继续叠在真值上，
 *   数字单调增长（多步 run 的第二步文本流不再冻结在上一 step 的真值上）。
 *   openai 流中零事件段由估算撑显示，step done 补发的终值到达时重锚校正，
 *   节流在途的 pending 由 useAgentStream 在 RUN_FINISHED / RUN_FAILED 前同步
 *   冲刷，收尾冻结读到的即校正当刻的读值。
 * - 可选注入 token 估算器（②）：注入后增量估算升级为真 BPE 尾窗计数
 *   （正文/思考各一条），不注入保持启发式——**未收到 usage 前**与旧口径严格
 *   一致；usage 到达后按 ①「基线 + 增量」口径。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildStreamMetricsLine,
  composeStreamTokens,
  createTokenRateSampler,
  reanchorStreamTokenBase,
  type IncrementalTokenCounter,
  type StreamTokenSource,
  type TokenRateSampler,
} from "@shared/logic/format";
import { CHARACTERS_PER_TOKEN_RATIO } from "@shared/logic/provider";

/**
 * token 计数来源：usage=基线来自事件真值（run 级累计）；heuristic=尚无真值，
 * 读值完全由估算给出。取值口径复用 core 的中立类型（`StreamTokenSource`，与
 * session_run_state 行模型同一份声明），不再本地重写字面量联合（C-3）。
 */
export type AgentStreamTokenSource = StreamTokenSource;

/** 实时 token 估算器工厂（不注入 = 启发式；返回 null = 回退启发式）。 */
export type AgentStreamEstimatorFactory = () =>
  | IncrementalTokenCounter
  | null;

export type AgentStreamMetricsSnapshot = {
  readonly elapsedMs: number;
  readonly textChars: number;
  readonly thinkingChars: number;
  readonly completionTokens: number;
  readonly tokenSource: AgentStreamTokenSource;
};

export type AgentStreamMetricsView = AgentStreamMetricsSnapshot & {
  readonly running: boolean;
  /** 速率（token/秒）：运行中为实时滑窗值；冻结态为收尾末值；null=省略速率段。 */
  readonly tokensPerSecond: number | null;
};

type MetricsAcc = {
  textChars: number;
  thinkingChars: number;
  completionTokens: number;
  tokenSource: AgentStreamTokenSource;
  /**
   * usage 基线（①）：`completionTokens = max(0, baseTokens + 增量估算)`。
   * 未收到 usage 时为 0；usage 到达时重锚为 `真值 − 当时的增量估算`。
   */
  baseTokens: number;
  startedAtMs: number;
};

/**
 * 估算器工厂失败的一次性告警标志（模块级，跨 run 累积）。
 *
 * 构造失败是「每次 run 都会再犯」的同一件事（编码表加载失败、运行环境缺
 * 依赖等），不设去重的话每个 run 都会刷一条同样的 warn。去重后只在首次留下
 * 信号——「桌面端指标条一直是启发式数字」这件事此前完全静默（mobile 侧同名
 * 分支有 `console.warn`，双端不对称），真机上零线索。
 */
let warnedEstimatorFactoryFailure = false;

function snapshotFromAcc(
  acc: MetricsAcc,
  elapsedMs: number,
): AgentStreamMetricsSnapshot {
  return {
    elapsedMs,
    textChars: acc.textChars,
    thinkingChars: acc.thinkingChars,
    completionTokens: acc.completionTokens,
    tokenSource: acc.tokenSource,
  };
}

function toView(
  running: boolean,
  snap: AgentStreamMetricsSnapshot,
  tokensPerSecond: number | null,
): AgentStreamMetricsView {
  return { ...snap, running, tokensPerSecond };
}

function emptyAcc(): MetricsAcc {
  return {
    textChars: 0,
    thinkingChars: 0,
    completionTokens: 0,
    tokenSource: "heuristic",
    baseTokens: 0,
    startedAtMs: 0,
  };
}

/** heuristic 折算：对累计字符长度取 ceil（全量计数口径）。 */
function heuristicTokens(totalChars: number): number {
  return Math.ceil(totalChars / CHARACTERS_PER_TOKEN_RATIO);
}

/**
 * 构建 metrics 条文案（供 AgentStreamMetricsBar 与单测共用）。
 *
 * `tokensPerSecond` 由 hook 的采样器给出（运行中=实时值、冻结态=末值）；
 * null（样本不足）时省略速率段。
 */
export function buildAgentStreamMetricsLabel(
  metrics: AgentStreamMetricsView,
): string {
  return buildStreamMetricsLine({
    running: metrics.running,
    elapsedMs: metrics.elapsedMs,
    completionTokens: metrics.completionTokens,
    tokensPerSecond: metrics.tokensPerSecond ?? null,
  });
}

/** 冻结的「上次生成」快照：末值速率随快照一起冻结（见下 running 翻假的收尾分支）。 */
type LastRunSnapshot = {
  readonly snapshot: AgentStreamMetricsSnapshot;
  readonly tokensPerSecond: number | null;
};

/**
 * 运行中 live 统计；结束后保留「上次生成」直至下一轮。
 *
 * `runKey` 是 run 身份（建议 `${sessionId}:${activeRunId}`）：同一会话连续
 * run 时 uiRunning 可能一路保持 true（上一次 RUN_FINISHED 被 stale 守卫拒绝、
 * abort 后立即重发等），只靠 running 边沿重置会让上一轮样本混进新窗口。
 * 身份变化与 running 上升沿一样触发重 seed（对齐 mobile unit 的 `begin()`
 * 先例）。缺省不传时退化为纯 running 边沿语义。
 *
 * `tokenEstimatorFactory`（可选，②）：给本 hook 注入实时 token 估算器
 * （真 BPE 尾窗计数）。**不注入 = 启发式**（`ceil(chars/3.35)`），**未收到 usage
 * 前**与旧口径严格一致；usage 到达后按 ①「基线 + 增量」口径。工厂返回 null
 * （如编码表构造失败）同样回退启发式。每个 run 起手建一套
 * （正文/思考各一条），与指标累积器同批重置。
 */
export function useAgentStreamMetrics(
  running: boolean,
  runKey?: string | null,
  tokenEstimatorFactory?: AgentStreamEstimatorFactory,
): {
  readonly metrics: AgentStreamMetricsView | null;
  readonly noteTextDelta: (delta: string) => void;
  readonly noteThinkingDelta: (delta: string) => void;
  readonly noteUsage: (completionTokens: number) => void;
} {
  const accRef = useRef<MetricsAcc>(emptyAcc());
  /** 工厂可能每次渲染换引用：用 ref 取最新值，避免 effect 依赖抖动。 */
  const estimatorFactoryRef = useRef(tokenEstimatorFactory);
  estimatorFactoryRef.current = tokenEstimatorFactory;
  /** 实时 token 估算器（正文/思考各一条；未注入/构造失败为 null）。 */
  const textEstimatorRef = useRef<IncrementalTokenCounter | null>(null);
  const thinkingEstimatorRef = useRef<IncrementalTokenCounter | null>(null);
  /**
   * 速率采样序列（core 共用采样器）：token 变化才记样本，校正点重 seed
   * （source 翻转与窗口折叠两种情形；翻转/折叠前末值留作 freeze 回落）。
   * 序列由本 hook 持有——live 与冻结读同一份，冻结值 = 收尾时的末值快照
   * （窗口以最后样本时刻收尾，停顿不拉低；无样本则省略速率段）。
   *
   * 惰性初始化：`useRef(createTokenRateSampler())` 每次渲染都会白建一个
   * 采样器再丢弃，改在首次渲染时按需建（ref 稳定，全生命周期复用）。
   */
  const rateSamplerRef = useRef<TokenRateSampler | null>(null);
  if (rateSamplerRef.current === null) {
    rateSamplerRef.current = createTokenRateSampler();
  }
  const rateSampler: TokenRateSampler = rateSamplerRef.current;
  const [lastRun, setLastRun] = useState<LastRunSnapshot | null>(null);
  const [tick, setTick] = useState(0);

  /** 当前增量估算（不含基线）：注入估算器时=正文+思考尾窗估算，否则启发式。 */
  const estimateIncrementTokens = useCallback((): number => {
    const text = textEstimatorRef.current;
    const thinking = thinkingEstimatorRef.current;
    if (text != null && thinking != null) {
      return text.tokens + thinking.tokens;
    }
    const acc = accRef.current;
    return heuristicTokens(acc.textChars + acc.thinkingChars);
  }, []);

  /** 重算 `completionTokens = max(0, 基线 + 增量估算)`（delta 归账后调用）。 */
  const recomputeCompletionTokens = useCallback((): void => {
    const acc = accRef.current;
    acc.completionTokens = composeStreamTokens(
      acc.baseTokens,
      estimateIncrementTokens(),
    );
  }, [estimateIncrementTokens]);

  useEffect(() => {
    if (running) {
      accRef.current = { ...emptyAcc(), startedAtMs: Date.now() };
      // 新 run：估算器与采样序列一起重 seed（防跨 run 差分污染首个窗口）。
      const factory = estimatorFactoryRef.current;
      let text: IncrementalTokenCounter | null = null;
      let thinking: IncrementalTokenCounter | null = null;
      if (factory != null) {
        try {
          const created = factory();
          const createdSecond = created == null ? null : factory();
          if (created != null && createdSecond != null) {
            text = created;
            thinking = createdSecond;
          }
        } catch (err) {
          // 估算器构造失败：回退启发式（不阻断指标条）。首次打一条中文告警
          // （与 mobile 侧 `getOrCreateEncoding` 失败分支对齐），后续同类失败
          // 静默——回退行为本身不变。
          if (!warnedEstimatorFactoryFailure) {
            warnedEstimatorFactoryFailure = true;
            console.warn(
              "[novel-master/use-agent-stream-metrics] 估算器构造失败，回退启发式（不阻断指标条）",
              err,
            );
          }
          text = null;
          thinking = null;
        }
      }
      textEstimatorRef.current = text;
      thinkingEstimatorRef.current = thinking;
      text?.reset();
      thinking?.reset();
      rateSampler.reset();
      setLastRun(null);
      const id = setInterval(() => setTick((t) => t + 1), 250);
      return () => clearInterval(id);
    }
    const acc = accRef.current;
    if (acc.startedAtMs > 0) {
      setLastRun({
        snapshot: snapshotFromAcc(
          acc,
          Math.max(0, Date.now() - acc.startedAtMs),
        ),
        tokensPerSecond: rateSampler.freeze(),
      });
      accRef.current = emptyAcc();
    }
    // 收尾后一并清掉采样序列：冻结值已随 lastRun 取出，序列不再留到下轮。
    rateSampler.reset();
    return undefined;
  }, [running, runKey, rateSampler]);

  const noteTextDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    const acc = accRef.current;
    acc.textChars += delta.length;
    textEstimatorRef.current?.push(delta);
    recomputeCompletionTokens();
    rateSampler.sample(
      acc.completionTokens,
      acc.tokenSource,
      Date.now(),
    );
  }, [rateSampler, recomputeCompletionTokens]);

  const noteThinkingDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    const acc = accRef.current;
    acc.thinkingChars += delta.length;
    thinkingEstimatorRef.current?.push(delta);
    recomputeCompletionTokens();
    rateSampler.sample(
      acc.completionTokens,
      acc.tokenSource,
      Date.now(),
    );
  }, [rateSampler, recomputeCompletionTokens]);

  const noteUsage = useCallback((completionTokens: number) => {
    if (!Number.isFinite(completionTokens) || completionTokens < 0) {
      return;
    }
    const acc = accRef.current;
    // 重锚基线：真值成为基线，后续 delta 的增量继续叠加（①）。
    acc.baseTokens = reanchorStreamTokenBase(
      completionTokens,
      estimateIncrementTokens(),
    );
    acc.completionTokens = Math.max(0, completionTokens);
    acc.tokenSource = "usage";
    rateSampler.sample(
      acc.completionTokens,
      acc.tokenSource,
      Date.now(),
    );
  }, [rateSampler, estimateIncrementTokens]);

  void tick;

  let metrics: AgentStreamMetricsView | null = null;
  if (running && accRef.current.startedAtMs > 0) {
    const elapsedMs = Math.max(0, Date.now() - accRef.current.startedAtMs);
    metrics = toView(
      true,
      snapshotFromAcc(accRef.current, elapsedMs),
      rateSamplerRef.current.rateAt(Date.now()),
    );
  } else if (lastRun != null) {
    metrics = toView(false, lastRun.snapshot, lastRun.tokensPerSecond);
  }

  return { metrics, noteTextDelta, noteThinkingDelta, noteUsage };
}
