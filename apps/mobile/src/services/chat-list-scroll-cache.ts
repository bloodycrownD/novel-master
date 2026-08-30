/**
 * In-memory chat list scroll snapshots per project+session (survives MessageList remount).
 */
import {createScopeKeyCache} from './scope-key-cache';

export type ChatListScrollSnapshot = {
  readonly offsetY: number;
  readonly nearBottom: boolean;
};

const cache = createScopeKeyCache<ChatListScrollSnapshot>({maxEntries: 500});

export function scrollCacheKey(projectId: string, sessionId: string): string {
  return cache.key(projectId, sessionId);
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
  cache.clear(key);
}

/** 项目删除后按前缀清理其全部会话快照。 */
export function clearScrollSnapshotsByProject(projectId: string): void {
  cache.clearByProjectPrefix(projectId);
}

/** Test-only: reset process-wide cache between cases. */
export function clearAllScrollSnapshots(): void {
  cache.clearAll();
}

/** Test-only: entry count for LRU-bound assertions. */
export function scrollSnapshotCacheSize(): number {
  return cache.size;
}
