/**
 * Helpers for in-app message edit (text-only content) and long-press menu items.
 */
import type {ChatMessage, ContentBlock, MessageContent} from '@novel-master/core';

export interface MessageActionMenuItem {
  readonly label: string;
  readonly action: string;
  readonly danger?: boolean;
}

/** Extracts editable body text (text blocks only; thinking / tool_use excluded). */
export function editableTextFromMessage(message: ChatMessage): string | null {
  const blocks = message.content.blocks ?? [];
  const parts = blocks
    .filter((b): b is Extract<typeof b, {type: 'text'}> => b.type === 'text')
    .map(b => b.text.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * Merges edited text into the first text-block slot; non-text blocks keep original order.
 */
export function applyTextEditToMessage(
  message: ChatMessage,
  newText: string,
): MessageContent {
  const blocks = message.content.blocks ?? [];
  const result: ContentBlock[] = [];
  let textReplaced = false;

  for (const block of blocks) {
    if (block.type === 'text') {
      if (!textReplaced) {
        result.push({type: 'text', text: newText});
        textReplaced = true;
      }
    } else {
      result.push(block);
    }
  }

  return {blocks: result};
}

/** Builds long-press actions: edit, hide/unhide, copy, fork, delete. */
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
  items.push({label: '复制', action: 'copy'});
  items.push({label: 'Fork', action: 'fork'});
  items.push({label: '回滚', action: 'rollback', danger: true});
  items.push({label: '删除', action: 'delete', danger: true});
  return items;
}
