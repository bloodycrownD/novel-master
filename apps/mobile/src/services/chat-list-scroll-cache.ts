/**
 * In-memory chat list scroll snapshots per project+session (survives MessageList remount).
 */

export type ChatListScrollSnapshot = {
  readonly offsetY: number;
  readonly nearBottom: boolean;
};

const cache = new Map<string, ChatListScrollSnapshot>();

export function scrollCacheKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

export function getScrollSnapshot(
  key: string,
): ChatListScrollSnapshot | undefined {
  return cache.get(key);
}

export function setScrollSnapshot(
  key: string,
  snap: ChatListScrollSnapshot,
): void {
  cache.set(key, snap);
}

export function clearScrollSnapshot(key: string): void {
  cache.delete(key);
}

/** Test-only: reset process-wide cache between cases. */
export function clearAllScrollSnapshots(): void {
  cache.clear();
}
