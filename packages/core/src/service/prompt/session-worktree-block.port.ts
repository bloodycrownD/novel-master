/**
 * Session 级 worktree 块端口（仅持久 worktreeDisplay）。
 *
 * @module service/prompt/session-worktree-block.port
 */

/** 单次 capture 的 worktree 块（消费方 ②）。 */
export interface SessionWorktreeBlock {
  readonly worktreeDisplay: string;
  readonly capturedAtMs: number;
}

/** Session worktree 块存储（主动 capture / 只读 getCapturedBlock）。 */
export interface SessionWorktreeBlockStore {
  /**
   * 写入已物化的 worktree 块；`worktreeDisplay` 允许空字符串。
   * 由实现写入 `capturedAtMs`。
   */
  capture(
    projectId: string,
    sessionId: string,
    block: { readonly worktreeDisplay: string },
  ): void;

  /**
   * 只读返回已 capture 的块；无条目时返回 `undefined`（不自动 capture）。
   * 已 capture 条目即使 `worktreeDisplay === ''` 也返回空字符串。
   */
  getCapturedBlock(
    projectId: string,
    sessionId: string,
  ): SessionWorktreeBlock | undefined;

  /** 清除条目（供测试使用）。 */
  clear(projectId: string, sessionId: string): void;
}
