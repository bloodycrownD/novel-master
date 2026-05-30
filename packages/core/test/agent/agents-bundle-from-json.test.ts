import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentsBundleFromJson } from "@novel-master/core";

describe("agentsBundleFromJson", () => {
  it("T8: parses two agents; summarizer has empty blocks map", () => {
    const bundle = agentsBundleFromJson({
      schemaVersion: 1,
      agents: {
        writer: {
          prompts: {
            blocks: {
              system: {
                type: "text",
                role: "system",
                content: "hi",
              },
            },
          },
        },
        summarizer: {
          prompts: { blocks: {} },
        },
      },
    });
    assert.equal(bundle.size, 2);
    const writer = bundle.get("writer");
    assert.equal(writer?.name, "writer");
    assert.equal(writer?.prompts[0]?.name, "system");
    const summarizer = bundle.get("summarizer");
    assert.equal(summarizer?.name, "summarizer");
    assert.equal(summarizer?.prompts.length, 0);
  });
});
