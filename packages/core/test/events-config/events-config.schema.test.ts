import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eventsConfigSchema } from "@novel-master/core";

describe("events config schema", () => {
  it("parses run-agent with agent-id kebab wire field", () => {
    const doc = eventsConfigSchema.parse({
      schemaVersion: 1,
      events: {
        "session.compaction.requested": {
          parallel: [
            {
              "run-agent": {
                "agent-id": "compaction-worker",
              },
            },
          ],
        },
      },
    });
    const chain = doc.events["session.compaction.requested"];
    assert.equal(chain?.mode, "parallel");
    const action = chain?.actions[0];
    assert.equal(action?.type, "run-agent");
    if (action?.type === "run-agent") {
      assert.equal(action.params.agentId, "compaction-worker");
    }
  });

  it("rejects legacy agent-run action name", () => {
    assert.throws(
      () =>
        eventsConfigSchema.parse({
          schemaVersion: 1,
          events: {
            "session.compaction.requested": {
              parallel: [{ "agent-run": { "agent-id": "x" } }],
            },
          },
        }),
      /renamed to 'run-agent'/,
    );
  });

  it("requires agentId for run-agent", () => {
    assert.throws(
      () =>
        eventsConfigSchema.parse({
          schemaVersion: 1,
          events: {
            "session.message.received": {
              sequential: [{ "run-agent": {} }],
            },
          },
        }),
      /requires agentId/,
    );
  });
});
