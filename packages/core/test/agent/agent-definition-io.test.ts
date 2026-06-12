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


  it("L10: lifecycle once written on encode; always omitted", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "lifecycle",
        prompts: {
          blocks: {
            kick: {
              type: "text",
              role: "user",
              content: "继续",
              lifecycle: "once",
            },
            ctx: { type: "text", role: "user", content: "{{ .worktree }}" },
          },
        },
      },
      agentDefinitionSchema,
    );
    const yaml = stringifyText(encode(def, agentDefinitionSchema), "yaml");
    assert.match(yaml, /lifecycle:\s*once/);
    assert.doesNotMatch(yaml, /lifecycle:\s*always/);
    const doc = encode(def, agentDefinitionSchema) as {
      prompts?: { blocks?: Record<string, Record<string, unknown>> };
    };
    assert.equal(doc.prompts?.blocks?.ctx?.lifecycle, undefined);

    const again = decode(parseText(yaml, "yaml"), agentDefinitionSchema);
    const kick = again.prompts.find((b) => b.name === "kick");
    assert.equal(kick?.type, "text");
    if (kick?.type === "text") {
      assert.equal(kick.lifecycle, "once");
    }
    const ctx = again.prompts.find((b) => b.name === "ctx");
    if (ctx?.type === "text") {
      assert.equal(ctx.lifecycle, undefined);
    }
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
