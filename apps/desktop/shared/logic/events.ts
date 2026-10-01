/**
 * Desktop renderer 对 `@novel-master/core/events` 事件常量与类型的具名薄再导出
 * （X1 门禁）。禁止 `export *`。
 *
 * renderer 严禁直连 `@novel-master/core`（eslint 把关），core 的入口一律经
 * `@shared/logic/*` 再导出（先例 `encoding.ts` / `format.ts`）。本文件只做
 * 常量/类型的转发，事件订阅逻辑仍在消费现场（SessionDetailDrawer 等）不动。
 */

export {
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  EVENT_AGENT_STREAM_USAGE,
  EVENT_AGENT_STEP_COMMITTED,
  type AgentRunStartedPayload,
  type AgentRunFinishedPayload,
  type AgentRunFailedPayload,
  type AgentStreamTextDeltaPayload,
  type AgentStreamThinkingDeltaPayload,
  type AgentStreamToolUsePayload,
  type AgentStreamUsagePayload,
  type AgentStepCommittedPayload,
} from "@novel-master/core/events";
