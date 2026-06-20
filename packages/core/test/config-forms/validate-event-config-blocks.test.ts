import type { EventBlockDraft } from "../../src/config-forms/events/event-config-state.js";
import { eventBlocksToConfig } from "../../src/config-forms/events/event-config-state.js";
import { validateEventConfigBlocks } from "../../src/config-forms/events/validate-event-config-blocks.js";
import { eventsConfigSchema } from "../../src/domain/events-config/model/events-config.schema.js";
import assert from "node:assert/strict";
import test from "node:test";

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
    draft(COMPACTION, [{ type: "hide-message", params: { startDepth: 6 } }]),
    draft(COMPACTION, [{ type: "hide-message", params: { startDepth: 3 } }]),
  ]);
  assert.match(err ?? "", /重复/);
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

test("validateEventConfigBlocks accepts hide + run-agent", () => {
  assert.equal(
    validateEventConfigBlocks([
      draft(COMPACTION, [
        { type: "hide-message", params: { startDepth: 6 } },
        { type: "run-agent", params: { agentId: "writer" } },
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
        dependency: ["run-agent"],
      },
      {
        type: "run-agent",
        params: { agentId: "writer" },
        dependency: ["hide-message"],
      },
    ]),
  ]);
  assert.match(err ?? "", /循环/);
});

test("validateEventConfigBlocks accepts endDepth-only hide-message (D1)", () => {
  assert.equal(
    validateEventConfigBlocks([
      draft(COMPACTION, [{ type: "hide-message", params: { endDepth: 3 } }]),
    ]),
    null,
  );
});

test("validateEventConfigBlocks accepts startDepth and endDepth (D2)", () => {
  assert.equal(
    validateEventConfigBlocks([
      draft(COMPACTION, [{ type: "hide-message", params: { startDepth: 1, endDepth: 5 } }]),
    ]),
    null,
  );
});

test("validateEventConfigBlocks rejects empty depth slice (D3)", () => {
  const err = validateEventConfigBlocks([
    draft(COMPACTION, [{ type: "hide-message", params: {} }]),
  ]);
  assert.match(err ?? "", /depth slice requires at least startDepth or endDepth/);
});

test("validateEventConfigBlocks rejects startDepth > endDepth (D4)", () => {
  const err = validateEventConfigBlocks([
    draft(COMPACTION, [{ type: "hide-message", params: { startDepth: 5, endDepth: 2 } }]),
  ]);
  assert.match(err ?? "", /startDepth must be <= endDepth/);
});

test("eventBlocksToConfig output passes eventsConfigSchema decode smoke", () => {
  const config = eventBlocksToConfig(
    [
      draft(COMPACTION, [
        { type: "hide-message", params: { startDepth: 4 } },
        { type: "run-agent", params: { agentId: "writer" }, dependency: ["hide-message"] },
      ]),
    ],
    2,
  );
  const wire = eventsConfigSchema.toWire(config);
  const parsed = eventsConfigSchema.parse(wire);
  assert.equal(parsed.events[COMPACTION]?.length, 2);
});

