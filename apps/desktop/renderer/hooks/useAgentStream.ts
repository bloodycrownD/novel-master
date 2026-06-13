/**
 * Listens to main-process agent stream events forwarded over IPC.
 */
import { useEffect } from "react";
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  type AgentRunFailedPayload,
  type AgentRunFinishedPayload,
  type AgentStepCommittedPayload,
  type AgentStreamTextDeltaPayload,
  type AgentStreamThinkingDeltaPayload,
  type AgentStreamToolUsePayload,
} from "../../shared/agent-event-types.js";
import { onAgentStream } from "../ipc/client";

export interface UseAgentStreamOptions {
  readonly sessionId: string | undefined;
  readonly onTextDelta: (delta: string) => void;
  readonly onThinkingDelta: (delta: string) => void;
  readonly onToolUse?: (payload: AgentStreamToolUsePayload) => void;
  readonly onStepCommitted?: (payload: AgentStepCommittedPayload) => void;
  readonly onRunFinished?: (payload: AgentRunFinishedPayload) => void;
  readonly onRunFailed?: (payload: AgentRunFailedPayload) => void;
}

export function useAgentStream({
  sessionId,
  onTextDelta,
  onThinkingDelta,
  onToolUse,
  onStepCommitted,
  onRunFinished,
  onRunFailed,
}: UseAgentStreamOptions): void {
  useEffect(() => {
    if (sessionId == null) {
      return;
    }
    return onAgentStream((envelope) => {
      const { type, payload } = envelope;
      if (type === EVENT_AGENT_STREAM_TEXT_DELTA) {
        const p = payload as AgentStreamTextDeltaPayload;
        if (p.sessionId === sessionId) {
          onTextDelta(p.text);
        }
        return;
      }
      if (type === EVENT_AGENT_STREAM_THINKING_DELTA) {
        const p = payload as AgentStreamThinkingDeltaPayload;
        if (p.sessionId === sessionId) {
          onThinkingDelta(p.text);
        }
        return;
      }
      if (type === EVENT_AGENT_STREAM_TOOL_USE) {
        const p = payload as AgentStreamToolUsePayload;
        if (p.sessionId === sessionId) {
          onToolUse?.(p);
        }
        return;
      }
      if (type === EVENT_AGENT_STEP_COMMITTED) {
        const p = payload as AgentStepCommittedPayload;
        if (p.sessionId === sessionId) {
          onStepCommitted?.(p);
        }
        return;
      }
      if (type === EVENT_AGENT_RUN_FINISHED) {
        const p = payload as AgentRunFinishedPayload;
        if (p.sessionId === sessionId) {
          onRunFinished?.(p);
        }
        return;
      }
      if (type === EVENT_AGENT_RUN_FAILED) {
        const p = payload as AgentRunFailedPayload;
        if (p.sessionId === sessionId) {
          onRunFailed?.(p);
        }
      }
    });
  }, [
    sessionId,
    onTextDelta,
    onThinkingDelta,
    onToolUse,
    onStepCommitted,
    onRunFinished,
    onRunFailed,
  ]);
}
