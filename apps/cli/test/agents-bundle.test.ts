import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";
import { agentsBundleDocumentSchema } from "../src/agent/schemas/agents-bundle.schema.js";
import { validatePromptBlocksFromMap } from "@novel-master/core";

describe("agents bundle schema", () => {
  it("T8: parses two agents; summarizer has empty blocks map", () => {
    const doc = decode(
      {
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
      },
      agentsBundleDocumentSchema,
    );
    assert.equal(Object.keys(doc.agents).length, 2);
    const writerBlocks = validatePromptBlocksFromMap(doc.agents.writer!.prompts.blocks);
    assert.equal(writerBlocks[0]?.name, "system");
    const summarizerBlocks = validatePromptBlocksFromMap(
      doc.agents.summarizer!.prompts.blocks,
    );
    assert.equal(summarizerBlocks.length, 0);
  });
});
