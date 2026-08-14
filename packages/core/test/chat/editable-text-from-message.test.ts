import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractEditableTextFromMessage,
  hasAnnotateAttachment,
  isPlainUserText,
  isPlainUserUndoSendEligible,
  textBlocks,
} from "@novel-master/core/chat";
import type { ChatMessage, MessageAttachment } from "@novel-master/core/chat";

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

/** 构造单个 annotate 批注附件（`source` 必为 `user_ops`）。 */
function annotateAttachment(path = "/x.md"): MessageAttachment {
  return {
    name: path,
    source: "user_ops",
    type: "text",
    content: null,
    path,
    action: "annotate",
  };
}

describe("Bug3: 批注附件补判 plain user 资格", () => {
  it("T-B3-01: 只有批注附件（无 text 块）→ isPlainUserText 返回 true", () => {
    const message = stubMessage({
      role: "user",
      content: { blocks: [] },
      attachments: [annotateAttachment()],
    });
    assert.equal(isPlainUserText(message), true);
  });

  it("T-B3-02: 只有批注附件 → isPlainUserUndoSendEligible 返回 true", () => {
    const message = stubMessage({
      role: "user",
      content: { blocks: [] },
      attachments: [annotateAttachment()],
    });
    assert.equal(isPlainUserUndoSendEligible(message), true);
  });

  it("T-B3-03: 只有批注附件 → extractEditableTextFromMessage 返回 null（不改）", () => {
    const message = stubMessage({
      role: "user",
      content: { blocks: [] },
      attachments: [annotateAttachment()],
    });
    assert.equal(extractEditableTextFromMessage(message), null);
  });

  it("T-B3-04: 既有正文又有批注 → isPlainUserUndoSendEligible 返回 true（不回归）", () => {
    const message = stubMessage({
      role: "user",
      content: textBlocks("正文"),
      attachments: [annotateAttachment()],
    });
    assert.equal(isPlainUserUndoSendEligible(message), true);
  });

  it("T-B3-05: assistant 消息含批注 → isPlainUserText 返回 false（role 守卫不回归）", () => {
    const message = stubMessage({
      role: "assistant",
      content: textBlocks("reply"),
      attachments: [annotateAttachment()],
    });
    assert.equal(isPlainUserText(message), false);
  });

  it("T-B3-06: user 消息含 tool_result + 批注 → isPlainUserText 返回 false（hasToolResult 守卫不回归）", () => {
    const message = stubMessage({
      role: "user",
      content: {
        blocks: [
          { type: "tool_result", toolUseId: "tu1", content: "ok" },
        ],
      },
      attachments: [annotateAttachment()],
    });
    assert.equal(isPlainUserText(message), false);
  });

  it("T-B3-07: user_vfs_action 消息含批注 → isPlainUserUndoSendEligible 返回 false（synthetic 守卫不回归）", () => {
    const message = stubMessage({
      role: "user",
      content: textBlocks("<user_vfs_action>write</user_vfs_action>"),
      raw: {
        metadata: { kind: "user_vfs_action", source: "user", synthetic: true },
      },
      attachments: [annotateAttachment()],
    });
    assert.equal(isPlainUserUndoSendEligible(message), false);
  });

  it("T-B3-08: attachments 为空数组或 undefined → hasAnnotateAttachment 返回 false", () => {
    const emptyArray = stubMessage({
      role: "user",
      content: textBlocks("x"),
      attachments: [],
    });
    assert.equal(hasAnnotateAttachment(emptyArray), false);
    const undefined1 = stubMessage({
      role: "user",
      content: textBlocks("x"),
    });
    assert.equal(hasAnnotateAttachment(undefined1), false);
  });
});
