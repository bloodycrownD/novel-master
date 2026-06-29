/**
 * 工具调用横条显示：启发式 heuristicOn ∨ 事件 latch toolUseLatched（OR，非互斥）。
 */
import { useCallback, useEffect, useState } from "react";
import { useStreamToolInvoking } from "@/hooks/useStreamToolInvoking";

export function useStreamToolInvokingDisplay(agentRunning: boolean): {
  readonly toolInvoking: boolean;
  readonly heuristicOn: boolean;
  readonly toolUseLatched: boolean;
  readonly noteTextDelta: (delta: string) => void;
  readonly noteThinkingDelta: (delta: string) => void;
  readonly latchToolUse: () => void;
  readonly clearToolUseLatch: () => void;
  readonly resetAll: () => void;
} {
  const {
    toolInvoking: heuristicOn,
    noteTextDelta,
    noteThinkingDelta,
    reset: resetHeuristic,
  } = useStreamToolInvoking(agentRunning);
  const [toolUseLatched, setToolUseLatched] = useState(false);

  useEffect(() => {
    if (!agentRunning) {
      setToolUseLatched(false);
    }
  }, [agentRunning]);

  const latchToolUse = useCallback(() => {
    setToolUseLatched(true);
  }, []);

  const clearToolUseLatch = useCallback(() => {
    setToolUseLatched(false);
  }, []);

  const resetAll = useCallback(() => {
    setToolUseLatched(false);
    resetHeuristic();
  }, [resetHeuristic]);

  const toolInvoking = agentRunning && (heuristicOn || toolUseLatched);

  return {
    toolInvoking,
    heuristicOn,
    toolUseLatched,
    noteTextDelta,
    noteThinkingDelta,
    latchToolUse,
    clearToolUseLatch,
    resetAll,
  };
}
