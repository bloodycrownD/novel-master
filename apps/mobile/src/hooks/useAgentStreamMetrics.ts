/**
 * Agent 流式生成计时与正文字数统计（不含 tool 参数计数）。
 */
import {useCallback, useEffect, useRef, useState, type MutableRefObject} from 'react';

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

type MetricsAcc = {
  textChars: number;
  thinkingChars: number;
  startedAtMs: number;
};

export type StreamMetricsAccRef = MutableRefObject<MetricsAcc>;

export function emptyMetricsAcc(): MetricsAcc {
  return {textChars: 0, thinkingChars: 0, startedAtMs: 0};
}

export function snapshotMetricsAcc(
  acc: MetricsAcc,
  elapsedMs: number,
): AgentStreamMetricsSnapshot {
  return {
    elapsedMs,
    textChars: acc.textChars,
    thinkingChars: acc.thinkingChars,
  };
}

export function toAgentStreamMetricsView(
  running: boolean,
  snap: AgentStreamMetricsSnapshot,
): AgentStreamMetricsView {
  const totalChars = snap.textChars + snap.thinkingChars;
  const secs = snap.elapsedMs / 1000;
  const charsPerSecond = secs > 0 ? totalChars / secs : 0;
  return {...snap, running, totalChars, charsPerSecond};
}

/** Acc + notifiers only; display tick lives in ChatStreamMetricsBarLive. */
export function useStreamMetricsAcc(running: boolean): {
  readonly accRef: StreamMetricsAccRef;
  readonly lastRun: AgentStreamMetricsSnapshot | null;
  readonly noteTextDelta: (delta: string) => void;
  readonly noteThinkingDelta: (delta: string) => void;
} {
  const accRef = useRef<MetricsAcc>(emptyMetricsAcc());
  const [lastRun, setLastRun] = useState<AgentStreamMetricsSnapshot | null>(
    null,
  );

  useEffect(() => {
    if (running) {
      accRef.current = {...emptyMetricsAcc(), startedAtMs: Date.now()};
      setLastRun(null);
      return undefined;
    }
    const acc = accRef.current;
    if (acc.startedAtMs > 0) {
      setLastRun(
        snapshotMetricsAcc(acc, Math.max(0, Date.now() - acc.startedAtMs)),
      );
      accRef.current = emptyMetricsAcc();
    }
    return undefined;
  }, [running]);

  const noteTextDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    accRef.current.textChars += delta.length;
  }, []);

  const noteThinkingDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    accRef.current.thinkingChars += delta.length;
  }, []);

  return {accRef, lastRun, noteTextDelta, noteThinkingDelta};
}

function snapshotFromAcc(
  acc: MetricsAcc,
  elapsedMs: number,
): AgentStreamMetricsSnapshot {
  return snapshotMetricsAcc(acc, elapsedMs);
}

function toView(
  running: boolean,
  snap: AgentStreamMetricsSnapshot,
): AgentStreamMetricsView {
  return toAgentStreamMetricsView(running, snap);
}

function emptyAcc(): MetricsAcc {
  return emptyMetricsAcc();
}

/** 格式化秒数（60s 内一位小数，否则整数）。 */
export function formatStreamElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

/** 紧凑 locale 整数（字数）。 */
export function formatCharCount(n: number): string {
  return n.toLocaleString('zh-CN');
}

/** 构建 metrics 条文案（供 ChatStreamMetricsBar 与单测共用）。 */
export function buildChatStreamMetricsLine(
  metrics: AgentStreamMetricsView,
): string {
  const elapsedSec = metrics.elapsedMs / 1000;
  const elapsedLabel = formatStreamElapsed(elapsedSec);
  const rate =
    metrics.charsPerSecond >= 10
      ? Math.round(metrics.charsPerSecond)
      : Math.round(metrics.charsPerSecond * 10) / 10;

  const prefix = metrics.running ? '生成中' : '上次生成';
  const parts: string[] = [
    `${prefix} · ${elapsedLabel}`,
    `正文 ${formatCharCount(metrics.textChars)} 字`,
  ];
  if (metrics.thinkingChars > 0) {
    parts.push(`思考 ${formatCharCount(metrics.thinkingChars)} 字`);
  }
  if (metrics.totalChars > 0 && elapsedSec > 0) {
    parts.push(`${rate} 字/秒`);
  }
  return parts.join(' · ');
}

/** 运行中 live 统计；结束后保留「上次生成」直至下一轮。 */
export function useAgentStreamMetrics(running: boolean): {
  readonly metrics: AgentStreamMetricsView | null;
  readonly noteTextDelta: (delta: string) => void;
  readonly noteThinkingDelta: (delta: string) => void;
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
      const id = setInterval(() => {
        setTick(t => t + 1);
      }, 250);
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
  }, []);

  const noteThinkingDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    accRef.current.thinkingChars += delta.length;
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

  return {metrics, noteTextDelta, noteThinkingDelta};
}
