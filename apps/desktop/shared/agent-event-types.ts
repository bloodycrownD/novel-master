/**
 * Agent stream IPC event names and payloads (renderer-safe; no core barrel).
 */

export const EVENT_AGENT_RUN_FINISHED = "agent.run.finished" as const;
export const EVENT_AGENT_STREAM_TEXT_DELTA = "agent.stream.text-delta" as const;
export const EVENT_AGENT_STREAM_THINKING_DELTA =
  "agent.stream.thinking-delta" as const;
export const EVENT_AGENT_STEP_COMMITTED = "agent.step.committed" as const;

export interface AgentRunFinishedPayload {
  readonly sessionId: string;
  readonly projectId: string;
  readonly stopReason: string;
}

export interface AgentStreamTextDeltaPayload {
  readonly sessionId: string;
  readonly text: string;
}

export interface AgentStreamThinkingDeltaPayload {
  readonly sessionId: string;
  readonly text: string;
}

export type AgentStepCommittedPhase = "assistant" | "tool_results";

export interface AgentStepCommittedPayload {
  readonly sessionId: string;
  readonly projectId: string;
  readonly phase: AgentStepCommittedPhase;
}
