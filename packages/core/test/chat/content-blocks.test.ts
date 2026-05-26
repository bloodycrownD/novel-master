import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChatError } from "../../src/errors/chat-errors.js";
import {
  assertMessageContent,
  parseMessageContent,
} from "../../src/domain/chat/content/parse-message-content.js";

describe("parseMessageContent", () => {
  it("round-trips all five block types", () => {
    const payload = {
      blocks: [
        { type: "text", text: "hello" },
        {
          type: "image",
          source: { kind: "url", url: "https://example.com/a.png" },
        },
        {
          type: "image",
          source: {
            kind: "base64",
            mediaType: "image/png",
            data: "abc",
          },
        },
        {
          type: "tool_use",
          id: "tu_1",
          name: "grep",
          input: { pattern: "foo" },
        },
        {
          type: "tool_result",
          toolUseId: "tu_1",
          content: "found",
        },
        { type: "thinking", text: "hmm" },
      ],
    };
    const parsed = parseMessageContent(JSON.stringify(payload));
    assert.equal(parsed.blocks.length, 6);
    assert.equal(parsed.blocks[0]!.type, "text");
    assert.equal(parsed.blocks[3]!.type, "tool_use");
  });

  it("rejects legacy { content } shape", () => {
    assert.throws(
      () => parseMessageContent(JSON.stringify({ content: "x" })),
      (err: unknown) => {
        assert.ok(err instanceof ChatError);
        assert.equal(err.code, "INVALID_ARGUMENT");
        assert.match(err.message, /Legacy message content shape/);
        return true;
      },
    );
  });

  it("rejects legacy { parts } shape", () => {
    assert.throws(
      () =>
        parseMessageContent(
          JSON.stringify({ parts: [{ type: "text", text: "x" }] }),
        ),
      (err: unknown) => {
        assert.ok(err instanceof ChatError);
        assert.equal(err.code, "INVALID_ARGUMENT");
        assert.match(err.message, /Legacy message content shape/);
        return true;
      },
    );
  });

  it("rejects unknown block type", () => {
    assert.throws(() =>
      parseMessageContent(
        JSON.stringify({ blocks: [{ type: "video", url: "x" }] }),
      ),
    );
  });

  it("allows empty blocks array", () => {
    const parsed = parseMessageContent(JSON.stringify({ blocks: [] }));
    assert.deepEqual(parsed.blocks, []);
  });

  it("assertMessageContent validates in memory", () => {
    const value = { blocks: [{ type: "text", text: "ok" }] };
    assertMessageContent(value);
    assert.equal(value.blocks[0]!.type, "text");
  });
});
