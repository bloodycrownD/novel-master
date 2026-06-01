/**
 * Tail-based depth indexing over visible messages (newest = depth 0).
 *
 * @module domain/depth/logic/depth-from-tail
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { listVisibleSorted } from "@/domain/chat/logic/message-visible-floor.js";

/** Depth from the newest visible message: last message has depth 0. */
export function depthFromTailIndex(visibleCount: number, indexFromOldest: number): number {
  return visibleCount - 1 - indexFromOldest;
}

/** Maps each visible message id to its tail depth (0 = newest). */
export function depthByMessageId(
  visibleMessages: readonly ChatMessage[],
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  const n = visibleMessages.length;
  for (let i = 0; i < n; i++) {
    map.set(visibleMessages[i]!.id, depthFromTailIndex(n, i));
  }
  return map;
}

/** Visible messages sorted by seq, excluding hidden. */
export function listVisibleForDepth(
  allMessages: readonly ChatMessage[],
): ChatMessage[] {
  return listVisibleSorted(allMessages);
}
