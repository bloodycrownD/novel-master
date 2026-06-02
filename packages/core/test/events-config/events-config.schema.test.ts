import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
              { "hide-message": { dependency: ["run-agent"], "start-depth": 6 } },
              "refresh-macros",
            ],
          },
        }),
      /unknown dependency reference/,
    );
  });

  it("rejects cycles", () => {
    assert.throws(
      () =>
        eventsConfigSchema.parse({
          schemaVersion: 2,
          events: {
            "session.compaction.requested": [
              { "hide-message": { dependency: ["refresh-macros"], startDepth: 6 } },
              { "refresh-macros": { dependency: ["hide-message"] } },
            ],
          },
        }),
      /cycle/,
    );
  });
});
