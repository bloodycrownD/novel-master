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
   * 计数时的 savedModelId（可选指纹）。读口发现与当前请求的 savedModelId
   * 不一致即当 miss——换模型后旧口径的 prompt 占用不再适用。
   */
  readonly savedModelId?: string;
  /**
   * 采样时刻提示词已含的末条消息 seq（可选增量锚点，2026-09-29 加）：
   * 读口用它把「采样之后追加的消息」折成增量估算加回（metric 基线+增量
   * 同款）。与此前被移除的「末尾消息 seq」死字段不同——这个有真实读取方。
   */
  readonly anchorSeq?: number;
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
