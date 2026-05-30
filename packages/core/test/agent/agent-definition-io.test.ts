import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentDefinitionSchema,
  decode,
  encode,
  loadPromptBlocksFromYaml,
  parseText,
  stringifyText,
} from "@novel-master/core";

describe("agent definition serialization", () => {
  it("round-trips YAML with blocks map", () => {
    const yaml = `
schemaVersion: 1
name: test
model: anthropic/claude
prompts:
  blocks:
    s:
      type: text
      role: system
      content: hello
`;
    const def = decode(parseText(yaml, "yaml"), agentDefinitionSchema);
    assert.equal(def.name, "test");
    assert.equal(def.model, "anthropic/claude");
    const out = stringifyText(encode(def, agentDefinitionSchema), "yaml");
    const again = decode(parseText(out, "yaml"), agentDefinitionSchema);
    assert.equal(again.prompts[0]?.name, "s");
  });

  it("loadPromptBlocksFromYaml reads blocks map at root", () => {
    const blocks = loadPromptBlocksFromYaml(`
blocks:
  c:
    type: chat
`);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "chat");
    assert.equal(blocks[0]?.name, "c");
  });

  it("loadPromptBlocksFromYaml rejects blocks array", () => {
    assert.throws(() =>
      loadPromptBlocksFromYaml(`
blocks:
  - name: c
    type: chat
`),
    );
  });
});
