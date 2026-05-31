import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messageBodyTextFromContent } from "../../src/domain/chat/content/message-body-text.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import { messageBodyText } from "../../src/domain/prompt/logic/message-body.js";

function chatMessage(blocks: ChatMessage["content"]["blocks"]): ChatMessage {
  return {
    id: "m1",
    sessionId: "s1",
    seq: 1,
    role: "user",
    content: { blocks },
    provider: null,
    raw: null,
    createdAtMs: 1,
    hidden: false,
  };
}

describe("messageBodyText", () => {
  it("text only â†?hello", () => {
    assert.equal(
      messageBodyTextFromContent({ blocks: [{ type: "text", text: "hello" }] }),
      "hello",
    );
  });

  it("text + tool_use + tool_result without JSON blob", () => {
    const body = messageBodyTextFromContent({
      blocks: [
        { type: "text", text: "run tool" },
        { type: "tool_use", id: "tu_1", name: "grep", input: {} },
        { type: "tool_result", toolUseId: "tu_1", content: "hits" },
      ],
    });
    assert.ok(body.includes("run tool"));
    assert.match(body, /\[tool_use name=grep id=tu_1\]/);
    assert.match(body, /\[tool_result id=tu_1\]/);
    assert.ok(body.includes("hits"));
    assert.ok(!body.startsWith("{"));
  });

  it("thinking only â†?empty", () => {
    assert.equal(
      messageBodyTextFromContent({
        blocks: [{ type: "thinking", text: "secret" }],
      }),
      "",
    );
  });

  it("image â†?[image]", () => {
    assert.equal(
      messageBodyTextFromContent({
        blocks: [
          {
            type: "image",
            source: { kind: "url", url: "https://x.test/p.png" },
          },
        ],
      }),
      "[image]",
    );
  });

  it("ChatMessage wrapper", () => {
    assert.equal(
      messageBodyText(
        chatMessage([{ type: "text", text: "via message" }]),
      ),
      "via message",
    );
  });
});
