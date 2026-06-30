export { SimpleEventBus } from "../infra/events/simple-event-bus.js";
export type { EventBus, EventSubscription } from "../infra/events/simple-event-bus.js";
export {
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_SESSION_MESSAGE_RECEIVED,
  EVENT_SESSION_COMPACTION_REQUESTED,
} from "../domain/events/model/event-types.js";
export type {
  NovelMasterEventType,
  AgentRunStartedPayload,
  AgentRunFinishedPayload,
  AgentRunFailedPayload,
  AgentStreamTextDeltaPayload,
  AgentStreamThinkingDeltaPayload,
  AgentStreamToolUsePayload,
  AgentStepCommittedPayload,
  AgentStepCommittedPhase,
  SessionCompactionRequestedPayload,
  CompactionTriggerKind,
} from "../domain/events/model/event-types.js";
export type {
  EventsConfig,
  EventAction,
  EventActionNode,
  EventActionType,
  HideMessageActionParams,
  RunAgentActionParams,
} from "../domain/events-config/model/events-config.js";
export { eventsConfigSchema } from "../domain/events-config/model/events-config.schema.js";
export { DEFAULT_EVENTS_CONFIG } from "../domain/events-config/logic/default-events.js";
export type { EventsConfigStore } from "../service/events-config/events-config-store.port.js";
export { createEventsConfigStore } from "../service/events-config/create-events-config-store.js";
export type { EventOrchestrator, EventEmitContext } from "../service/events/event-orchestrator.port.js";
export {
  createEventOrchestrator,
  createRunAgentHandlerDeps,
  detachEventOrchestratorFromBus,
} from "../service/events/create-event-orchestrator.js";
export type { EventRunResult, EventActionFailure } from "../service/events/event-run-result.js";
export { EventsError } from "../errors/events-errors.js";
