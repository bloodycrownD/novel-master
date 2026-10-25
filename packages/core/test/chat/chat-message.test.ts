/**
 * isUserInputMessage 单测（T-S2）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChatMessage } from "../../src/domain/chat/logic/message/chat-message.js";
import { parseAttachmentsJson, NO_PATH_ATTACHMENT_NAME } from "../../src/domain/chat/model/message-attachment.schema.js";
import type { ChatMessageData } from "../../src/domain/chat/model/message.js";

function makeMsg(
  role: string,
  blocks: ChatMessageData["content"]["blocks"],
  attachments?: ChatMessageData["attachments"],
): ChatMessageData {
  return {
    id: "m1",
    sessionId: "s1",
    seq: 1,
    role,
    content: { blocks },
    ...(attachments != null ? { attachments } : {}),
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

describe("isUserInputMessage (T-S2)", () => {
  it("role=user + 纯 text → true", () => {
    const msg = makeMsg("user", [{ type: "text", text: "你好" }]);
    assert.equal(ChatMessage.from(msg).isUserInput(), true);
    // hasToolResult 顺便复验：纯 text 无 tool_result
    assert.equal(ChatMessage.from(msg).hasToolResult(), false);
  });

  it("role=user + 含 tool_result → false", () => {
    const msg = makeMsg("user", [
      { type: "tool_result", toolUseId: "tu_1", content: "result" },
    ]);
    assert.equal(ChatMessage.from(msg).isUserInput(), false);
    assert.equal(ChatMessage.from(msg).hasToolResult(), true);
  });

  it("role=assistant → false", () => {
    const msg = makeMsg("assistant", [{ type: "text", text: "我回复" }]);
    assert.equal(ChatMessage.from(msg).isUserInput(), false);
  });

  // 消费链 #2 的观测面：批注附件被整数组判废 ⇒ hasAnnotateAttachment 恒 false
  // ⇒ isPlainUserText 语义偏移 ⇒ 回滚拿不到批注意见。逐条降级后应只认存活那条。
  it("MA-5: 部分非法附件下 hasAnnotateAttachment 仍认存活的那条批注", () => {
    const attachments = parseAttachmentsJson(
      JSON.stringify([
        {
          name: "/bad.md",
          source: "user_ops",
          type: "text",
          content: null,
          path: "/bad.md",
          action: "annotate",
          extra: 1,
        },
        {
          name: NO_PATH_ATTACHMENT_NAME,
          source: "user_ops",
          type: "text",
          content: null,
          action: "annotate",
        },
      ]),
    );
    assert.ok(attachments != null, "部分非法不应让 attachments 整体缺席");
    const msg = makeMsg("user", [{ type: "text", text: "" }], attachments);
    assert.equal(
      ChatMessage.from(msg).hasAnnotateAttachment(),
      true,
      "整数组判废会让 hasAnnotateAttachment 恒 false、回滚批注恢复不回来",
    );
    assert.equal(
      ChatMessage.from(msg).isPlainUserText(),
      true,
      "只有批注的 user 消息仍应按 plain user 处理（连续 user 守卫依赖它）",
    );
  });
});
