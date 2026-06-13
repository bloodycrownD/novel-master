import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";
import { agentsBundleDocumentSchema } from "../src/agent/schemas/agents-bundle.schema.js";

describe("agents bundle schema", () => {
  it("T8: parses two agents with three-region prompts", () => {
    const doc = decode(
      {
        schemaVersion: 1,
        agents: {
          writer: {
            prompts: {
              system: "hi",
              persist: {
                canon: { type: "worktree" },
              },
              dynamic: {},
            },
          },
          summarizer: {
            prompts: { persist: {}, dynamic: {} },
          },
        },
      },
      agentsBundleDocumentSchema,
    );
    assert.equal(Object.keys(doc.agents).length, 2);
    assert.equal(doc.agents.writer!.prompts.system, "hi");
    assert.equal(doc.agents.writer!.prompts.persist.canon?.type, "worktree");
    assert.deepEqual(doc.agents.summarizer!.prompts.persist, {});
  });
});
