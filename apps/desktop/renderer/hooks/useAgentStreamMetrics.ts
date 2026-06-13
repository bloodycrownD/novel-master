/**
 * 单次 Agent run 的耗时与流式字数统计。
 * {@link flushRunUi} 清空流式 overlay 后，计数保留至下次 run 开始。
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type AgentStreamKind = "text" | "tool" | "mixed";

export type AgentStreamMetricsSnapshot = {
  readonly elapsedMs: number;
  readonly textChars: number;
  readonly thinkingChars: number;
  readonly toolUseChars: number;
};

export type AgentStreamMetricsView = AgentStreamMetricsSnapshot & {
  readonly running: boolean;
  readonly totalChars: number;
  readonly charsPerSecond: number;
  readonly streamKind: AgentStreamKind;
};

type MetricsAcc = {
  textChars: number;
  thinkingChars: number;
  toolUseChars: number;
  startedAtMs: number;
};

function computeStreamKind(acc: MetricsAcc): AgentStreamKind {
  const hasText = acc.textChars > 0 || acc.thinkingChars > 0;
  const hasTool = acc.toolUseChars > 0;
  if (hasText && hasTool) {
    return "mixed";
  }
  if (hasTool) {
    return "tool";
  }
  return "text";
}

function snapshotFromAcc(acc: MetricsAcc, elapsedMs: number): AgentStreamMetricsSnapshot {
  return {
    elapsedMs,
    textChars: acc.textChars,
    thinkingChars: acc.thinkingChars,
    toolUseChars: acc.toolUseChars,
  };
}

function toView(
  running: boolean,
  snap: AgentStreamMetricsSnapshot,
): AgentStreamMetricsView {
  const totalChars = snap.textChars + snap.thinkingChars + snap.toolUseChars;
  const secs = snap.elapsedMs / 1000;
  const charsPerSecond = secs > 0 ? totalChars / secs : 0;
  const streamKind = computeStreamKind({
    textChars: snap.textChars,
    thinkingChars: snap.thinkingChars,
    toolUseChars: snap.toolUseChars,
    startedAtMs: 0,
  });
  return { ...snap, running, totalChars, charsPerSecond, streamKind };
}

/** meta 条秒数格式（60s 内一位小数，否则取整）。 */
export function formatStreamElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

/** 紧凑 locale 整数格式（字数）。 */
export function formatCharCount(n: number): string {
  return n.toLocaleString("zh-CN");
}

/**
 * `running` 时实时 metrics；run 结束后冻结为 {@link lastRun}，直至下次 run。
 */
export function useAgentStreamMetrics(running: boolean): {
  readonly metrics: AgentStreamMetricsView | null;
  readonly noteTextDelta: (delta: string) => void;
  readonly noteThinkingDelta: (delta: string) => void;
  readonly noteToolUseDelta: (delta: string) => void;
  /** assistant 落库后冻结为「上次生成」，run 仍进行时由阶段条承担执行期展示。 */
  readonly freezeToLastRun: () => void;
} {
  const accRef = useRef<MetricsAcc>({
    textChars: 0,
    thinkingChars: 0,
    toolUseChars: 0,
    startedAtMs: 0,
  });
  const frozenRef = useRef(false);
  const [lastRun, setLastRun] = useState<AgentStreamMetricsSnapshot | null>(
    null,
  );
  const [tick, setTick] = useState(0);

  const resumeLiveIfFrozen = useCallback(() => {
    if (!frozenRef.current || !running) {
      return;
    }
    frozenRef.current = false;
    accRef.current = {
      textChars: 0,
      thinkingChars: 0,
      toolUseChars: 0,
      startedAtMs: Date.now(),
    };
    setLastRun(null);
    setTick((t) => t + 1);
  }, [running]);

  useEffect(() => {
    if (running) {
      accRef.current = {
        textChars: 0,
        thinkingChars: 0,
        toolUseChars: 0,
        startedAtMs: Date.now(),
      };
      frozenRef.current = false;
      setLastRun(null);
      const id = setInterval(() => setTick((t) => t + 1), 250);
      return () => clearInterval(id);
    }
    const acc = accRef.current;
    if (acc.startedAtMs > 0) {
      setLastRun(
        snapshotFromAcc(acc, Math.max(0, Date.now() - acc.startedAtMs)),
      );
      accRef.current = {
        textChars: 0,
        thinkingChars: 0,
        toolUseChars: 0,
        startedAtMs: 0,
      };
    }
    return undefined;
  }, [running]);

  const freezeToLastRun = useCallback(() => {
    const acc = accRef.current;
    if (acc.startedAtMs <= 0) {
      return;
    }
    setLastRun(
      snapshotFromAcc(acc, Math.max(0, Date.now() - acc.startedAtMs)),
    );
    frozenRef.current = true;
    accRef.current = {
      textChars: 0,
      thinkingChars: 0,
      toolUseChars: 0,
      startedAtMs: 0,
    };
    setTick((t) => t + 1);
  }, []);

  const noteTextDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    resumeLiveIfFrozen();
    accRef.current.textChars += delta.length;
  }, [resumeLiveIfFrozen]);

  const noteThinkingDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    resumeLiveIfFrozen();
    accRef.current.thinkingChars += delta.length;
  }, [resumeLiveIfFrozen]);

  const noteToolUseDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    resumeLiveIfFrozen();
    accRef.current.toolUseChars += delta.length;
  }, [resumeLiveIfFrozen]);

  void tick;

  let metrics: AgentStreamMetricsView | null = null;
  if (frozenRef.current && lastRun != null) {
    metrics = toView(false, lastRun);
  } else if (running && accRef.current.startedAtMs > 0) {
    const elapsedMs = Math.max(0, Date.now() - accRef.current.startedAtMs);
    metrics = toView(true, snapshotFromAcc(accRef.current, elapsedMs));
  } else if (lastRun != null) {
    metrics = toView(false, lastRun);
  }

  return {
    metrics,
    noteTextDelta,
    noteThinkingDelta,
    noteToolUseDelta,
    freezeToLastRun,
  };
}
