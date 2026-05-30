import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deserializeAgentDefinition,
  serializeAgentDefinition,
  loadPromptBlocksFromYaml,
} from "@novel-master/core";

describe("agent-definition-io", () => {
  it("round-trips YAML", () => {
    const yaml = `
schemaVersion: 1
name: test
preferredModelId: anthropic/claude
prompts:
  blocks:
    - name: s
      type: text
      role: system
      content: hello
`;
    const def = deserializeAgentDefinition(yaml);
    assert.equal(def.name, "test");
    assert.equal(def.preferredModelId, "anthropic/claude");
    const out = serializeAgentDefinition(def);
    const again = deserializeAgentDefinition(out);
    assert.equal(again.prompts[0]?.name, "s");
  });

  it("loadPromptBlocksFromYaml reads blocks at root", () => {
    const blocks = loadPromptBlocksFromYaml(`
blocks:
  - name: c
    type: chat
`);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "chat");
  });
});
