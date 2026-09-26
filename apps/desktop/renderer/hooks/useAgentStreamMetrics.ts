/**
 * Agent 流式生成计时与输出 token 统计（不含 tool 参数计数）。
 *
 * token 口径（stream-metrics-tokens，与 mobile unit 语义一致）：
 * - heuristic 兜底：按**累计**字符长度取 ceil 折算（ceil(totalChars /
 *   CHARACTERS_PER_TOKEN_RATIO)，与 HeuristicTokenCounter.countText 单次
 *   全量计数严格一致）；
 * - usage 校正：run 级累计真值（EVENT_AGENT_STREAM_USAGE 经 useAgentStream
 *   的 ~250ms 尾随节流到达）覆盖 heuristic、source 翻转为 usage——此后
 *   heuristic 不再回写（真值优先）。openai 流中零事件段由 heuristic 撑
 *   显示，step done 补发的终值到达时跳正。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildStreamMetricsLine,
  createTokenRateSampler,
  formatCharCount,
  type TokenRateSampler,
} from "@shared/logic/format";
import { CHARACTERS_PER_TOKEN_RATIO } from "@novel-master/core/provider";

export { formatCharCount };

/** token 计数来源：usage=事件真值（run 级累计）；heuristic=字符折算兜底。 */
export type AgentStreamTokenSource = "usage" | "heuristic";

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
  startedAtMs: number;
};

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
    startedAtMs: 0,
  };
}

/** heuristic 折算：对累计字符长度取 ceil（全量计数口径）。 */
function heuristicTokens(totalChars: number): number {
  return Math.ceil(totalChars / CHARACTERS_PER_TOKEN_RATIO);
}

/** 格式化秒数（60s 内一位小数，否则整数）。 */
export function formatStreamElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
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

/** 运行中 live 统计；结束后保留「上次生成」直至下一轮。 */
export function useAgentStreamMetrics(running: boolean): {
  readonly metrics: AgentStreamMetricsView | null;
  readonly noteTextDelta: (delta: string) => void;
  readonly noteThinkingDelta: (delta: string) => void;
  readonly noteUsage: (completionTokens: number) => void;
} {
  const accRef = useRef<MetricsAcc>(emptyAcc());
  /**
   * 速率采样序列（core 共用采样器）：token 变化才记样本，heuristic→usage
   * 校正点重 seed（翻转前末值留作 freeze 回落）。序列由本 hook 持有——
   * live 与冻结读同一份，冻结值 = 收尾时的末值快照（窗口以最后样本时刻
   * 收尾，停顿不拉低；无样本则省略速率段）。
   */
  const rateSamplerRef = useRef<TokenRateSampler>(createTokenRateSampler());
  const [lastRun, setLastRun] = useState<LastRunSnapshot | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (running) {
      accRef.current = { ...emptyAcc(), startedAtMs: Date.now() };
      // 新 run：采样序列重 seed（防跨 run 差分污染首个窗口）。
      rateSamplerRef.current.reset();
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
        tokensPerSecond: rateSamplerRef.current.freeze(),
      });
      accRef.current = emptyAcc();
    }
    return undefined;
  }, [running]);

  const noteTextDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    const acc = accRef.current;
    acc.textChars += delta.length;
    if (acc.tokenSource === "heuristic") {
      acc.completionTokens = heuristicTokens(
        acc.textChars + acc.thinkingChars,
      );
    }
    rateSamplerRef.current.sample(
      acc.completionTokens,
      acc.tokenSource,
      Date.now(),
    );
  }, []);

  const noteThinkingDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    const acc = accRef.current;
    acc.thinkingChars += delta.length;
    if (acc.tokenSource === "heuristic") {
      acc.completionTokens = heuristicTokens(
        acc.textChars + acc.thinkingChars,
      );
    }
    rateSamplerRef.current.sample(
      acc.completionTokens,
      acc.tokenSource,
      Date.now(),
    );
  }, []);

  const noteUsage = useCallback((completionTokens: number) => {
    if (!Number.isFinite(completionTokens) || completionTokens < 0) {
      return;
    }
    const acc = accRef.current;
    acc.completionTokens = completionTokens;
    acc.tokenSource = "usage";
    rateSamplerRef.current.sample(
      acc.completionTokens,
      acc.tokenSource,
      Date.now(),
    );
  }, []);

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
