/**
 * Draft state for events config UI (array of blocks ↔ KKV document).
 */
import type {
  EventActionNode,
  EventsConfig,
} from "@/domain/events-config/model/events-config.js";
import {
  isUnknownActionDraft,
  type EventActionDraft,
} from "./event-config-editor-load.js";
import { normalizeHideMessageAction } from "./event-config-editor-load.js";
import { newEventBlockId } from "./event-block-id.js";
export type { EventActionDraft, UnknownActionDraft, EventsEditorLoadResult } from "./event-config-editor-load.js";
export {
  isUnknownActionDraft,
  isEventActionNode,
  loadEventsConfigForEditor,
  normalizeHideMessageAction,
} from "./event-config-editor-load.js";
export { newEventBlockId } from "./event-block-id.js";

export type EventBlockDraft = {
  readonly id: string;
  eventType: string;
  actions: EventActionDraft[];
};

export function configToEventBlocks(config: EventsConfig): EventBlockDraft[] {
  return Object.entries(config.events).map(([eventType, actions]) => ({
    id: newEventBlockId(),
    eventType,
    actions: actions.map(normalizeHideMessageAction),
  }));
}

export function eventBlocksToConfig(
  blocks: readonly EventBlockDraft[],
  schemaVersion: 2,
): EventsConfig {
  const events: Record<string, EventActionNode[]> = {};
  for (const block of blocks) {
    const key = block.eventType.trim();
    if (key === "") {
      continue;
    }
    events[key] = block.actions
      .filter((action): action is EventActionNode => !isUnknownActionDraft(action))
      .map(normalizeHideMessageAction);
  }
  return { schemaVersion, events };
}
