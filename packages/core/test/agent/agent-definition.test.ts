import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentDefinitionFromJson,
  AgentConfigError,
} from "@novel-master/core";

describe("agentDefinitionFromJson", () => {
  it("parses valid document", () => {
    const def = agentDefinitionFromJson({
      schemaVersion: 1,
      name: "writer",
      prompts: {
        blocks: [{ name: "s", type: "text", role: "system", content: "hi" }],
      },
      model: { applicationModelId: "openai/gpt-4" },
      compact: {
        trigger: { tokenThreshold: 100 },
        action: { keepLastN: 3, abstract: { type: "agent" } },
      },
    });
    assert.equal(def.name, "writer");
    assert.equal(def.compact?.trigger.tokenThreshold, 100);
  });

  it("T8: empty trigger fails validation", () => {
    assert.throws(
      () =>
        agentDefinitionFromJson({
          schemaVersion: 1,
          name: "x",
          prompts: { blocks: [] },
          model: { applicationModelId: "a/b" },
          compact: {
            trigger: {},
            action: { keepLastN: 1, abstract: { type: "text", content: "c" } },
          },
        }),
      (e: unknown) => e instanceof AgentConfigError,
    );
  });

  it("T8: unknown trigger key fails validation", () => {
    assert.throws(
      () =>
        agentDefinitionFromJson({
          schemaVersion: 1,
          name: "x",
          prompts: { blocks: [] },
          model: { applicationModelId: "a/b" },
          compact: {
            trigger: { tokenThreshold: 1, unknownKey: 2 },
            action: { keepLastN: 1, abstract: { type: "text", content: "c" } },
          },
        }),
      (e: unknown) => e instanceof AgentConfigError,
    );
  });
});
