/**
 * Session 级 worktree 快照端口（仅 display + listRows）。
 *
 * @module service/prompt/session-worktree-snapshot.port
 */

import type { WorktreeListRow } from "@/domain/worktree/model/worktree-types.js";

/** 单次 materialize 的 worktree 快照。 */
export interface SessionWorktreeSnapshot {
  readonly worktreeDisplay: string;
  readonly listRows: readonly WorktreeListRow[];
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
    render: () => Promise<{
      readonly worktreeDisplay: string;
      readonly listRows: readonly WorktreeListRow[];
    }>,
  ): Promise<SessionWorktreeSnapshot>;
  clear(projectId: string, sessionId: string): void;
}
