/**
 * Agent stream IPC event names and payloads (renderer-safe; no core barrel).
 */

export const EVENT_AGENT_RUN_FINISHED = "agent.run.finished" as const;
export const EVENT_AGENT_RUN_FAILED = "agent.run.failed" as const;
export const EVENT_AGENT_STREAM_TEXT_DELTA = "agent.stream.text-delta" as const;
export const EVENT_AGENT_STREAM_THINKING_DELTA =
  "agent.stream.thinking-delta" as const;
export const EVENT_AGENT_STREAM_TOOL_USE = "agent.stream.tool-use" as const;
export const EVENT_AGENT_STEP_COMMITTED = "agent.step.committed" as const;

export interface AgentRunFinishedPayload {
  readonly sessionId: string;
  readonly projectId: string;
  readonly stopReason: string;
  /** 本次 run 内是否曾突变 session VFS（任意 tool 轮） */
  readonly vfsMutated?: boolean;
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
  /** 仅 phase === 'tool_results' 时存在；本轮是否突变 session VFS */
  readonly vfsMutated?: boolean;
}
