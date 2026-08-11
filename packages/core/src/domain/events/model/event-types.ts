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
/** 子 agent 会话创建：task 工具执行中即可点击进入子会话浏览。 */
export const EVENT_SUBAGENT_CHILD_SESSION_CREATED =
  "subagent.child-session.created" as const;

export type NovelMasterEventType =
  | typeof EVENT_AGENT_RUN_STARTED
  | typeof EVENT_AGENT_RUN_FINISHED
  | typeof EVENT_AGENT_RUN_FAILED
  | typeof EVENT_AGENT_STREAM_TEXT_DELTA
  | typeof EVENT_AGENT_STREAM_THINKING_DELTA
  | typeof EVENT_AGENT_STREAM_TOOL_USE
  | typeof EVENT_AGENT_STEP_COMMITTED
  | typeof EVENT_SUBAGENT_CHILD_SESSION_CREATED;

export interface AgentRunStartedPayload {
  readonly sessionId: string;
  readonly projectId: string;
  readonly runId: string;
}

export interface AgentRunFinishedPayload {
  readonly sessionId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly stopReason: string;
  /** 本次 run 内是否曾突变 session VFS（任意 tool 轮） */
  readonly vfsMutated?: boolean;
}

export interface AgentRunFailedPayload {
  readonly sessionId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly error: string;
}

export interface AgentStreamTextDeltaPayload {
  readonly sessionId: string;
  readonly runId: string;
  readonly text: string;
}

export interface AgentStreamThinkingDeltaPayload {
  readonly sessionId: string;
  readonly runId: string;
  readonly text: string;
}

export interface AgentStreamToolUsePayload {
  readonly sessionId: string;
  readonly runId: string;
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export type AgentStepCommittedPhase = "assistant" | "tool_results";

export interface AgentStepCommittedPayload {
  readonly sessionId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly phase: AgentStepCommittedPhase;
  /** 仅 phase === 'tool_results' 时存在；本轮是否突变 session VFS */
  readonly vfsMutated?: boolean;
}

export interface SubagentChildSessionCreatedPayload {
  readonly parentSessionId: string;
  readonly projectId: string;
  readonly childSessionId: string;
  /** 子会话标题（来自 task 工具入参 description 或 prompt 前 40 字）；供 UI 按 title 匹配 pending tool_use。 */
  readonly title: string;
}

export type NovelMasterEventPayload =
  | AgentRunStartedPayload
  | AgentRunFinishedPayload
  | AgentRunFailedPayload
  | AgentStreamTextDeltaPayload
  | AgentStreamThinkingDeltaPayload
  | AgentStreamToolUsePayload
  | AgentStepCommittedPayload
  | SubagentChildSessionCreatedPayload;
