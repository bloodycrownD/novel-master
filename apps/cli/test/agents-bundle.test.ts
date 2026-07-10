import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { decode, parseText } from "@novel-master/core";
import { agentsBundleDocumentSchema } from "../src/agent/schemas/agents-bundle.schema.js";

const examplesAgentsYaml = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../examples/agents.yaml",
);

describe("agents bundle schema", () => {
  it("T-WT14: examples/agents.yaml writer 无 persist.canon", () => {
    const raw = readFileSync(examplesAgentsYaml, "utf8");
    const parsed = parseText(raw, "yaml");
    const doc = decode(parsed, agentsBundleDocumentSchema);
    assert.equal(doc.agents.writer!.prompts.persist.canon, undefined);
  });

  it("T-WT15: writer 无 worktree 块", () => {
    const doc = decode(
      {
        schemaVersion: 1,
        agents: {
          writer: {
            prompts: {
              system: "hi",
              persist: {},
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
    assert.equal(doc.agents.writer!.prompts.persist.canon, undefined);
    assert.deepEqual(doc.agents.summarizer!.prompts.persist, {});
  });
});
