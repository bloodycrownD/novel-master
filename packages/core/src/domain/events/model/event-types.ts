/**
 * Built-in event names and payload types for the process event bus.
 *
 * @module domain/events/model/event-types
 */

/** User-configurable and lifecycle event type strings. */
export const EVENT_AGENT_RUN_STARTED = "agent.run.started" as const;
export const EVENT_AGENT_RUN_FINISHED = "agent.run.finished" as const;
export const EVENT_AGENT_RUN_FAILED = "agent.run.failed" as const;
export const EVENT_AGENT_STREAM_TEXT_DELTA = "agent.stream.text-delta" as const;
export const EVENT_AGENT_STREAM_THINKING_DELTA =
  "agent.stream.thinking-delta" as const;
/** Streamed tool_use block before tool_result is persisted. */
export const EVENT_AGENT_STREAM_TOOL_USE = "agent.stream.tool-use" as const;
/** One agent loop step persisted (assistant turn or tool_result user turn). */
export const EVENT_AGENT_STEP_COMMITTED = "agent.step.committed" as const;
export const EVENT_SESSION_MESSAGE_RECEIVED = "session.message.received" as const;
export const EVENT_SESSION_COMPACTION_REQUESTED =
  "session.compaction.requested" as const;

export type NovelMasterEventType =
  | typeof EVENT_AGENT_RUN_STARTED
  | typeof EVENT_AGENT_RUN_FINISHED
  | typeof EVENT_AGENT_RUN_FAILED
  | typeof EVENT_AGENT_STREAM_TEXT_DELTA
  | typeof EVENT_AGENT_STREAM_THINKING_DELTA
  | typeof EVENT_AGENT_STREAM_TOOL_USE
  | typeof EVENT_AGENT_STEP_COMMITTED
  | typeof EVENT_SESSION_MESSAGE_RECEIVED
  | typeof EVENT_SESSION_COMPACTION_REQUESTED;

export interface AgentRunStartedPayload {
  readonly sessionId: string;
  readonly projectId: string;
}

export interface AgentRunFinishedPayload {
  readonly sessionId: string;
  readonly projectId: string;
  readonly stopReason: string;
}

export interface AgentRunFailedPayload {
  readonly sessionId: string;
  readonly projectId: string;
  readonly error: string;
}

export interface AgentStreamTextDeltaPayload {
  readonly sessionId: string;
  readonly text: string;
}

export interface AgentStreamThinkingDeltaPayload {
  readonly sessionId: string;
  readonly text: string;
}

export interface AgentStreamToolUsePayload {
  readonly sessionId: string;
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export type AgentStepCommittedPhase = "assistant" | "tool_results";

export interface AgentStepCommittedPayload {
  readonly sessionId: string;
  readonly projectId: string;
  readonly phase: AgentStepCommittedPhase;
}

export interface SessionMessageReceivedPayload {
  readonly sessionId: string;
  readonly projectId: string;
}

export type CompactionTriggerKind = "condition" | "manual";

export interface SessionCompactionRequestedPayload {
  readonly sessionId: string;
  readonly projectId: string;
  readonly trigger: CompactionTriggerKind;
}

export type NovelMasterEventPayload =
  | AgentRunStartedPayload
  | AgentRunFinishedPayload
  | AgentRunFailedPayload
  | AgentStreamTextDeltaPayload
  | AgentStreamThinkingDeltaPayload
  | AgentStreamToolUsePayload
  | AgentStepCommittedPayload
  | SessionMessageReceivedPayload
  | SessionCompactionRequestedPayload;
