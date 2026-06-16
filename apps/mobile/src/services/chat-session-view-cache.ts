/**
 * In-memory per-session message tail + paging flag (survives list ↔ conversation).
 */
import { type ChatMessage } from "@novel-master/core/chat";

export type SessionViewCache = {
  readonly messages: readonly ChatMessage[];
  readonly hasMoreMessages: boolean;
};

const cache = new Map<string, SessionViewCache>();

export function sessionViewCacheKey(
  projectId: string,
  sessionId: string,
): string {
  return `${projectId}:${sessionId}`;
}

export function getSessionViewCache(
  key: string,
): SessionViewCache | undefined {
  return cache.get(key);
}

export function setSessionViewCache(
  key: string,
  entry: SessionViewCache,
): void {
  cache.set(key, entry);
}

export function clearSessionViewCache(key: string): void {
  cache.delete(key);
}

/** Test-only: reset process-wide cache between cases. */
export function clearAllSessionViewCaches(): void {
  cache.clear();
}
