import assert from "node:assert/strict";
import test from "node:test";
import type { EventsConfig } from "@novel-master/core";
import {
  configToEventBlocks,
  eventBlocksToConfig,
  newEventBlockId,
} from "../src/events/event-config-state.js";

test("configToEventBlocks maps events record to draft blocks", () => {
  const config: EventsConfig = {
    schemaVersion: 2,
    events: {
      "session.message.received": [{ type: "refresh-macros", params: {} }],
      "session.compaction.requested": [
        { type: "hide-message", params: { startDepth: 6 } },
      ],
    },
  };
  const blocks = configToEventBlocks(config);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.eventType, "session.message.received");
  assert.deepEqual(blocks[0]!.actions, [{ type: "refresh-macros", params: {} }]);
});

test("eventBlocksToConfig skips blocks with blank event type", () => {
  const config = eventBlocksToConfig(
    [
      {
        id: newEventBlockId(),
        eventType: "  ",
        actions: [{ type: "refresh-macros", params: {} }],
      },
      {
        id: newEventBlockId(),
        eventType: "session.compaction.requested",
        actions: [{ type: "refresh-macros", params: {} }],
      },
    ],
    2,
  );
  assert.deepEqual(config, {
    schemaVersion: 2,
    events: {
      "session.compaction.requested": [{ type: "refresh-macros", params: {} }],
    },
  });
});

test("configToEventBlocks and eventBlocksToConfig round-trip", () => {
  const original: EventsConfig = {
    schemaVersion: 2,
    events: {
      "session.compaction.requested": [
        { type: "hide-message", params: { startDepth: 3 } },
        { type: "refresh-macros", params: {} },
      ],
    },
  };
  const blocks = configToEventBlocks(original);
  const restored = eventBlocksToConfig(blocks, 2);
  assert.deepEqual(restored.events, original.events);
  assert.equal(restored.schemaVersion, 2);
});
