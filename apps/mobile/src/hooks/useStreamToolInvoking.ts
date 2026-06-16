/**
 * 检测 stream tail 是否应显示「工具调用中」。
 * 条件：agent 运行中 + 有过 thinking + 无 text + thinking 空闲 ≥300ms。
 */
import {useCallback, useEffect, useRef, useState} from 'react';

const DEFAULT_IDLE_MS = 300;

/** 纯函数判定，供单测与 hook 共用。 */
export function computeToolInvoking(input: {
  agentRunning: boolean;
  thinkingContent: string;
  textContent: string;
  msSinceLastThinkingDelta: number;
  idleThresholdMs?: number;
}): boolean {
  const threshold = input.idleThresholdMs ?? DEFAULT_IDLE_MS;
  if (!input.agentRunning) {
    return false;
  }
  if (input.thinkingContent.length === 0) {
    return false;
  }
  if (input.textContent.length > 0) {
    return false;
  }
  return input.msSinceLastThinkingDelta >= threshold;
}

function readToolInvoking(
  agentRunning: boolean,
  textRef: {current: string},
  thinkingRef: {current: string},
  lastThinkingAtRef: {current: number},
): boolean {
  const msSinceLastThinking =
    lastThinkingAtRef.current > 0
      ? Date.now() - lastThinkingAtRef.current
      : Number.POSITIVE_INFINITY;
  return computeToolInvoking({
    agentRunning,
    thinkingContent: thinkingRef.current,
    textContent: textRef.current,
    msSinceLastThinkingDelta: msSinceLastThinking,
  });
}

export function useStreamToolInvoking(agentRunning: boolean): {
  readonly toolInvoking: boolean;
  readonly noteTextDelta: (delta: string) => void;
  readonly noteThinkingDelta: (delta: string) => void;
  readonly reset: () => void;
} {
  const textRef = useRef('');
  const thinkingRef = useRef('');
  const lastThinkingAtRef = useRef(0);
  const [toolInvoking, setToolInvoking] = useState(false);

  const reset = useCallback(() => {
    textRef.current = '';
    thinkingRef.current = '';
    lastThinkingAtRef.current = 0;
    setToolInvoking(false);
  }, []);

  useEffect(() => {
    if (!agentRunning) {
      reset();
      return undefined;
    }
    textRef.current = '';
    thinkingRef.current = '';
    lastThinkingAtRef.current = 0;
    setToolInvoking(false);
    const id = setInterval(() => {
      if (thinkingRef.current.length === 0 || textRef.current.length > 0) {
        setToolInvoking(prev => (prev ? false : prev));
        return;
      }
      const next = readToolInvoking(
        true,
        textRef,
        thinkingRef,
        lastThinkingAtRef,
      );
      setToolInvoking(prev => {
        if (prev === next) {
          return prev;
        }
        return next;
      });
    }, DEFAULT_IDLE_MS);
    return () => clearInterval(id);
  }, [agentRunning, reset]);

  const noteTextDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    textRef.current += delta;
    setToolInvoking(prev => {
      if (!prev) {
        return prev;
      }
      return readToolInvoking(true, textRef, thinkingRef, lastThinkingAtRef);
    });
  }, []);

  const noteThinkingDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    thinkingRef.current += delta;
    lastThinkingAtRef.current = Date.now();
    setToolInvoking(prev => {
      if (!prev) {
        return prev;
      }
      return readToolInvoking(true, textRef, thinkingRef, lastThinkingAtRef);
    });
  }, []);

  return {toolInvoking, noteTextDelta, noteThinkingDelta, reset};
}
