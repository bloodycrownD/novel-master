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
  EVENT_SUBAGENT_CHILD_SESSION_CREATED,
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
  SubagentChildSessionCreatedPayload,
} from "../domain/events/model/event-types.js";
// events-config 相关导出保留到阶段五（Step 15-17 与三端 UI/CLI 一起删）：
// eventsConfigStore 仍是三端 runtime 的活装配，EventsConfig/EventAction 等
// 仍是 desktop/mobile 事件配置 UI 的活类型。
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
