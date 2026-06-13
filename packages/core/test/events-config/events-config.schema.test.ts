import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encode } from "../../src/infra/serialization/encode.js";
import { DEFAULT_EVENTS_CONFIG } from "../../src/domain/events-config/logic/default-events.js";
import { eventsConfigSchema } from "../../src/domain/events-config/model/events-config.schema.js";

describe("events config schema", () => {
  it("parses run-agent with agent-id kebab wire field", () => {
    const doc = eventsConfigSchema.parse({
      schemaVersion: 2,
      events: {
        "session.compaction.requested": [
          {
            "run-agent": {
              "agent-id": "compaction-worker",
            },
          },
        ],
      },
    });
    const nodes = doc.events["session.compaction.requested"];
    const action = nodes?.[0];
    assert.equal(action?.type, "run-agent");
    assert.equal(action?.params.agentId, "compaction-worker");
  });

  it("rejects legacy agent-run action name", () => {
    assert.throws(
      () =>
        eventsConfigSchema.parse({
          schemaVersion: 2,
          events: {
            "session.compaction.requested": [{ "agent-run": { "agent-id": "x" } }],
          },
        }),
      /renamed to 'run-agent'/,
    );
  });

  it("requires agentId for run-agent", () => {
    assert.throws(
      () =>
        eventsConfigSchema.parse({
          schemaVersion: 2,
          events: {
            "session.message.received": [{ "run-agent": {} }],
          },
        }),
      /requires agentId/,
    );
  });

  it("rejects unknown dependency references", () => {
    assert.throws(
      () =>
        eventsConfigSchema.parse({
          schemaVersion: 2,
          events: {
            "session.compaction.requested": [
              { "hide-message": { dependency: ["missing-action"], "start-depth": 6 } },
            ],
          },
        }),
      /unknown dependency reference/,
    );
  });

  it("round-trips domain config to wire and back", () => {
    const wire = encode(DEFAULT_EVENTS_CONFIG, eventsConfigSchema);
    const doc = eventsConfigSchema.parse(wire);
    assert.deepEqual(doc, DEFAULT_EVENTS_CONFIG);
    const nodes = wire.events[Object.keys(wire.events)[0]!]!;
    assert.ok(
      nodes.some(
        (n) => typeof n === "object" && n != null && "hide-message" in n,
      ),
    );
  });

  it("rejects domain-shaped action items", () => {
    assert.throws(
      () =>
        eventsConfigSchema.parse({
          schemaVersion: 2,
          events: {
            "session.compaction.requested": [
              { type: "hide-message", params: { startDepth: 6 } },
            ],
          },
        }),
      /exactly one key/,
    );
  });

  it("rejects cycles", () => {
    assert.throws(
      () =>
        eventsConfigSchema.parse({
          schemaVersion: 2,
          events: {
            "session.compaction.requested": [
              { "hide-message": { dependency: ["run-agent"], "start-depth": 6 } },
              { "run-agent": { "agent-id": "writer", dependency: ["hide-message"] } },
            ],
          },
        }),
      /cycle/,
    );
  });

  it("rejects refresh-macros action", () => {
    assert.throws(
      () =>
        eventsConfigSchema.parse({
          schemaVersion: 2,
          events: {
            "session.compaction.requested": ["refresh-macros"],
          },
        }),
      /refresh-macros action is removed/,
    );
  });
});
