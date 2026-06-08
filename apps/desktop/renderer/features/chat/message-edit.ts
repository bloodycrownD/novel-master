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
  const parts = blocks
    .filter((b): b is Extract<ContentBlockDto, { type: "text" }> => b.type === "text")
    .map((b) => b.text.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** Merges edited text at first text-block position; preserves thinking / tool_use order. */
export function applyTextEditToContentBlocks(
  blocks: readonly ContentBlockDto[],
  newText: string,
): ContentBlockDto[] {
  const result: ContentBlockDto[] = [];
  let textReplaced = false;

  for (const block of blocks) {
    if (block.type === "text") {
      if (!textReplaced) {
        result.push({ type: "text", text: newText });
        textReplaced = true;
      }
    } else {
      result.push(block);
    }
  }

  return result;
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
