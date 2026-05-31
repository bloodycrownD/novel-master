/**
 * Helpers for in-app message edit (text-only content).
 */
import type {ChatMessage} from '@novel-master/core';

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
