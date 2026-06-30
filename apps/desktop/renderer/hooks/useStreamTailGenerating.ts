/**
 * Stream tail「生成中」：uiRunning 且距上次 text/thinking delta 空闲 ≥300ms。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeStreamTailGenerating,
  DEFAULT_STREAM_TAIL_IDLE_MS,
} from "@novel-master/core/chat";

export type StreamTailGenerating = {
  readonly streamTailGenerating: boolean;
  /** 仅 text/thinking delta 调用 */
  noteStreamDelta(): void;
  resetStreamClock(): void;
};

export function useStreamTailGenerating(
  uiRunning: boolean,
): StreamTailGenerating {
  const lastDeltaAtRef = useRef(0);
  const [tick, setTick] = useState(0);

  const resetStreamClock = useCallback(() => {
    lastDeltaAtRef.current = 0;
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!uiRunning) {
      lastDeltaAtRef.current = 0;
      return undefined;
    }
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [uiRunning]);

  const noteStreamDelta = useCallback(() => {
    lastDeltaAtRef.current = Date.now();
  }, []);

  void tick;

  const msSinceLastStreamDelta =
    lastDeltaAtRef.current > 0
      ? Date.now() - lastDeltaAtRef.current
      : Number.POSITIVE_INFINITY;

  const streamTailGenerating = computeStreamTailGenerating({
    uiRunning,
    msSinceLastStreamDelta,
    idleThresholdMs: DEFAULT_STREAM_TAIL_IDLE_MS,
  });

  return { streamTailGenerating, noteStreamDelta, resetStreamClock };
}
