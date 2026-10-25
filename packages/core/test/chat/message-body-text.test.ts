import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messageBodyTextFromBlocks } from "../../src/domain/chat/content/message-body-text.js";

describe("messageBodyTextFromBlocks", () => {
  it("text only → hello", () => {
    assert.equal(messageBodyTextFromBlocks([{ type: "text", text: "hello" }]), "hello");
  });

  it("text + tool_use + tool_result without JSON blob", () => {
    const body = messageBodyTextFromBlocks([
      { type: "text", text: "run tool" },
      { type: "tool_use", id: "tu_1", name: "grep", input: {} },
      { type: "tool_result", toolUseId: "tu_1", content: "hits" },
    ]);
    assert.ok(body.includes("run tool"));
    assert.match(body, /\[tool_use name=grep id=tu_1\]/);
    assert.match(body, /\[tool_result id=tu_1\]/);
    assert.ok(body.includes("hits"));
    assert.ok(!body.startsWith("{"));
  });

  it("thinking only → empty", () => {
    assert.equal(
      messageBodyTextFromBlocks([{ type: "thinking", text: "secret" }]),
      "",
    );
  });

  it("image → [image]", () => {
    assert.equal(
      messageBodyTextFromBlocks([
        {
          type: "image",
          source: { kind: "url", url: "https://x.test/p.png" },
        },
      ]),
      "[image]",
    );
  });
});
