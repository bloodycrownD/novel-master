/**
 * Tracks elapsed time and streamed character counts for one agent run.
 * Counts survive {@link flushRunUi} stream overlay clears until the next run starts.
 */
import {useCallback, useEffect, useRef, useState} from 'react';

export type AgentStreamMetricsSnapshot = {
  readonly elapsedMs: number;
  readonly textChars: number;
  readonly thinkingChars: number;
};

export type AgentStreamMetricsView = AgentStreamMetricsSnapshot & {
  readonly running: boolean;
  readonly totalChars: number;
  readonly charsPerSecond: number;
};

function snapshotFromAcc(
  acc: {textChars: number; thinkingChars: number; startedAtMs: number},
  elapsedMs: number,
): AgentStreamMetricsSnapshot {
  return {
    elapsedMs,
    textChars: acc.textChars,
    thinkingChars: acc.thinkingChars,
  };
}

function toView(
  running: boolean,
  snap: AgentStreamMetricsSnapshot,
): AgentStreamMetricsView {
  const totalChars = snap.textChars + snap.thinkingChars;
  const secs = snap.elapsedMs / 1000;
  const charsPerSecond = secs > 0 ? totalChars / secs : 0;
  return {...snap, running, totalChars, charsPerSecond};
}

/** Format seconds for the meta bar (one decimal under 60s, else integer). */
export function formatStreamElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

/** Compact locale-aware integer for character counts. */
export function formatCharCount(n: number): string {
  return n.toLocaleString('zh-CN');
}

/**
 * Live metrics while `running`; frozen {@link lastRun} after the run ends until the next one.
 */
export function useAgentStreamMetrics(running: boolean): {
  readonly metrics: AgentStreamMetricsView | null;
  readonly noteTextDelta: (delta: string) => void;
  readonly noteThinkingDelta: (delta: string) => void;
} {
  const accRef = useRef({
    textChars: 0,
    thinkingChars: 0,
    startedAtMs: 0,
  });
  const [lastRun, setLastRun] = useState<AgentStreamMetricsSnapshot | null>(
    null,
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (running) {
      accRef.current = {textChars: 0, thinkingChars: 0, startedAtMs: Date.now()};
      setLastRun(null);
      const id = setInterval(() => setTick(t => t + 1), 250);
      return () => clearInterval(id);
    }
    const acc = accRef.current;
    if (acc.startedAtMs > 0) {
      setLastRun(
        snapshotFromAcc(acc, Math.max(0, Date.now() - acc.startedAtMs)),
      );
      accRef.current = {textChars: 0, thinkingChars: 0, startedAtMs: 0};
    }
    return undefined;
  }, [running]);

  const noteTextDelta = useCallback(
    (delta: string) => {
      if (delta.length === 0) {
        return;
      }
      accRef.current.textChars += delta.length;
      if (running) {
        setTick(t => t + 1);
      }
    },
    [running],
  );

  const noteThinkingDelta = useCallback(
    (delta: string) => {
      if (delta.length === 0) {
        return;
      }
      accRef.current.thinkingChars += delta.length;
      if (running) {
        setTick(t => t + 1);
      }
    },
    [running],
  );

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

  return {metrics, noteTextDelta, noteThinkingDelta};
}
