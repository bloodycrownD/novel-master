import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentDefinitionSchema,
  decode,
  encode,
  parseText,
  stringifyText,
} from "@novel-master/core";

describe("agent definition serialization", () => {
  it("round-trips YAML with persist + dynamic map", () => {
    const yaml = `
schemaVersion: 1
name: test
model: anthropic/claude
prompts:
  system: hello
  persist:
    persona:
      type: text
      role: user
      content: 人设
  dynamic: {}
`;
    const def = decode(parseText(yaml, "yaml"), agentDefinitionSchema);
    assert.equal(def.name, "test");
    assert.equal(def.model, "anthropic/claude");
    assert.equal(def.prompts.system, "hello");
    const out = stringifyText(encode(def, agentDefinitionSchema), "yaml");
    const again = decode(parseText(out, "yaml"), agentDefinitionSchema);
    assert.equal(again.prompts.persist[0]?.name, "persona");
  });

  it("L10: lifecycle once written on encode in dynamic; always omitted", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "lifecycle",
        prompts: {
          persist: {},
          dynamic: {
            kick: {
              type: "text",
              role: "user",
              content: "继续",
              lifecycle: "once",
            },
            ctx: { type: "text", role: "user", content: "{{$time}}" },
          },
        },
      },
      agentDefinitionSchema,
    );
    const yaml = stringifyText(encode(def, agentDefinitionSchema), "yaml");
    assert.match(yaml, /lifecycle:\s*once/);
    assert.doesNotMatch(yaml, /lifecycle:\s*always/);
    const doc = encode(def, agentDefinitionSchema) as {
      prompts?: { dynamic?: Record<string, Record<string, unknown>> };
    };
    assert.equal(doc.prompts?.dynamic?.ctx?.lifecycle, undefined);

    const again = decode(parseText(yaml, "yaml"), agentDefinitionSchema);
    const kick = again.prompts.dynamic.find((b) => b.name === "kick");
    assert.equal(kick?.lifecycle, "once");
    const ctx = again.prompts.dynamic.find((b) => b.name === "ctx");
    assert.equal(ctx?.lifecycle, undefined);
  });
});
