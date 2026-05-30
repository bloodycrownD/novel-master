import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactionPolicySchema,
  decode,
  ConfigDecodeError,
} from "@novel-master/core";
import { CompactionPolicyError } from "../../src/errors/compaction-policy-errors.js";

describe("compactionPolicySchema", () => {
  it("P1: parses valid policy", () => {
    const policy = decode(
      {
        schemaVersion: 1,
        enabled: true,
        trigger: { tokenThreshold: 100 },
        action: {
          keepLastN: 3,
          abstract: { type: "agent", agentId: "writer" },
        },
      },
      compactionPolicySchema,
    );
    assert.equal(policy.enabled, true);
    assert.equal(policy.action.abstract.type, "agent");
    if (policy.action.abstract.type === "agent") {
      assert.equal(policy.action.abstract.agentId, "writer");
    }
  });

  it("P1: rejects invalid schema", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            enabled: true,
            trigger: {},
            action: { keepLastN: 1, abstract: { type: "text", content: "c" } },
          },
          compactionPolicySchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });

  it("P1: agent abstract requires agentId", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            enabled: true,
            trigger: { tokenThreshold: 1 },
            action: { keepLastN: 1, abstract: { type: "agent" } },
          },
          compactionPolicySchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });
});
