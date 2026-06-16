import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode, encode, ConfigDecodeError } from "@novel-master/core";

import { agentDefinitionSchema, AgentConfigError } from "@novel-master/core/agent";

import { PromptError } from "@novel-master/core/prompt";

const emptyPrompts = { persist: {}, dynamic: {} };

describe("agentDefinitionSchema", () => {
  it("parses valid document with system + persist + dynamic", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "writer",
        prompts: {
          system: "hi",
          persist: {
            persona: { type: "text", role: "user", content: "人设" },
          },
          dynamic: {},
        },
        model: "openai/gpt-4",
      },
      agentDefinitionSchema,
    );
    assert.equal(def.name, "writer");
    assert.equal(def.model, "openai/gpt-4");
    assert.equal(def.prompts.system, "hi");
    assert.equal(def.prompts.persist[0]?.name, "persona");
  });

  it("T1: rejects preferredModelId with friendly message", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: emptyPrompts,
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
            prompts: emptyPrompts,
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
        prompts: emptyPrompts,
        model: "mock/test",
      },
      agentDefinitionSchema,
    );
    const doc = encode(def, agentDefinitionSchema);
    assert.equal((doc as { model?: string }).model, "mock/test");
    const again = decode(doc, agentDefinitionSchema);
    assert.equal(again.model, "mock/test");
  });

  it("T4: persist map order matches definition.prompts.persist order", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "writer",
        prompts: {
          persist: {
            alpha: { type: "text", role: "user", content: "a" },
            beta: { type: "worktree" },
          },
          dynamic: {
            gamma: { type: "text", role: "user", content: "c" },
          },
        },
      },
      agentDefinitionSchema,
    );
    assert.deepEqual(
      def.prompts.persist.map((b) => b.name),
      ["alpha", "beta"],
    );
    assert.deepEqual(
      def.prompts.dynamic.map((b) => b.name),
      ["gamma"],
    );
  });

  it("T5: rejects prompts.blocks", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: { blocks: {} },
          },
          agentDefinitionSchema,
        ),
      (e: unknown) =>
        e instanceof AgentConfigError &&
        e.message.includes("prompts.blocks is removed"),
    );
  });

  it("A1: rejects compact field in strict schema", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: emptyPrompts,
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

  it("rejects persist text with when", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: {
              persist: {
                a: {
                  type: "text",
                  role: "user",
                  content: "x",
                  when: { present: "abstract" },
                },
              },
              dynamic: {},
            },
          },
          agentDefinitionSchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });

  it("L10-Z1: rejects lifecycle on persist text via validate", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: {
              persist: {
                a: {
                  type: "text",
                  role: "user",
                  content: "x",
                  lifecycle: "once",
                },
              },
              dynamic: {},
            },
          },
          agentDefinitionSchema,
        ),
      (e: unknown) => e instanceof ConfigDecodeError,
    );
  });

  it("L10-Z3: rejects invalid lifecycle on dynamic text block", () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "x",
            prompts: {
              persist: {},
              dynamic: {
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
