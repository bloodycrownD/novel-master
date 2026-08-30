/**
 * In-memory per-session message tail + paging flag (survives list ↔ conversation).
 */
import {type ChatMessage} from '@novel-master/core/chat';
import {createScopeKeyCache} from './scope-key-cache';

export type SessionViewCache = {
  readonly messages: readonly ChatMessage[];
  readonly hasMoreMessages: boolean;
};

const cache = createScopeKeyCache<SessionViewCache>({maxEntries: 500});

export function sessionViewCacheKey(
  projectId: string,
  sessionId: string,
): string {
  return cache.key(projectId, sessionId);
}

export function getSessionViewCache(key: string): SessionViewCache | undefined {
  return cache.get(key);
}

export function setSessionViewCache(
  key: string,
  entry: SessionViewCache,
): void {
  cache.set(key, entry);
}

export function clearSessionViewCache(key: string): void {
  cache.clear(key);
}

/** 项目删除后按前缀清理其全部会话缓存（消息 tail 不残留）。 */
export function clearSessionViewCachesByProject(projectId: string): void {
  cache.clearByProjectPrefix(projectId);
}

/** Test-only: reset process-wide cache between cases. */
export function clearAllSessionViewCaches(): void {
  cache.clearAll();
}

/** Test-only: entry count for LRU-bound assertions. */
export function sessionViewCacheSize(): number {
  return cache.size;
}
