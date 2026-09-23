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
  formatCharCount,
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
): AgentStreamMetricsView {
  return { ...snap, running };
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
 * `tokensPerSecond` 可选——组件侧采样喂入；缺省（含冻结态）省略速率段。
 */
export function buildAgentStreamMetricsLabel(
  metrics: AgentStreamMetricsView & { readonly tokensPerSecond?: number | null },
): string {
  return buildStreamMetricsLine({
    running: metrics.running,
    elapsedMs: metrics.elapsedMs,
    completionTokens: metrics.completionTokens,
    tokensPerSecond: metrics.tokensPerSecond ?? null,
  });
}

/** 运行中 live 统计；结束后保留「上次生成」直至下一轮。 */
export function useAgentStreamMetrics(running: boolean): {
  readonly metrics: AgentStreamMetricsView | null;
  readonly noteTextDelta: (delta: string) => void;
  readonly noteThinkingDelta: (delta: string) => void;
  readonly noteUsage: (completionTokens: number) => void;
} {
  const accRef = useRef<MetricsAcc>(emptyAcc());
  const [lastRun, setLastRun] = useState<AgentStreamMetricsSnapshot | null>(
    null,
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (running) {
      accRef.current = { ...emptyAcc(), startedAtMs: Date.now() };
      setLastRun(null);
      const id = setInterval(() => setTick((t) => t + 1), 250);
      return () => clearInterval(id);
    }
    const acc = accRef.current;
    if (acc.startedAtMs > 0) {
      setLastRun(
        snapshotFromAcc(acc, Math.max(0, Date.now() - acc.startedAtMs)),
      );
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
  }, []);

  const noteUsage = useCallback((completionTokens: number) => {
    if (!Number.isFinite(completionTokens) || completionTokens < 0) {
      return;
    }
    const acc = accRef.current;
    acc.completionTokens = completionTokens;
    acc.tokenSource = "usage";
  }, []);

  void tick;

  let metrics: AgentStreamMetricsView | null = null;
  if (running && accRef.current.startedAtMs > 0) {
    const elapsedMs = Math.max(0, Date.now() - accRef.current.startedAtMs);
    metrics = toView(
      true,
      snapshotFromAcc(accRef.current, elapsedMs),
    );
  } else if (lastRun != null) {
    metrics = toView(false, lastRun);
  }

  return { metrics, noteTextDelta, noteThinkingDelta, noteUsage };
}
