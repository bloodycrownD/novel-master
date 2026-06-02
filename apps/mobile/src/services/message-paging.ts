import type {ChatMessage} from '@novel-master/core';

/**
 * Merge "older" messages before the currently displayed list.
 *
 * WHY: paging fetch returns older history; chat timeline is ascending by `seq`.
 */
export function prependOlderMessages(
  current: readonly ChatMessage[],
  older: readonly ChatMessage[],
): ChatMessage[] {
  if (older.length === 0) {
    return [...current];
  }
  if (current.length === 0) {
    return [...older];
  }
  return [...older, ...current];
}

