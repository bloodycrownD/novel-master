import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PromptError, validatePromptBlocks } from "@novel-master/core";

describe("validatePromptBlocks", () => {
  it("accepts text + chat + text in map key order", () => {
    const blocks = validatePromptBlocks({
      system_msg: {
        type: "text",
        role: "system",
        content: "hi",
      },
      history: { type: "chat" },
      user_query: {
        type: "text",
        role: "user",
        content: "q",
      },
    });
    assert.equal(blocks.length, 3);
    assert.deepEqual(
      blocks.map((b) => b.name),
      ["system_msg", "history", "user_query"],
    );
    assert.equal(blocks[1]?.type, "chat");
    if (blocks[1]?.type === "chat") {
      assert.equal("role" in blocks[1], false);
    }
  });

  it("T5: rejects blocks array", () => {
    assert.throws(
      () =>
        validatePromptBlocks([
          { name: "a", type: "chat" },
        ] as unknown as Record<string, unknown>),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.match(error.message, /mapping/i);
        return true;
      },
    );
  });

  it("rejects text without role", () => {
    assert.throws(
      () =>
        validatePromptBlocks({
          a: { type: "text", content: "x" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_BLOCK");
        return true;
      },
    );
  });

  it("rejects chat with content", () => {
    assert.throws(
      () =>
        validatePromptBlocks({
          a: { type: "chat", content: "must not" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_BLOCK");
        return true;
      },
    );
  });

  it("rejects unknown type", () => {
    assert.throws(
      () => validatePromptBlocks({ a: { type: "foo" } }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_BLOCK");
        return true;
      },
    );
  });

  it("rejects abstract block", () => {
    assert.throws(
      () =>
        validatePromptBlocks({
          summary: {
            type: "abstract",
            content: "{{.abstract}}",
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_BLOCK");
        assert.match(error.message, /abstract.*removed/i);
        return true;
      },
    );
  });

  it("rejects more than one chat block", () => {
    assert.throws(
      () =>
        validatePromptBlocks({
          history_a: { type: "chat" },
          history_b: { type: "chat" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_YAML");
        assert.match(error.message, /at most one chat block/i);
        return true;
      },
    );
  });

  it("L1: parses lifecycle once on user text block", () => {
    const blocks = validatePromptBlocks({
      kick: {
        type: "text",
        role: "user",
        content: "继续",
        lifecycle: "once",
      },
    });
    assert.equal(blocks.length, 1);
    if (blocks[0]?.type === "text") {
      assert.equal(blocks[0].lifecycle, "once");
    }
  });

  it("L2: omits lifecycle when not set", () => {
    const blocks = validatePromptBlocks({
      a: { type: "text", role: "user", content: "x" },
    });
    if (blocks[0]?.type === "text") {
      assert.equal(blocks[0].lifecycle, undefined);
    }
  });

  it("L3: rejects invalid lifecycle", () => {
    assert.throws(
      () =>
        validatePromptBlocks({
          a: {
            type: "text",
            role: "user",
            content: "x",
            lifecycle: "foo",
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_BLOCK");
        return true;
      },
    );
  });

  it("L4: rejects lifecycle on system text block", () => {
    assert.throws(
      () =>
        validatePromptBlocks({
          a: {
            type: "text",
            role: "system",
            content: "x",
            lifecycle: "once",
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_BLOCK");
        assert.match(error.message, /system text block must not include lifecycle/);
        return true;
      },
    );
  });

  it("L5: rejects lifecycle on chat block", () => {
    assert.throws(
      () =>
        validatePromptBlocks({
          a: { type: "chat", lifecycle: "once" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_BLOCK");
        return true;
      },
    );
  });

  it("rejects when on text block", () => {
    assert.throws(
      () =>
        validatePromptBlocks({
          a: {
            type: "text",
            role: "system",
            content: "x",
            when: { present: "abstract" },
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_BLOCK");
        assert.match(error.message, /when is no longer supported/);
        return true;
      },
    );
  });
});
