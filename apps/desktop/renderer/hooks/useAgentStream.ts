/**
 * Listens to main-process agent stream events forwarded over IPC.
 */
import { useEffect } from "react";
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  type AgentRunFinishedPayload,
  type AgentStepCommittedPayload,
  type AgentStreamTextDeltaPayload,
  type AgentStreamThinkingDeltaPayload,
} from "../../shared/agent-event-types.js";
import { onAgentStream } from "../ipc/client";

export interface UseAgentStreamOptions {
  readonly sessionId: string | undefined;
  readonly onTextDelta: (delta: string) => void;
  readonly onThinkingDelta: (delta: string) => void;
  readonly onStepCommitted?: (payload: AgentStepCommittedPayload) => void;
  readonly onRunFinished?: (payload: AgentRunFinishedPayload) => void;
}

export function useAgentStream({
  sessionId,
  onTextDelta,
  onThinkingDelta,
  onStepCommitted,
  onRunFinished,
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
      }
    });
  }, [
    sessionId,
    onTextDelta,
    onThinkingDelta,
    onStepCommitted,
    onRunFinished,
  ]);
}
