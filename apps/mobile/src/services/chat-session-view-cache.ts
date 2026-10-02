/**
 * In-memory per-session message tail + paging flag (survives list ↔ conversation).
 */
import {type ChatMessage} from '@novel-master/core/chat';
import {createScopeKeyCache} from './scope-key-cache';

export type SessionViewCache = {
  readonly messages: readonly ChatMessage[];
  readonly hasMoreMessages: boolean;
};

/**
 * view-cache 命中采纳进消息面时的窗口大小（条数）：对齐消息管线的分页
 * 大小（SESSION_STREAM_MESSAGES_PAGE_SIZE）「一屏 + 缓冲」的口径。
 */
export const SESSION_VIEW_HYDRATE_WINDOW = 40;

/**
 * view-cache 命中采纳时的窗口裁剪：只取尾部 {@link SESSION_VIEW_HYDRATE_WINDOW} 条。
 *
 * 缓存里存的是「浏览史全量」——向上翻页每次 prepend 都会把整个消息面写回，
 * 单调增长；但 UI 开屏只需要一屏。热重进若整面采纳浏览史，水合、re-render
 * 传参、快照 prescan、分片流的载荷全部随浏览史膨胀（大会话「进得越深、
 * 重进越卡」的根因）。裁掉后 hasMore 相应置真（窗口外还有更早的，向上翻
 * 页按 DB 分页照常补齐——loadOlder 以消息面首行 seq 为锚，不依赖缓存）。
 */
export function hydrateWindowFromCache(entry: SessionViewCache): SessionViewCache {
  if (entry.messages.length <= SESSION_VIEW_HYDRATE_WINDOW) {
    return entry;
  }
  return {
    messages: entry.messages.slice(-SESSION_VIEW_HYDRATE_WINDOW),
    hasMoreMessages: true,
  };
}

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
