import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactionPolicyTemplateFromJson,
  CompactionPolicyError,
} from "@novel-master/core";

describe("compactionPolicyTemplateFromJson", () => {
  it("parses template without enabled", () => {
    const tpl = compactionPolicyTemplateFromJson({
      schemaVersion: 1,
      trigger: { tokenThreshold: 100 },
      action: {
        keepLastN: 3,
        abstract: { type: "agent", agentId: "summarizer" },
      },
    });
    assert.equal(tpl.schemaVersion, 1);
    assert.equal(tpl.trigger.tokenThreshold, 100);
  });

  it("T7: rejects enabled in template", () => {
    assert.throws(
      () =>
        compactionPolicyTemplateFromJson({
          schemaVersion: 1,
          enabled: true,
          trigger: { tokenThreshold: 1 },
          action: {
            keepLastN: 1,
            abstract: { type: "text", content: "c" },
          },
        }),
      (e: unknown) =>
        e instanceof CompactionPolicyError && e.code === "INVALID_SCHEMA",
    );
  });
});
