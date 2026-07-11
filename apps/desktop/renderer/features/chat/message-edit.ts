/**
 * Helpers for message edit and action menu items.
 */
import type { ChatMessageDto, ContentBlockDto } from "@shared/ipc-types";

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

export function isSetFloorEligibleMessage(message: ChatMessageDto): boolean {
  return message.role === "user" || message.role === "assistant";
}

/** 长按菜单：编辑、复制、置位、分叉、回滚（无 hide/unhide/delete）。 */
export function buildMessageActionItems(
  message: ChatMessageDto,
): MessageActionMenuItem[] {
  const items: MessageActionMenuItem[] = [];
  if (editableTextFromMessage(message) != null) {
    items.push({ label: "编辑", action: "edit" });
  }
  items.push({ label: "复制", action: "copy" });
  if (isSetFloorEligibleMessage(message)) {
    items.push({ label: "置位", action: "set-floor" });
  }
  items.push({ label: "分叉", action: "fork" });
  if (!message.hidden) {
    items.push({ label: "回滚", action: "rollback", danger: true });
  }
  return items;
}
