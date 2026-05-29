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

  it("parses abstract prompt block", () => {
    const def = agentDefinitionFromJson({
      schemaVersion: 1,
      name: "writer",
      prompts: {
        blocks: [
          { name: "summary", type: "abstract", content: "{{.abstract}}" },
        ],
      },
      model: { applicationModelId: "openai/gpt-4" },
    });
    assert.equal(def.prompts[0]?.type, "abstract");
    if (def.prompts[0]?.type === "abstract") {
      assert.equal(def.prompts[0].content, "{{.abstract}}");
    }
  });

  it("rejects text block with when in full document", () => {
    assert.throws(
      () =>
        agentDefinitionFromJson({
          schemaVersion: 1,
          name: "x",
          prompts: {
            blocks: [
              {
                name: "a",
                type: "text",
                role: "system",
                content: "x",
                when: { present: "abstract" },
              },
            ],
          },
          model: { applicationModelId: "a/b" },
        }),
      (e: unknown) => e instanceof AgentConfigError,
    );
  });

  it("rejects abstract block with role", () => {
    assert.throws(
      () =>
        agentDefinitionFromJson({
          schemaVersion: 1,
          name: "x",
          prompts: {
            blocks: [
              {
                name: "a",
                type: "abstract",
                role: "system",
                content: "x",
              },
            ],
          },
          model: { applicationModelId: "a/b" },
        }),
      (e: unknown) => e instanceof AgentConfigError,
    );
  });

  it("rejects text block with when in full document", () => {
    assert.throws(
      () =>
        agentDefinitionFromJson({
          schemaVersion: 1,
          name: "x",
          prompts: {
            blocks: [
              {
                name: "a",
                type: "text",
                role: "system",
                content: "x",
                when: { present: "abstract" },
              },
            ],
          },
          model: { applicationModelId: "openai/gpt-4" },
        }),
      (e: unknown) => e instanceof AgentConfigError,
    );
  });

  it("accepts abstract block in full document", () => {
    const def = agentDefinitionFromJson({
      schemaVersion: 1,
      name: "writer",
      prompts: {
        blocks: [
          { name: "summary", type: "abstract", content: "{{.abstract}}" },
          { name: "history", type: "chat" },
        ],
      },
      model: { applicationModelId: "openai/gpt-4" },
    });
    assert.equal(def.prompts.length, 2);
    assert.equal(def.prompts[0]?.type, "abstract");
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
