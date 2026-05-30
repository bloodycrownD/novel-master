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
      preferredModelId: "openai/gpt-4",
    });
    assert.equal(def.name, "writer");
  });

  it("D1: rejects legacy model field in strict schema", () => {
    assert.throws(
      () =>
        agentDefinitionFromJson({
          schemaVersion: 1,
          name: "x",
          prompts: { blocks: [] },
          model: { applicationModelId: "a/b" },
        }),
      (e: unknown) => e instanceof AgentConfigError && e.code === "INVALID_SCHEMA",
    );
  });

  it("A1: rejects compact field in strict schema", () => {
    assert.throws(
      () =>
        agentDefinitionFromJson({
          schemaVersion: 1,
          name: "x",
          prompts: { blocks: [] },
          preferredModelId: "a/b",
          compact: {
            trigger: { tokenThreshold: 100 },
            action: { keepLastN: 3, abstract: { type: "agent", agentId: "s" } },
          },
        }),
      (e: unknown) => e instanceof AgentConfigError && e.code === "INVALID_SCHEMA",
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
      preferredModelId: "openai/gpt-4",
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
          preferredModelId: "a/b",
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
          preferredModelId: "a/b",
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
      preferredModelId: "openai/gpt-4",
    });
    assert.equal(def.prompts.length, 2);
    assert.equal(def.prompts[0]?.type, "abstract");
  });
});
