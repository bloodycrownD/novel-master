/**
 * Composer 三分支：区分 `tool_result` 用户消息与 plain user 文本。
 *
 * @module domain/chat/logic/message-content-helpers
 */

import type { ChatMessage } from "../model/message.js";

/** 消息是否含 `tool_result` 块。 */
export function hasToolResult(message: ChatMessage): boolean {
  return (message.content.blocks ?? []).some((b) => b.type === "tool_result");
}

/**
 * 消息是否为「用户在输入框里输入的消息」。
 *
 * 供 `prepareUserMessagesForPrompt` 主函数分流用：`role=user` 但含 `tool_result` 块的消息
 * 属于工具结果回传，不是用户输入，需要直接透传而不能走 wrap（wrap 会用
 * `messageBodyTextFromContent` 提取纯文本再重组为 textBlocks，丢掉 tool_result
 * block 类型）。这里复用 `hasToolResult` 做判断——只要含 tool_result 就不算用户输入。
 */
export function isUserInputMessage(message: ChatMessage): boolean {
  return message.role === "user" && !hasToolResult(message);
}

/**
 * 消息是否含批注附件（`attachments` 里有 `action:"annotate"`）。
 *
 * @remarks
 * 批注附件的 `source` 必为 `user_ops`（见 `message-attachment.schema.ts`），
 * 这里只看 `action` 即可，无需额外校验 `source`。供「只有批注、无正文」
 * 的 user 消息补判 plain user 资格用——否则连续 user 守卫会漏拦，
 * 回滚也走不到 `undo_send` 分支。
 */
export function hasAnnotateAttachment(message: ChatMessage): boolean {
  const attachments = message.attachments;
  if (!attachments || attachments.length === 0) return false;
  return attachments.some((a) => a.action === "annotate");
}

/**
 * 是否为 plain user 文本（无 tool_result；用于禁用带文字发送）。
 *
 * @remarks
 * 「只有批注、无非空 text」的 user 消息也按 plain user 处理——这样
 * Composer 的连续 user 守卫才能拦住「批注后又带文字发送」的情况。
 */
export function isPlainUserText(message: ChatMessage): boolean {
  if (message.role !== "user") {
    return false;
  }
  if (hasToolResult(message)) {
    return false;
  }
  const hasText = (message.content.blocks ?? []).some(
    (b) => b.type === "text" && b.text.trim().length > 0,
  );
  if (hasText) return true;
  return hasAnnotateAttachment(message);
}
