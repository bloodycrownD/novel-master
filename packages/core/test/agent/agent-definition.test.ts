import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode, encode, ConfigDecodeError } from "@novel-master/core";

import { agentDefinitionSchema, AgentConfigError } from "@novel-master/core/agent";

import { PromptError } from "@novel-master/core/prompt";

const emptyPrompts = { persist: {}, dynamic: {} };
const TEST_SAVED_MODEL = "11111111-1111-4111-8111-111111111111";

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
        model: TEST_SAVED_MODEL,
      },
      agentDefinitionSchema,
    );
    assert.equal(def.name, "writer");
    assert.equal(def.model, TEST_SAVED_MODEL);
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

  it("T3: model UUID round-trips via encode", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "x",
        prompts: emptyPrompts,
        model: TEST_SAVED_MODEL,
      },
      agentDefinitionSchema,
    );
    const doc = encode(def, agentDefinitionSchema);
    assert.equal((doc as { model?: string }).model, TEST_SAVED_MODEL);
    const again = decode(doc, agentDefinitionSchema);
    assert.equal(again.model, TEST_SAVED_MODEL);
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
      ["alpha"],
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
            model: TEST_SAVED_MODEL,
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

  // ---- RT-04：definitionToDocument 的块名塌缩（写侧裸、读侧有唯一性语义）----

  /** 最小合法 definition（域形态），追加一条同名 persist 块。 */
  function defWithDuplicatePersist() {
    const base = decode(
      {
        schemaVersion: 1,
        name: "dup-writer",
        prompts: {
          persist: {
            persona: { type: "text", role: "user", content: "人设甲" },
          },
          dynamic: {},
        },
        model: TEST_SAVED_MODEL,
      },
      agentDefinitionSchema,
    );
    return {
      ...base,
      prompts: {
        ...base.prompts,
        persist: [
          ...base.prompts.persist,
          {
            // 同名副本：wire 形态是「块名 → 块」的对象映射，必然塌缩
            name: base.prompts.persist[0]!.name,
            type: "text" as const,
            role: "user" as const,
            content: "人设乙",
          },
        ],
      },
    };
  }

  it("toWire 对重名 persist 块抛 INVALID_BLOCK（不静默塌缩）", () => {
    const def = defWithDuplicatePersist();
    assert.throws(
      () => agentDefinitionSchema.toWire(def),
      (e: unknown) =>
        e instanceof PromptError &&
        e.code === "INVALID_BLOCK" &&
        /重复的块名/.test(e.message),
    );
  });

  it("toWire 对重名 dynamic 块抛 INVALID_BLOCK", () => {
    const base = decode(
      {
        schemaVersion: 1,
        name: "dup-dyn",
        prompts: {
          persist: {},
          dynamic: {
            first: { type: "text", role: "assistant", content: "甲" },
          },
        },
        model: TEST_SAVED_MODEL,
      },
      agentDefinitionSchema,
    );
    const dup = {
      ...base,
      prompts: {
        ...base.prompts,
        dynamic: [
          ...base.prompts.dynamic,
          { ...base.prompts.dynamic[0]! },
        ],
      },
    };
    assert.throws(
      () => agentDefinitionSchema.toWire(dup),
      (e: unknown) =>
        e instanceof PromptError &&
        e.code === "INVALID_BLOCK" &&
        /重复的块名/.test(e.message),
    );
  });

  it("toWire 抛错后不改写入方对象（无副作用污染）", () => {
    const def = defWithDuplicatePersist();
    const before = JSON.stringify(def);
    assert.throws(() => agentDefinitionSchema.toWire(def));
    assert.equal(
      JSON.stringify(def),
      before,
      "toWire 抛错不得就地改写入方传入的对象",
    );
  });

  it("合法 definition（多块不重名）toWire 往返等值（既有行为不受影响）", () => {
    const again = decode(
      agentDefinitionSchema.toWire(
        decode(
          {
            schemaVersion: 1,
            name: "ok-writer",
            prompts: {
              persist: {
                persona: { type: "text", role: "user", content: "人设" },
                notes: { type: "text", role: "assistant", content: "笔记" },
              },
              dynamic: {},
            },
            model: TEST_SAVED_MODEL,
          },
          agentDefinitionSchema,
        ),
      ),
      agentDefinitionSchema,
    );
    assert.deepEqual(
      again.prompts.persist.map((b) => b.name),
      ["persona", "notes"],
    );
    assert.deepEqual(
      again.prompts.persist.map((b) => (b as { content: string }).content),
      ["人设", "笔记"],
    );
  });
});
