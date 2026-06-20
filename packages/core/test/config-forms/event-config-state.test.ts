import assert from "node:assert/strict";
import test from "node:test";
import type { EventsConfig } from "@/domain/events-config/model/events-config.js";
import {
  configToEventBlocks,
  eventBlocksToConfig,
  newEventBlockId,
} from "../../src/config-forms/events/event-config-state.js";

test("configToEventBlocks maps events record to draft blocks", () => {
  const config: EventsConfig = {
    schemaVersion: 2,
    events: {
      "session.compaction.requested": [
        { type: "hide-message", params: { startDepth: 6 } },
      ],
    },
  };
  const blocks = configToEventBlocks(config);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.eventType, "session.compaction.requested");
  assert.deepEqual(blocks[0]!.actions, [
    { type: "hide-message", params: { startDepth: 6 } },
  ]);
});

test("eventBlocksToConfig skips blocks with blank event type", () => {
  const config = eventBlocksToConfig(
    [
      {
        id: newEventBlockId(),
        eventType: "  ",
        actions: [{ type: "hide-message", params: { startDepth: 6 } }],
      },
      {
        id: newEventBlockId(),
        eventType: "session.compaction.requested",
        actions: [{ type: "hide-message", params: { startDepth: 3 } }],
      },
    ],
    2,
  );
  assert.deepEqual(config, {
    schemaVersion: 2,
    events: {
      "session.compaction.requested": [
        { type: "hide-message", params: { startDepth: 3 } },
      ],
    },
  });
});

test("configToEventBlocks and eventBlocksToConfig round-trip", () => {
  const original: EventsConfig = {
    schemaVersion: 2,
    events: {
      "session.compaction.requested": [
        { type: "hide-message", params: { startDepth: 3 } },
      ],
    },
  };
  const blocks = configToEventBlocks(original);
  const restored = eventBlocksToConfig(blocks, 2);
  assert.deepEqual(restored.events, original.events);
  assert.equal(restored.schemaVersion, 2);
});

test("configToEventBlocks strips endDepth; UI round-trip drops endDepth (C2)", () => {
  const config: EventsConfig = {
    schemaVersion: 2,
    events: {
      "session.compaction.requested": [
        { type: "hide-message", params: { startDepth: 2, endDepth: 8 } },
      ],
    },
  };
  const blocks = configToEventBlocks(config);
  assert.deepEqual(blocks[0]!.actions[0]!.params, { startDepth: 2 });
  const restored = eventBlocksToConfig(blocks, 2);
  assert.deepEqual(restored.events["session.compaction.requested"]![0]!.params, {
    startDepth: 2,
  });
});

