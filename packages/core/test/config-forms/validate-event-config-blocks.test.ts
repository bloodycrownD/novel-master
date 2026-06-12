import type { EventBlockDraft } from "../../src/config-forms/events/event-config-state.js";
import { validateEventConfigBlocks } from "../../src/config-forms/events/validate-event-config-blocks.js";
import assert from "node:assert/strict";
import test from "node:test";

const MSG_RECEIVED = "session.message.received";
const COMPACTION = "session.compaction.requested";

function draft(
  eventType: string,
  actions: EventBlockDraft["actions"],
): EventBlockDraft {
  return {
    id: "b1",
    eventType,
    actions,
  };
}

test("validateEventConfigBlocks rejects duplicate event types", () => {
  const err = validateEventConfigBlocks([
    draft(MSG_RECEIVED, [{ type: "refresh-macros", params: {} }]),
    draft(MSG_RECEIVED, [{ type: "refresh-macros", params: {} }]),
  ]);
  assert.match(err ?? "", /重复/);
  assert.match(err ?? "", /收到助手消息后/);
});

test("validateEventConfigBlocks rejects duplicate action types in one event", () => {
  const err = validateEventConfigBlocks([
    draft(COMPACTION, [
      { type: "hide-message", params: { startDepth: 6 } },
      { type: "hide-message", params: { startDepth: 3 } },
    ]),
  ]);
  assert.match(err ?? "", /隐藏消息/);
  assert.match(err ?? "", /重复/);
});

test("validateEventConfigBlocks accepts distinct actions", () => {
  assert.equal(
    validateEventConfigBlocks([
      draft(COMPACTION, [
        { type: "hide-message", params: { startDepth: 6 } },
        { type: "refresh-macros", params: {} },
      ]),
    ]),
    null,
  );
});

test("validateEventConfigBlocks rejects unknown dependency references", () => {
  const err = validateEventConfigBlocks([
    draft(COMPACTION, [
      {
        type: "hide-message",
        params: { startDepth: 6 },
        dependency: ["run-agent"],
      },
      { type: "refresh-macros", params: {} },
    ]),
  ]);
  assert.match(err ?? "", /依赖不存在/);
  assert.match(err ?? "", /run-agent/);
});

test("validateEventConfigBlocks rejects self dependency", () => {
  const err = validateEventConfigBlocks([
    draft(COMPACTION, [
      {
        type: "hide-message",
        params: { startDepth: 6 },
        dependency: ["hide-message"],
      },
    ]),
  ]);
  assert.match(err ?? "", /不能依赖自身/);
});

test("validateEventConfigBlocks rejects cycle dependencies", () => {
  const err = validateEventConfigBlocks([
    draft(COMPACTION, [
      {
        type: "hide-message",
        params: { startDepth: 6 },
        dependency: ["refresh-macros"],
      },
      {
        type: "refresh-macros",
        params: {},
        dependency: ["hide-message"],
      },
    ]),
  ]);
  assert.match(err ?? "", /循环/);
});
