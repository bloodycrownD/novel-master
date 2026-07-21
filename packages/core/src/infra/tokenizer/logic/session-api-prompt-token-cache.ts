/**
 * 会话级 API promptTokens 进程内缓存（按 sessionId 分桶）。
 *
 * @module infra/tokenizer/logic/session-api-prompt-token-cache
 */

/** 单会话缓存条目。 */
export interface SessionApiPromptTokenCacheEntry {
  readonly promptTokens: number;
  readonly updatedAt: number;
}

const store = new Map<string, SessionApiPromptTokenCacheEntry>();

/**
 * 进程内 Map：仅 completed∧pick 写入；非 completed / FAILED / 失效 call-site 清除。
 */
export const sessionApiPromptTokenCache = {
  get(sessionId: string): SessionApiPromptTokenCacheEntry | undefined {
    return store.get(sessionId);
  },

  set(sessionId: string, entry: SessionApiPromptTokenCacheEntry): void {
    store.set(sessionId, entry);
  },

  clear(sessionId: string): void {
    store.delete(sessionId);
  },

  /** 与 {@link clear} 等价；失效 call-site 语义别名。 */
  invalidate(sessionId: string): void {
    store.delete(sessionId);
  },

  /** 测试用：清空全部会话桶。 */
  clearAll(): void {
    store.clear();
  },
} as const;
