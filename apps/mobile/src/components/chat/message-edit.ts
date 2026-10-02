/**
 * Helpers for in-app message edit (text-only content)。
 * 消息操作菜单的条目构建已随 MessageActionMenu 退役（chat-webview-unify Step 8，
 * 2026-10-01）——web 侧 menu.ts 的 buildMenuItems 是唯一真源。
 */
import {
  type ChatMessage,
  type ContentBlock,
  type MessageContent,
  extractEditableTextFromMessage,
} from '@novel-master/core/chat';

/** Re-export Core 规则。 */
export function editableTextFromMessage(message: ChatMessage): string | null {
  return extractEditableTextFromMessage(message);
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
