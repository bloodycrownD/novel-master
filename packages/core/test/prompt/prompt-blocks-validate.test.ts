import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PromptError, validatePromptBlocks } from "@novel-master/core";

describe("validatePromptBlocks", () => {
  it("accepts text + chat + text in order", () => {
    const blocks = validatePromptBlocks([
      {
        name: "system_msg",
        type: "text",
        role: "system",
        content: "hi",
      },
      { name: "history", type: "chat" },
      {
        name: "user_query",
        type: "text",
        role: "user",
        content: "q",
      },
    ]);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]?.type, "text");
    assert.equal(blocks[1]?.type, "chat");
    assert.equal(blocks[2]?.type, "text");
    if (blocks[1]?.type === "chat") {
      assert.equal("role" in blocks[1], false);
    }
  });

  it("rejects text without role", () => {
    assert.throws(
      () =>
        validatePromptBlocks([
          { name: "a", type: "text", content: "x" },
        ]),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_BLOCK");
        return true;
      },
    );
  });

  it("rejects chat with role", () => {
    assert.throws(
      () =>
        validatePromptBlocks([
          { name: "a", type: "chat", role: "user" },
        ]),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_BLOCK");
        return true;
      },
    );
  });

  it("rejects unknown type", () => {
    assert.throws(
      () => validatePromptBlocks([{ name: "a", type: "foo" }]),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_BLOCK");
        return true;
      },
    );
  });
});
