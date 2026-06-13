import assert from "node:assert/strict";
import test from "node:test";
import { decode } from "@/infra/serialization/decode.js";
import { encode } from "@/infra/serialization/encode.js";
import { eventsConfigSchema } from "@/domain/events-config/model/events-config.schema.js";
import { EVENT_SESSION_COMPACTION_REQUESTED } from "@/domain/events/model/event-types.js";
import {
  isUnknownActionDraft,
  loadEventsConfigForEditor,
} from "../../src/config-forms/events/event-config-editor-load.js";
import { eventBlocksToConfig } from "../../src/config-forms/events/event-config-state.js";
import { validateEventConfigBlocks } from "../../src/config-forms/events/validate-event-config-blocks.js";
import type { EventBlockDraft } from "../../src/config-forms/events/event-config-state.js";

const COMPACTION = EVENT_SESSION_COMPACTION_REQUESTED;

test("loadEventsConfigForEditor：refresh-macros 简写转为 unknown", () => {
  const wire = {
    schemaVersion: 2,
    events: {
      [COMPACTION]: ["refresh-macros"],
    },
  };
  const loaded = loadEventsConfigForEditor(wire);
  assert.deepEqual(loaded.unknownActions, ["refresh-macros"]);
  assert.equal(loaded.blocks.length, 1);
  const action = loaded.blocks[0]!.actions[0]!;
  assert.equal(isUnknownActionDraft(action), true);
  if (isUnknownActionDraft(action)) {
    assert.equal(action.wireKey, "refresh-macros");
    assert.equal(action.kind, "unknown");
  }
});

test("loadEventsConfigForEditor：refresh-macros 对象形式转为 unknown", () => {
  const wire = {
    schemaVersion: 2,
    events: {
      [COMPACTION]: [{ "refresh-macros": {} }],
    },
  };
  const loaded = loadEventsConfigForEditor(wire);
  assert.deepEqual(loaded.unknownActions, ["refresh-macros"]);
  assert.equal(isUnknownActionDraft(loaded.blocks[0]!.actions[0]!), true);
});

test("loadEventsConfigForEditor：合法 action 与 unknown 可并存", () => {
  const wire = {
    schemaVersion: 2,
    events: {
      [COMPACTION]: [
        { "hide-message": { "start-depth": 6 } },
        "refresh-macros",
      ],
    },
  };
  const loaded = loadEventsConfigForEditor(wire);
  assert.deepEqual(loaded.unknownActions, ["refresh-macros"]);
  assert.equal(loaded.blocks[0]!.actions.length, 2);
  assert.equal(isUnknownActionDraft(loaded.blocks[0]!.actions[1]!), true);
  const first = loaded.blocks[0]!.actions[0]!;
  assert.equal("type" in first && first.type, "hide-message");
});

test("validateEventConfigBlocks 拒绝含 unknown 的 blocks", () => {
  const blocks: EventBlockDraft[] = [
    {
      id: "b1",
      eventType: COMPACTION,
      actions: [
        { kind: "unknown", wireKey: "refresh-macros", raw: "refresh-macros" },
      ],
    },
  ];
  const err = validateEventConfigBlocks(blocks);
  assert.equal(err, "存在未知 action，请移除后保存");
});

test("删除 unknown 后 eventBlocksToConfig 可通过 strict schema", () => {
  const wire = {
    schemaVersion: 2,
    events: {
      [COMPACTION]: [
        { "hide-message": { "start-depth": 6 } },
        "refresh-macros",
      ],
    },
  };
  const loaded = loadEventsConfigForEditor(wire);
  const cleaned: EventBlockDraft[] = loaded.blocks.map((block) => ({
    ...block,
    actions: block.actions.filter((a) => !isUnknownActionDraft(a)),
  }));
  assert.equal(validateEventConfigBlocks(cleaned), null);
  const config = eventBlocksToConfig(cleaned, 2);
  const encodedWire = encode(config, eventsConfigSchema);
  assert.doesNotThrow(() => {
    decode(encodedWire, eventsConfigSchema);
  });
});
