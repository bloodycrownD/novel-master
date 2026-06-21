/**
 * Session worktree 快照 helpers（list + display 统一存储）。
 *
 * @module services/worktree-snapshot.service
 */
import { type SessionWorktreeSnapshot } from "@novel-master/core/worktree";
import type {MobileNovelMasterRuntime} from '../runtime/types';

export interface SessionWorktreeSnapshotScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/**
 * 返回已缓存快照，或在 dirty / miss 时 materialize 并写入 store。
 */
export async function getOrRefreshSessionWorktreeSnapshot(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorktreeSnapshotScope,
): Promise<SessionWorktreeSnapshot> {
  const wt = runtime.worktree({
    kind: 'session',
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  });
  return runtime.worktreeSnapshot.getOrRefresh(
    scope.projectId,
    scope.sessionId,
    () => wt.materializePersistBlock(),
  );
}

/** VFS 或规则变更后标记 session worktree 快照为 dirty。 */
export function invalidateSessionWorktreeSnapshot(
  runtime: MobileNovelMasterRuntime,
  projectId: string,
  sessionId: string,
): void {
  runtime.worktreeSnapshot.markDirty(projectId, sessionId);
}
