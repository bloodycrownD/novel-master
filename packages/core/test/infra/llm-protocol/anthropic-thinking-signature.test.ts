import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anthropicContentToBlocks,
  blocksToAnthropicContent,
  chatMessagesToAnthropic,
} from "../../../src/infra/llm-protocol/logic/anthropic-content-mapper.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";

describe("anthropic thinking signature", () => {
  it("parses thinking block with signature", () => {
    const blocks = anthropicContentToBlocks([
      {
        type: "thinking",
        thinking: "internal",
        signature: "sig-anthropic-123",
      },
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].text, "internal");
      assert.equal(blocks[0].thinkingSignature, "sig-anthropic-123");
    }
  });

  it("round-trips thinking signature on outbound content", () => {
    const api = blocksToAnthropicContent([
      {
        type: "thinking",
        text: "plan",
        thinkingSignature: "sig-out",
      },
    ]);
    assert.equal(api[0]?.type, "thinking");
    assert.equal(api[0]?.signature, "sig-out");
    const back = anthropicContentToBlocks(api);
    assert.equal(back[0]?.type, "thinking");
    if (back[0]?.type === "thinking") {
      assert.equal(back[0].thinkingSignature, "sig-out");
    }
  });

  it("parses signature-only thinking (display omitted)", () => {
    const blocks = anthropicContentToBlocks([
      { type: "thinking", thinking: "", signature: "sig-only" },
    ]);
    assert.equal(blocks.length, 1);
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].text, "");
      assert.equal(blocks[0].thinkingSignature, "sig-only");
    }
  });

  it("round-trips redacted_thinking verbatim", () => {
    const wire = [{ type: "redacted_thinking", data: "opaque-blob-xyz" }];
    const blocks = anthropicContentToBlocks(wire);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "redacted_thinking");
    if (blocks[0]?.type === "redacted_thinking") {
      assert.equal(blocks[0].data, "opaque-blob-xyz");
    }
    const api = blocksToAnthropicContent(blocks);
    assert.deepEqual(api, wire);
  });

  it("chatMessagesToAnthropic preserves thinking before tool_use with signature", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: {
          blocks: [
            {
              type: "thinking",
              text: "plan",
              thinkingSignature: "sig-turn",
            },
            {
              type: "tool_use",
              id: "tu_1",
              name: "read",
              input: { path: "/a" },
            },
          ],
        },
      },
      {
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "tu_1",
              content: "ok",
            },
          ],
        },
      },
    ];
    const out = chatMessagesToAnthropic(messages);
    const assistant = out.find((m) => m.role === "assistant");
    assert.ok(assistant);
    assert.equal(assistant!.content[0]?.type, "thinking");
    assert.equal(assistant!.content[0]?.signature, "sig-turn");
    assert.equal(assistant!.content[1]?.type, "tool_use");
  });
});
