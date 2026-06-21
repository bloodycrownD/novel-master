/**
 * Session 级 worktree 快照端口（仅持久 worktreeDisplay）。
 *
 * @module service/prompt/session-worktree-snapshot.port
 */

/** 单次 materialize 的 worktree 快照（消费方 ②）。 */
export interface SessionWorktreeSnapshot {
  readonly worktreeDisplay: string;
  readonly refreshedAtMs: number;
}

/** Session worktree 快照存储（dirty 刷新策略）。 */
export interface SessionWorktreeSnapshotStore {
  get(projectId: string, sessionId: string): SessionWorktreeSnapshot | undefined;
  markDirty(projectId: string, sessionId: string): void;
  isDirty(projectId: string, sessionId: string): boolean;
  getOrRefresh(
    projectId: string,
    sessionId: string,
    render: () => Promise<{ readonly worktreeDisplay: string }>,
  ): Promise<SessionWorktreeSnapshot>;
  clear(projectId: string, sessionId: string): void;
}
