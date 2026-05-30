import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentDefinitionFromJson,
  agentDefinitionToJson,
  AgentConfigError,
} from "@novel-master/core";

describe("agentDefinitionFromJson", () => {
  it("parses valid document with blocks map", () => {
    const def = agentDefinitionFromJson({
      schemaVersion: 1,
      name: "writer",
      prompts: {
        blocks: {
          s: { type: "text", role: "system", content: "hi" },
        },
      },
      model: "openai/gpt-4",
    });
    assert.equal(def.name, "writer");
    assert.equal(def.model, "openai/gpt-4");
    assert.equal(def.prompts[0]?.name, "s");
  });

  it("T1: rejects preferredModelId with friendly message", () => {
    assert.throws(
      () =>
        agentDefinitionFromJson({
          schemaVersion: 1,
          name: "x",
          prompts: { blocks: {} },
          preferredModelId: "a/b",
        }),
      (e: unknown) =>
        e instanceof AgentConfigError &&
        e.code === "INVALID_SCHEMA" &&
        /model/.test(e.message),
    );
  });

  it("T2: rejects legacy nested model object", () => {
    assert.throws(
      () =>
        agentDefinitionFromJson({
          schemaVersion: 1,
          name: "x",
          prompts: { blocks: {} },
          model: { applicationModelId: "a/b" },
        }),
      (e: unknown) =>
        e instanceof AgentConfigError &&
        e.code === "INVALID_SCHEMA" &&
        /legacy nested model/.test(e.message),
    );
  });

  it("T3: model string round-trips via toJson", () => {
    const def = agentDefinitionFromJson({
      schemaVersion: 1,
      name: "x",
      prompts: { blocks: {} },
      model: "mock/test",
    });
    const doc = agentDefinitionToJson(def);
    assert.equal(doc.model, "mock/test");
    const again = agentDefinitionFromJson(doc);
    assert.equal(again.model, "mock/test");
  });

  it("T4: blocks map order matches definition.prompts order", () => {
    const def = agentDefinitionFromJson({
      schemaVersion: 1,
      name: "writer",
      prompts: {
        blocks: {
          alpha: { type: "text", role: "system", content: "a" },
          beta: { type: "chat" },
          gamma: { type: "abstract", content: "{{.abstract}}" },
        },
      },
    });
    assert.deepEqual(
      def.prompts.map((b) => b.name),
      ["alpha", "beta", "gamma"],
    );
  });

  it("T5: rejects blocks array at schema layer", () => {
    assert.throws(
      () =>
        agentDefinitionFromJson({
          schemaVersion: 1,
          name: "x",
          prompts: {
            blocks: [{ name: "a", type: "chat" }],
          },
        }),
      (e: unknown) => e instanceof AgentConfigError,
    );
  });

  it("A1: rejects compact field in strict schema", () => {
    assert.throws(
      () =>
        agentDefinitionFromJson({
          schemaVersion: 1,
          name: "x",
          prompts: { blocks: {} },
          model: "a/b",
          compact: {
            trigger: { tokenThreshold: 100 },
            action: { keepLastN: 3, abstract: { type: "agent", agentId: "s" } },
          },
        }),
      (e: unknown) => e instanceof AgentConfigError && e.code === "INVALID_SCHEMA",
    );
  });

  it("parses abstract prompt block in map", () => {
    const def = agentDefinitionFromJson({
      schemaVersion: 1,
      name: "writer",
      prompts: {
        blocks: {
          summary: { type: "abstract", content: "{{.abstract}}" },
        },
      },
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
            blocks: {
              a: {
                type: "text",
                role: "system",
                content: "x",
                when: { present: "abstract" },
              },
            },
          },
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
            blocks: {
              a: {
                type: "abstract",
                role: "system",
                content: "x",
              },
            },
          },
        }),
      (e: unknown) => e instanceof AgentConfigError,
    );
  });
});
