/**
 * Display floor (1-based list index) vs internal `seq`.
 *
 * Floor is computed at read time from messages ordered by `seq`; it is not stored.
 * After deletes, floors stay contiguous while `seq` may have gaps.
 *
 * @module message/floor
 */

import type { ChatMessage } from "@novel-master/core";

/**
 * Maps inclusive floor range to internal `seq` for repository range updates.
 *
 * @param messages - Session messages in `seq` order (as from `listBySession`)
 * @throws Error when floors are invalid or out of range
 */
export function seqRangeFromFloors(
  messages: readonly ChatMessage[],
  fromFloor: number,
  toFloor: number,
): { fromSeq: number; toSeq: number } {
  if (messages.length === 0) {
    throw new Error("Session has no messages");
  }
  if (
    !Number.isInteger(fromFloor) ||
    !Number.isInteger(toFloor) ||
    fromFloor < 1 ||
    toFloor < 1
  ) {
    throw new Error("Floor numbers must be positive integers");
  }
  if (fromFloor > toFloor) {
    throw new Error(
      `from-floor (${fromFloor}) must be <= to-floor (${toFloor})`,
    );
  }
  if (toFloor > messages.length) {
    throw new Error(
      `to-floor ${toFloor} exceeds message count ${messages.length}`,
    );
  }
  const fromMsg = messages[fromFloor - 1]!;
  const toMsg = messages[toFloor - 1]!;
  return { fromSeq: fromMsg.seq, toSeq: toMsg.seq };
}
