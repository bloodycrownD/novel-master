/**
 * Draft state for events config UI (array of blocks ↔ KKV document).
 */
import type {
  EventActionNode,
  EventsConfig,
} from "@/domain/events-config/model/events-config.js";

export type EventBlockDraft = {
  readonly id: string;
  eventType: string;
  actions: EventActionNode[];
};

let nextBlockId = 0;

export function newEventBlockId(): string {
  nextBlockId += 1;
  return `evt-${Date.now()}-${nextBlockId}`;
}

export function configToEventBlocks(config: EventsConfig): EventBlockDraft[] {
  return Object.entries(config.events).map(([eventType, actions]) => ({
    id: newEventBlockId(),
    eventType,
    actions: [...actions],
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
    events[key] = block.actions;
  }
  return { schemaVersion, events };
}
