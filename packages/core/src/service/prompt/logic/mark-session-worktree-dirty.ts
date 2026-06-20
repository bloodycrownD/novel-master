/**
 * 将会话 worktree 快照标记为 dirty。
 *
 * @module service/prompt/logic/mark-session-worktree-dirty
 */

import type { SessionWorktreeSnapshotStore } from "../session-worktree-snapshot.port.js";

/** 标记指定 session 的 worktree 快照需刷新。 */
export function markSessionWorktreeDirty(
  snapshot: SessionWorktreeSnapshotStore,
  projectId: string,
  sessionId: string,
): void {
  snapshot.markDirty(projectId, sessionId);
}
