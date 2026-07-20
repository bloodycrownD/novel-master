/**
 * Desktop renderer 对 `@novel-master/core/config-forms/events` 的具名薄再导出。
 * 禁止 `export *`；非 assess 的表单 helpers。
 */

export type { EventBlockDraft } from "@novel-master/core/config-forms/events";

export {
  ACTION_ADD_OPTIONS,
  actionTypeHint,
  actionTypeLabel,
  configToEventBlocks,
  createDefaultAction,
  DEFAULT_EVENTS_CONFIG,
  defaultDagForEvent,
  EVENT_ADD_OPTIONS,
  eventBlocksToConfig,
  eventTypeHint,
  eventTypeLabel,
  matchDepth,
  newEventBlockId,
  validateDepthSlice,
  validateEventConfigBlocks,
} from "@novel-master/core/config-forms/events";
