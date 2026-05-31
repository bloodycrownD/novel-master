/**
 * Helpers for in-app message edit (text-only content).
 */
import type {ChatMessage} from '@novel-master/core';

/** Returns joined text when message has only text/thinking blocks; otherwise null. */
export function editableTextFromMessage(message: ChatMessage): string | null {
  const blocks = message.content.blocks ?? [];
  if (blocks.length === 0) {
    return null;
  }
  if (!blocks.every(b => b.type === 'text' || b.type === 'thinking')) {
    return null;
  }
  const parts = blocks
    .map(b => (b.type === 'text' || b.type === 'thinking' ? b.text : ''))
    .map(t => t.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : '';
}
