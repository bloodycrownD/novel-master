/**
 * 从消息提取可编辑纯文本，并判定 plain user Undo Send 资格。
 *
 * @module domain/chat/logic/editable-text-from-message
 */

import type { ChatMessage } from "../model/message.js";
import { readMessageMetadata } from "../model/message-metadata.js";
import { hasToolResult } from "./message-content-helpers.js";

/**
 * 提取可编辑正文（仅 `text` 块；thinking / tool_use 等排除）。
 *
 * @remarks 多段 text 以 `\n\n` 拼接；trim 后为空则返回 null。
 */
export function extractEditableTextFromMessage(
  message: ChatMessage,
): string | null {
  const blocks = message.content.blocks ?? [];
  const parts = blocks
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * 是否为 plain text user Undo Send 锚点（可撤销发送并恢复 Composer 原文）。
 *
 * @remarks 须排除 `user_vfs_action` synthetic 与含 `tool_result` 的 user 行。
 */
export function isPlainUserUndoSendEligible(message: ChatMessage): boolean {
  if (message.role !== "user") {
    return false;
  }
  if (hasToolResult(message)) {
    return false;
  }
  if (readMessageMetadata(message.raw)?.kind === "user_vfs_action") {
    return false;
  }
  return extractEditableTextFromMessage(message) != null;
}
