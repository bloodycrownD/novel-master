/**
 * isUserInputMessage 单测（T-S2）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasToolResult,
  isUserInputMessage,
} from "../../src/domain/chat/logic/message-content-helpers.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";

function makeMsg(
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

describe("isUserInputMessage (T-S2)", () => {
  it("role=user + 纯 text → true", () => {
    const msg = makeMsg("user", [{ type: "text", text: "你好" }]);
    assert.equal(isUserInputMessage(msg), true);
    // hasToolResult 顺便复验：纯 text 无 tool_result
    assert.equal(hasToolResult(msg), false);
  });

  it("role=user + 含 tool_result → false", () => {
    const msg = makeMsg("user", [
      { type: "tool_result", toolUseId: "tu_1", content: "result" },
    ]);
    assert.equal(isUserInputMessage(msg), false);
    assert.equal(hasToolResult(msg), true);
  });

  it("role=assistant → false", () => {
    const msg = makeMsg("assistant", [{ type: "text", text: "我回复" }]);
    assert.equal(isUserInputMessage(msg), false);
  });
});
