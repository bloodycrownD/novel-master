import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compactionPolicyFromJson } from "@novel-master/core";
import { CompactionPolicyError } from "../../src/errors/compaction-policy-errors.js";

describe("compactionPolicyFromJson", () => {
  it("P1: parses valid policy", () => {
    const policy = compactionPolicyFromJson({
      schemaVersion: 1,
      enabled: true,
      trigger: { tokenThreshold: 100 },
      action: {
        keepLastN: 3,
        abstract: { type: "agent", agentId: "writer" },
      },
    });
    assert.equal(policy.enabled, true);
    assert.equal(policy.action.abstract.type, "agent");
    if (policy.action.abstract.type === "agent") {
      assert.equal(policy.action.abstract.agentId, "writer");
    }
  });

  it("P1: rejects invalid schema", () => {
    assert.throws(
      () =>
        compactionPolicyFromJson({
          schemaVersion: 1,
          enabled: true,
          trigger: {},
          action: { keepLastN: 1, abstract: { type: "text", content: "c" } },
        }),
      (e: unknown) =>
        e instanceof Error &&
        e.name === "CompactionPolicyError" &&
        (e as CompactionPolicyError).code === "INVALID_SCHEMA",
    );
  });

  it("P1: agent abstract requires agentId", () => {
    assert.throws(
      () =>
        compactionPolicyFromJson({
          schemaVersion: 1,
          enabled: true,
          trigger: { tokenThreshold: 1 },
          action: { keepLastN: 1, abstract: { type: "agent" } },
        }),
      (e: unknown) =>
        e instanceof Error && e.name === "CompactionPolicyError",
    );
  });
});
