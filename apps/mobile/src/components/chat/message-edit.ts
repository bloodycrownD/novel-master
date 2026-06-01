/**
 * Helpers for in-app message edit (text-only content) and long-press menu items.
 */
import type {ChatMessage} from '@novel-master/core';

export interface MessageActionMenuItem {
  readonly label: string;
  readonly action: string;
  readonly danger?: boolean;
}

/** Returns user-visible text for edit (excludes thinking / tools). */
export function editableTextFromMessage(message: ChatMessage): string | null {
  const blocks = message.content.blocks ?? [];
  if (blocks.length === 0) {
    return null;
  }
  if (!blocks.every(b => b.type === 'text' || b.type === 'thinking')) {
    return null;
  }
  const parts = blocks
    .filter((b): b is Extract<typeof b, {type: 'text'}> => b.type === 'text')
    .map(b => b.text.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/** Builds long-press actions: edit when allowed, hide/unhide toggle, delete. */
export function buildMessageActionItems(
  message: ChatMessage,
): MessageActionMenuItem[] {
  const items: MessageActionMenuItem[] = [];
  if (editableTextFromMessage(message) != null) {
    items.push({label: '编辑', action: 'edit'});
  }
  if (message.hidden) {
    items.push({label: '取消隐藏', action: 'unhide'});
  } else {
    items.push({label: '隐藏', action: 'hide'});
  }
  items.push({label: '删除', action: 'delete', danger: true});
  return items;
}
