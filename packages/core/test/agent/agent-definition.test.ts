import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentDefinitionSchema,
  decode,
  encode,
  AgentConfigError,
  ConfigDecodeError,
} from "@novel-master/core";

describe("agentDefinitionSchema", () => {
  it("parses valid document with blocks map", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "writer",
        prompts: {
          blocks: {
            s: { type: "text", role: "system", content: "hi" },
          },
        },
        model: "openai/gpt-4",
      },
      agentDefinitionSchema,
    );
    assert.equal(def.name, "writer");
    assert.equal(def.model, "openai/gpt-4");
    assert.equal(def.prompts[0]?.name, "s");
  });

  it("T1: rejects preferredModelId with friendly message", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: { blocks: {} },
            preferredModelId: "a/b",
          },
          agentDefinitionSchema,
        ),
      (e: unknown) =>
        e instanceof AgentConfigError &&
        e.code === "INVALID_SCHEMA" &&
        /model/.test(e.message),
    );
  });

  it("T2: rejects legacy nested model object", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: { blocks: {} },
            model: { applicationModelId: "a/b" },
          },
          agentDefinitionSchema,
        ),
      (e: unknown) =>
        e instanceof AgentConfigError &&
        e.code === "INVALID_SCHEMA" &&
        /legacy nested model/.test(e.message),
    );
  });

  it("T3: model string round-trips via encode", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "x",
        prompts: { blocks: {} },
        model: "mock/test",
      },
      agentDefinitionSchema,
    );
    const doc = encode(def, agentDefinitionSchema);
    assert.equal((doc as { model?: string }).model, "mock/test");
    const again = decode(doc, agentDefinitionSchema);
    assert.equal(again.model, "mock/test");
  });

  it("T4: blocks map order matches definition.prompts order", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "writer",
        prompts: {
          blocks: {
            alpha: { type: "text", role: "system", content: "a" },
            beta: { type: "chat" },
            gamma: { type: "text", role: "system", content: "c" },
          },
        },
      },
      agentDefinitionSchema,
    );
    assert.deepEqual(
      def.prompts.map((b) => b.name),
      ["alpha", "beta", "gamma"],
    );
  });

  it("T5: rejects blocks array at schema layer", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: {
              blocks: [{ name: "a", type: "chat" }],
            },
          },
          agentDefinitionSchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });

  it("A1: rejects compact field in strict schema", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: { blocks: {} },
            model: "a/b",
            compact: {
              trigger: { tokenThreshold: 100 },
              action: { keepLastN: 3, abstract: { type: "agent", agentId: "s" } },
            },
          },
          agentDefinitionSchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });

  it("rejects abstract prompt block in map", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "writer",
            prompts: {
              blocks: {
                summary: { type: "abstract", content: "{{.abstract}}" },
              },
            },
          },
          agentDefinitionSchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });

  it("rejects text block with when in full document", () => {
    assert.throws(
      () =>
        decode(
          {
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
          },
          agentDefinitionSchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });

  it("rejects abstract block with role", () => {
    assert.throws(
      () =>
        decode(
          {
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
          },
          agentDefinitionSchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });

  it("L10-Z1: rejects lifecycle on system text block via schema", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: {
              blocks: {
                a: {
                  type: "text",
                  role: "system",
                  content: "x",
                  lifecycle: "once",
                },
              },
            },
          },
          agentDefinitionSchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });

  it("L10-Z2: rejects lifecycle on chat block via schema", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: {
              blocks: {
                a: { type: "chat", lifecycle: "once" },
              },
            },
          },
          agentDefinitionSchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });

  it("L10-Z3: rejects invalid lifecycle on text block via schema", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: {
              blocks: {
                a: {
                  type: "text",
                  role: "user",
                  content: "x",
                  lifecycle: "foo",
                },
              },
            },
          },
          agentDefinitionSchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });

});
