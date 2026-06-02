/**
 * Draft state for events config UI (array of blocks ↔ KKV document).
 */
import type {EventExecutionMode, EventsConfig} from '@novel-master/core';

export type EventBlockDraft = {
  readonly id: string;
  eventType: string;
  chain: EventExecutionMode;
};

let nextBlockId = 0;

export function newEventBlockId(): string {
  nextBlockId += 1;
  return `evt-${Date.now()}-${nextBlockId}`;
}

export function configToEventBlocks(config: EventsConfig): EventBlockDraft[] {
  return Object.entries(config.events).map(([eventType, chain]) => ({
    id: newEventBlockId(),
    eventType,
    chain: {
      mode: chain.mode,
      actions: [...chain.actions],
    },
  }));
}

export function eventBlocksToConfig(
  blocks: readonly EventBlockDraft[],
  schemaVersion: number,
): EventsConfig {
  const events: Record<string, EventExecutionMode> = {};
  for (const block of blocks) {
    const key = block.eventType.trim();
    if (key === '') {
      continue;
    }
    events[key] = {
      mode: block.chain.mode,
      actions: block.chain.actions,
    };
  }
  return {schemaVersion, events};
}
