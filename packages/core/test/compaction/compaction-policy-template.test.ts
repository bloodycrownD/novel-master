import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactionPolicyTemplateSchema,
  decode,
  ConfigDecodeError,
} from "@novel-master/core";

describe("compactionPolicyTemplateSchema", () => {
  it("parses template without enabled", () => {
    const tpl = decode(
      {
        schemaVersion: 1,
        trigger: { tokenThreshold: 100 },
        action: {
          keepLastN: 3,
          abstract: { type: "agent", agentId: "summarizer" },
        },
      },
      compactionPolicyTemplateSchema,
    );
    assert.equal(tpl.trigger.tokenThreshold, 100);
    assert.equal(tpl.action.abstract.type, "agent");
  });

  it("T7: rejects enabled in template", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            enabled: true,
            trigger: { tokenThreshold: 1 },
            action: {
              keepLastN: 1,
              abstract: { type: "text", content: "c" },
            },
          },
          compactionPolicyTemplateSchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });
});
