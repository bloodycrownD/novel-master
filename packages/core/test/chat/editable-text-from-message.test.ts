import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractEditableTextFromMessage,
  isPlainUserUndoSendEligible,
  textBlocks,
} from "@novel-master/core/chat";
import type { ChatMessage } from "@novel-master/core/chat";

function stubMessage(
  overrides: Partial<ChatMessage> & Pick<ChatMessage, "role" | "content">,
): ChatMessage {
  return {
    id: "msg-1",
    sessionId: "sess-1",
    seq: 1,
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
    ...overrides,
  };
}

describe("extractEditableTextFromMessage", () => {
  it("T-C2: 多 text 块以双换行拼接", () => {
    const message = stubMessage({
      role: "user",
      content: {
        blocks: [
          { type: "text", text: "  hello  " },
          { type: "text", text: "world" },
        ],
      },
    });
    assert.equal(extractEditableTextFromMessage(message), "hello\n\nworld");
  });

  it("纯 tool_result user 不可提取文本", () => {
    const message = stubMessage({
      role: "user",
      content: {
        blocks: [{ type: "tool_result", toolUseId: "tu1", content: "ok" }],
      },
    });
    assert.equal(extractEditableTextFromMessage(message), null);
  });

  it("空白 text 块返回 null", () => {
    const message = stubMessage({
      role: "user",
      content: { blocks: [{ type: "text", text: "   " }] },
    });
    assert.equal(extractEditableTextFromMessage(message), null);
  });
});

describe("isPlainUserUndoSendEligible", () => {
  it("T-C1: user_vfs_action 排除", () => {
    const message = stubMessage({
      role: "user",
      content: textBlocks("<user_vfs_action>write</user_vfs_action>"),
      raw: {
        metadata: { kind: "user_vfs_action", source: "user", synthetic: true },
      },
    });
    assert.equal(isPlainUserUndoSendEligible(message), false);
  });

  it("T-C3: 纯 tool_result user 不可 Undo Send", () => {
    const message = stubMessage({
      role: "user",
      content: {
        blocks: [{ type: "tool_result", toolUseId: "tu1", content: "ok" }],
      },
    });
    assert.equal(isPlainUserUndoSendEligible(message), false);
  });

  it("plain user 文本 eligible", () => {
    const message = stubMessage({
      role: "user",
      content: textBlocks("prompt"),
    });
    assert.equal(isPlainUserUndoSendEligible(message), true);
  });

  it("assistant 不可 Undo Send", () => {
    const message = stubMessage({
      role: "assistant",
      content: textBlocks("reply"),
    });
    assert.equal(isPlainUserUndoSendEligible(message), false);
  });
});
