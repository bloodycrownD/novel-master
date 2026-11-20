import {type ChatMessageData} from '@novel-master/core/chat';

export namespace MessagePaging {
  /**
   * Merge "older" messages before the currently displayed list.
   *
   * WHY: paging fetch returns older history; chat timeline is ascending by `seq`.
   */
  export function prependOlder(current: readonly ChatMessageData[], older: readonly ChatMessageData[]): ChatMessageData[] {
    if (older.length === 0) {
      return [...current];
    }
    if (current.length === 0) {
      return [...older];
    }
    return [...older, ...current];
  }
}
