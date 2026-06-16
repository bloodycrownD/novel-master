/**
 * message-content-helpers 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import {
  hasToolResult,
  isPlainUserText,
} from "../../src/domain/chat/logic/message-content-helpers.js";

function msg(
  role: string,
  blocks: ChatMessage["content"]["blocks"],
): ChatMessage {
  return {
    id: "m1",
    sessionId: "s1",
    seq: 1,
    role,
    content: { blocks },
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

describe("message-content-helpers", () => {
  it("hasToolResult 识别 tool_result 块", () => {
    const withResult = msg("user", [
      { type: "tool_result", toolUseId: "tu_1", content: "ok" },
    ]);
    const plain = msg("user", [{ type: "text", text: "hi" }]);
    assert.equal(hasToolResult(withResult), true);
    assert.equal(hasToolResult(plain), false);
  });

  it("isPlainUserText 仅 plain user 文本为 true", () => {
    const plain = msg("user", [{ type: "text", text: "hello" }]);
    const toolResult = msg("user", [
      { type: "tool_result", toolUseId: "tu_1", content: "ok" },
    ]);
    const assistant = msg("assistant", [{ type: "text", text: "hi" }]);
    assert.equal(isPlainUserText(plain), true);
    assert.equal(isPlainUserText(toolResult), false);
    assert.equal(isPlainUserText(assistant), false);
  });
});
