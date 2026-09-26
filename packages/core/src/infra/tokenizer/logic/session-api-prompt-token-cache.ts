/**
 * 会话级 API promptTokens 进程内缓存（按 sessionId 分桶）。
 *
 * @module infra/tokenizer/logic/session-api-prompt-token-cache
 */

/** 单会话缓存条目。 */
export interface SessionApiPromptTokenCacheEntry {
  readonly promptTokens: number;
  readonly updatedAt: number;
  /**
   * 产出该值的 run 身份（可选加固字段）。持久层（session KKV）读回时与
   * 「同一会话里当前是否还是那一轮」比对用；进程内热层透传即可。
   */
  readonly runId?: string;
  /**
   * 计数时的 savedModelId（可选指纹）。读口发现与当前请求的 savedModelId
   * 不一致即当 miss——换模型后旧口径的 prompt 占用不再适用。
   */
  readonly savedModelId?: string;
  /** 写入时该会话的末尾消息 seq（自检/调试用，不参与判定）。 */
  readonly lastMessageSeq?: number;
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
