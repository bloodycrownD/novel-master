/**
 * Tracks elapsed time and streamed character counts for one agent run.
 * Counts survive {@link flushRunUi} stream overlay clears until the next run starts.
 */
import {useCallback, useEffect, useRef, useState} from 'react';

export type AgentStreamKind = 'text' | 'tool' | 'mixed';

export type AgentStreamMetricsSnapshot = {
  readonly elapsedMs: number;
  readonly textChars: number;
  readonly thinkingChars: number;
  readonly toolUseChars: number;
  readonly streamKind: AgentStreamKind;
};

export type AgentStreamMetricsView = AgentStreamMetricsSnapshot & {
  readonly running: boolean;
  readonly totalChars: number;
  readonly charsPerSecond: number;
};

type MetricsAcc = {
  textChars: number;
  thinkingChars: number;
  toolUseChars: number;
  startedAtMs: number;
};

/** 根据各通道累计字数判定 metrics 条展示模式。 */
export function computeStreamKind(chars: {
  textChars: number;
  thinkingChars: number;
  toolUseChars: number;
}): AgentStreamKind {
  const hasContent = chars.textChars > 0 || chars.thinkingChars > 0;
  const hasTool = chars.toolUseChars > 0;
  if (hasContent && hasTool) {
    return 'mixed';
  }
  if (hasTool) {
    return 'tool';
  }
  return 'text';
}

function snapshotFromAcc(acc: MetricsAcc, elapsedMs: number): AgentStreamMetricsSnapshot {
  return {
    elapsedMs,
    textChars: acc.textChars,
    thinkingChars: acc.thinkingChars,
    toolUseChars: acc.toolUseChars,
    streamKind: computeStreamKind(acc),
  };
}

function toView(
  running: boolean,
  snap: AgentStreamMetricsSnapshot,
): AgentStreamMetricsView {
  const totalChars = snap.textChars + snap.thinkingChars + snap.toolUseChars;
  const secs = snap.elapsedMs / 1000;
  const charsPerSecond = secs > 0 ? totalChars / secs : 0;
  return {...snap, running, totalChars, charsPerSecond};
}

function emptyAcc(): MetricsAcc {
  return {textChars: 0, thinkingChars: 0, toolUseChars: 0, startedAtMs: 0};
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
  readonly noteToolUseDelta: (delta: string) => void;
} {
  const accRef = useRef<MetricsAcc>(emptyAcc());
  const [lastRun, setLastRun] = useState<AgentStreamMetricsSnapshot | null>(
    null,
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (running) {
      accRef.current = {...emptyAcc(), startedAtMs: Date.now()};
      setLastRun(null);
      const id = setInterval(() => setTick(t => t + 1), 250);
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
    accRef.current.textChars += delta.length;
    // WHY: metrics bar refreshes via 250ms interval — per-delta setTick re-rendered ChatTabScreen on every SSE token.
  }, []);

  const noteThinkingDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    accRef.current.thinkingChars += delta.length;
  }, []);

  const noteToolUseDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    accRef.current.toolUseChars += delta.length;
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

  return {metrics, noteTextDelta, noteThinkingDelta, noteToolUseDelta};
}
