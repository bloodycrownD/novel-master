import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseMessageContent,
  parseMessageContentValue,
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
    assert.ok(parsed.ok);
    assert.equal(parsed.value.blocks.length, 6);
    assert.equal(parsed.value.blocks[0]!.type, "text");
    assert.equal(parsed.value.blocks[3]!.type, "tool_use");
  });

  it("accepts thinking-only blocks (no empty text)", () => {
    const parsed = parseMessageContent(
      JSON.stringify({ blocks: [{ type: "thinking", text: "chain only" }] }),
    );
    assert.ok(parsed.ok);
    assert.equal(parsed.value.blocks.length, 1);
    assert.equal(parsed.value.blocks[0]!.type, "thinking");
  });

  it("strips legacy empty text blocks on parse and validation", () => {
    const legacy = {
      blocks: [
        { type: "thinking", text: "reasoning" },
        { type: "text", text: "" },
      ],
    };
    const parsed = parseMessageContent(JSON.stringify(legacy));
    assert.ok(parsed.ok);
    assert.equal(parsed.value.blocks.length, 1);

    const inMemory = parseMessageContentValue(legacy);
    assert.ok(inMemory.ok);
    assert.equal(inMemory.value.blocks.length, 1);
    // 不再就地改写调用方对象：归一结果是新值。
    assert.equal(legacy.blocks.length, 2);
  });

  it("rejects legacy { content } shape with CHAT_INVALID_ARGUMENT", () => {
    const parsed = parseMessageContent(JSON.stringify({ content: "x" }));
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.error.key, "CHAT_INVALID_ARGUMENT");
    assert.equal(parsed.error.code, 106001);
    assert.match(parsed.error.message, /Legacy message content shape/);
  });

  it("rejects legacy { parts } shape", () => {
    const parsed = parseMessageContent(
      JSON.stringify({ parts: [{ type: "text", text: "x" }] }),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.error.key, "CHAT_INVALID_ARGUMENT");
    assert.match(parsed.error.message, /Legacy message content shape/);
  });

  it("rejects unknown block type", () => {
    const parsed = parseMessageContent(
      JSON.stringify({ blocks: [{ type: "video", url: "x" }] }),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.error.key, "CHAT_INVALID_ARGUMENT");
  });

  it("allows empty blocks array", () => {
    const parsed = parseMessageContent(JSON.stringify({ blocks: [] }));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.blocks, []);
  });

  it("rejects invalid JSON", () => {
    const parsed = parseMessageContent("{");
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.error.key, "CHAT_INVALID_ARGUMENT");
    assert.match(parsed.error.message, /Invalid JSON in message content/);
  });

  it("parseMessageContentValue validates in memory", () => {
    const parsed = parseMessageContentValue({
      blocks: [{ type: "text", text: "ok" }],
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.blocks[0]!.type, "text");
  });

  it("rejects tool_result with non-boolean ok", () => {
    const parsed = parseMessageContent(
      JSON.stringify({
        blocks: [
          {
            type: "tool_result",
            toolUseId: "tu_1",
            content: "found",
            ok: "false",
          },
        ],
      }),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.error.key, "CHAT_INVALID_ARGUMENT");
    assert.match(parsed.error.message, /ok must be a boolean/);
  });

  it("rejects tool_result with non-string summary", () => {
    const parsed = parseMessageContent(
      JSON.stringify({
        blocks: [
          {
            type: "tool_result",
            toolUseId: "tu_1",
            content: "found",
            ok: true,
            summary: 30,
          },
        ],
      }),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.error.key, "CHAT_INVALID_ARGUMENT");
    assert.match(parsed.error.message, /summary must be a string/);
  });

  it("R3: round-trips tool_result ok and summary", () => {
    const payload = {
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu_1",
          content: "file body",
          ok: true,
          summary: "30 lines",
        },
      ],
    };
    const parsed = parseMessageContent(JSON.stringify(payload));
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.value.blocks.length, 1);
    const block = parsed.value.blocks[0]!;
    assert.equal(block.type, "tool_result");
    if (block.type !== "tool_result") {
      return;
    }
    assert.equal(block.ok, true);
    assert.equal(block.summary, "30 lines");
    assert.equal(block.content, "file body");
  });
});
