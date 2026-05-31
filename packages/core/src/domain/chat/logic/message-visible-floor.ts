/**
 * Visible-message floor indexing (hidden excluded; aligns with compaction triggers).
 *
 * @module domain/chat/message-visible-floor
 */

import type { ChatMessage } from "./model/message.js";

/**
 * Session messages visible to LLM/prompt, sorted by `seq` ascending.
 *
 * @param messages - Full session list from `listBySession` (seq order)
 */
export function listVisibleSorted(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  return messages.filter((m) => !m.hidden);
}

/**
 * 1-based floor per visible message id; hidden messages are omitted.
 *
 * @param messages - Full session list from `listBySession` (seq order)
 */
export function visibleFloorByMessageId(
  messages: readonly ChatMessage[],
): Map<string, number> {
  const map = new Map<string, number>();
  let floor = 0;
  for (const m of messages) {
    if (m.hidden) {
      continue;
    }
    floor += 1;
    map.set(m.id, floor);
  }
  return map;
}
