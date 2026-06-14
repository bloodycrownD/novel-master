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

/** 是否为 plain user 文本（无 tool_result；用于禁用带文字发送）。 */
export function isPlainUserText(message: ChatMessage): boolean {
  if (message.role !== "user") {
    return false;
  }
  if (hasToolResult(message)) {
    return false;
  }
  return (message.content.blocks ?? []).some(
    (b) => b.type === "text" && b.text.trim().length > 0,
  );
}
