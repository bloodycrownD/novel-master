/**
 * 检测 stream tail 是否应显示「工具调用中」。
 * 路径1：agent 运行中 + 有过 thinking + 无 text + thinking 空闲 ≥300ms。
 * 路径2：agent 运行中 + 有 text + text 空闲 ≥300ms（正文后等待 tool_call）。
 */
import {useCallback, useEffect, useRef, useState} from 'react';

const DEFAULT_IDLE_MS = 300;

/** 纯函数判定，供单测与 hook 共用。 */
export function computeToolInvoking(input: {
  agentRunning: boolean;
  thinkingContent: string;
  textContent: string;
  msSinceLastThinkingDelta: number;
  msSinceLastTextDelta?: number;
  idleThresholdMs?: number;
}): boolean {
  const threshold = input.idleThresholdMs ?? DEFAULT_IDLE_MS;
  if (!input.agentRunning) {
    return false;
  }
  const msSinceLastText =
    input.msSinceLastTextDelta ?? Number.POSITIVE_INFINITY;
  const thinkingPath =
    input.thinkingContent.length > 0 &&
    input.textContent.length === 0 &&
    input.msSinceLastThinkingDelta >= threshold;
  const postTextToolPendingPath =
    input.textContent.length > 0 && msSinceLastText >= threshold;
  return thinkingPath || postTextToolPendingPath;
}

function readToolInvoking(
  agentRunning: boolean,
  textRef: {current: string},
  thinkingRef: {current: string},
  lastThinkingAtRef: {current: number},
  lastTextAtRef: {current: number},
): boolean {
  const msSinceLastThinking =
    lastThinkingAtRef.current > 0
      ? Date.now() - lastThinkingAtRef.current
      : Number.POSITIVE_INFINITY;
  const msSinceLastText =
    lastTextAtRef.current > 0
      ? Date.now() - lastTextAtRef.current
      : Number.POSITIVE_INFINITY;
  return computeToolInvoking({
    agentRunning,
    thinkingContent: thinkingRef.current,
    textContent: textRef.current,
    msSinceLastThinkingDelta: msSinceLastThinking,
    msSinceLastTextDelta: msSinceLastText,
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
  const lastTextAtRef = useRef(0);
  const [toolInvoking, setToolInvoking] = useState(false);

  const reset = useCallback(() => {
    textRef.current = '';
    thinkingRef.current = '';
    lastThinkingAtRef.current = 0;
    lastTextAtRef.current = 0;
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
    lastTextAtRef.current = 0;
    setToolInvoking(false);
    const id = setInterval(() => {
      const next = readToolInvoking(
        true,
        textRef,
        thinkingRef,
        lastThinkingAtRef,
        lastTextAtRef,
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
    lastTextAtRef.current = Date.now();
    setToolInvoking(prev => {
      if (!prev) {
        return prev;
      }
      return readToolInvoking(
        true,
        textRef,
        thinkingRef,
        lastThinkingAtRef,
        lastTextAtRef,
      );
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
      return readToolInvoking(
        true,
        textRef,
        thinkingRef,
        lastThinkingAtRef,
        lastTextAtRef,
      );
    });
  }, []);

  return {toolInvoking, noteTextDelta, noteThinkingDelta, reset};
}
