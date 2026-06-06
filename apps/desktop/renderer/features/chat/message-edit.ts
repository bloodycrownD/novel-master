/**
 * Helpers for message edit and action menu items.
 */
import type { ChatMessageDto, ContentBlockDto } from "../../../shared/ipc-types";

export interface MessageActionMenuItem {
  readonly label: string;
  readonly action: string;
  readonly danger?: boolean;
}

export function editableTextFromMessage(
  message: ChatMessageDto,
): string | null {
  const blocks = message.contentBlocks ?? [];
  if (blocks.length === 0) {
    return null;
  }
  if (!blocks.every((b) => b.type === "text" || b.type === "thinking")) {
    return null;
  }
  const parts = blocks
    .filter((b): b is Extract<ContentBlockDto, { type: "text" }> => b.type === "text")
    .map((b) => b.text.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export function buildMessageActionItems(
  message: ChatMessageDto,
): MessageActionMenuItem[] {
  const items: MessageActionMenuItem[] = [];
  if (editableTextFromMessage(message) != null) {
    items.push({ label: "编辑", action: "edit" });
  }
  if (message.hidden) {
    items.push({ label: "取消隐藏", action: "unhide" });
  } else {
    items.push({ label: "隐藏", action: "hide" });
  }
  items.push({ label: "复制", action: "copy" });
  items.push({ label: "分叉", action: "fork" });
  items.push({ label: "回滚到此", action: "rollback", danger: true });
  items.push({ label: "删除", action: "delete", danger: true });
  return items;
}
