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

  it("accepts abstract block", () => {
    const blocks = validatePromptBlocks({
      summary: {
        type: "abstract",
        content: "{{.abstract}}",
      },
    });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "abstract");
    assert.equal(blocks[0]?.name, "summary");
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
