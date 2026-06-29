/**
 * 检测 stream tail 是否应显示「工具调用中」。
 * 路径1：agent 运行中 + 有过 thinking + 无 text + thinking 空闲 ≥300ms。
 * 路径2：agent 运行中 + 有 text + text 空闲 ≥300ms（正文后等待 tool_call）。
 */
import { useCallback, useEffect, useRef, useState } from "react";

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

export function useStreamToolInvoking(agentRunning: boolean): {
  readonly toolInvoking: boolean;
  readonly noteTextDelta: (delta: string) => void;
  readonly noteThinkingDelta: (delta: string) => void;
  readonly reset: () => void;
} {
  const textRef = useRef("");
  const thinkingRef = useRef("");
  const lastThinkingAtRef = useRef(0);
  const lastTextAtRef = useRef(0);
  const [tick, setTick] = useState(0);

  const reset = useCallback(() => {
    textRef.current = "";
    thinkingRef.current = "";
    lastThinkingAtRef.current = 0;
    lastTextAtRef.current = 0;
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!agentRunning) {
      reset();
      return undefined;
    }
    textRef.current = "";
    thinkingRef.current = "";
    lastThinkingAtRef.current = 0;
    lastTextAtRef.current = 0;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [agentRunning, reset]);

  // Delta handlers 仅更新 ref；100ms tick 重读 toolInvoking（避免每 delta setState）。
  const noteTextDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    textRef.current += delta;
    lastTextAtRef.current = Date.now();
  }, []);

  const noteThinkingDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    thinkingRef.current += delta;
    lastThinkingAtRef.current = Date.now();
  }, []);

  void tick;

  const msSinceLastThinking =
    lastThinkingAtRef.current > 0
      ? Date.now() - lastThinkingAtRef.current
      : Number.POSITIVE_INFINITY;
  const msSinceLastText =
    lastTextAtRef.current > 0
      ? Date.now() - lastTextAtRef.current
      : Number.POSITIVE_INFINITY;

  const toolInvoking = computeToolInvoking({
    agentRunning,
    thinkingContent: thinkingRef.current,
    textContent: textRef.current,
    msSinceLastThinkingDelta: msSinceLastThinking,
    msSinceLastTextDelta: msSinceLastText,
  });

  return { toolInvoking, noteTextDelta, noteThinkingDelta, reset };
}
