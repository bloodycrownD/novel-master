/**
 * Stream tail「生成中」：uiRunning 且距上次 text/thinking delta 空闲 ≥300ms。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeStreamTailGenerating,
  DEFAULT_STREAM_TAIL_IDLE_MS,
} from '@novel-master/core/chat';

export type StreamTailGenerating = {
  readonly streamTailGenerating: boolean;
  /** 仅 text/thinking delta 时调用。 */
  noteStreamDelta(): void;
  resetStreamClock(): void;
};

export function useStreamTailGenerating(
  uiRunning: boolean,
): StreamTailGenerating {
  const lastDeltaAtRef = useRef(0);
  const [streamTailGenerating, setStreamTailGenerating] = useState(false);

  const resetStreamClock = useCallback(() => {
    lastDeltaAtRef.current = 0;
    setStreamTailGenerating(false);
  }, []);

  const noteStreamDelta = useCallback(() => {
    lastDeltaAtRef.current = Date.now();
    setStreamTailGenerating(false);
  }, []);

  useEffect(() => {
    if (!uiRunning) {
      resetStreamClock();
      return undefined;
    }
    lastDeltaAtRef.current = 0;
    setStreamTailGenerating(false);
    const id = setInterval(() => {
      const msSinceLastStreamDelta =
        lastDeltaAtRef.current > 0
          ? Date.now() - lastDeltaAtRef.current
          : Number.POSITIVE_INFINITY;
      const next = computeStreamTailGenerating({
        uiRunning: true,
        msSinceLastStreamDelta,
        idleThresholdMs: DEFAULT_STREAM_TAIL_IDLE_MS,
      });
      setStreamTailGenerating(prev => (prev === next ? prev : next));
    }, DEFAULT_STREAM_TAIL_IDLE_MS);
    return () => clearInterval(id);
  }, [uiRunning, resetStreamClock]);

  return { streamTailGenerating, noteStreamDelta, resetStreamClock };
}
