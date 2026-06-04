/**
 * Session worktree snapshot helpers: unified macro cache for list + display.
 *
 * @module services/worktree-snapshot.service
 */
import type {SessionMacroSnapshot} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';

export interface SessionWorktreeSnapshotScope {
  readonly projectId: string;
  readonly sessionId: string;
}

function hasMaterializedListRows(
  snapshot: SessionMacroSnapshot | undefined,
): snapshot is SessionMacroSnapshot {
  return snapshot != null && Array.isArray(snapshot.listRows);
}

/**
 * Returns cached session worktree snapshot or materializes and stores one.
 * Treats snapshots missing `listRows` as a cache miss.
 */
export async function getOrRefreshSessionWorktreeSnapshot(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorktreeSnapshotScope,
): Promise<SessionMacroSnapshot> {
  const cached = runtime.macroCache.get(scope.projectId, scope.sessionId);
  if (hasMaterializedListRows(cached)) {
    return cached;
  }
  const wt = runtime.worktree({
    kind: 'session',
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  });
  return runtime.macroCache.refresh(
    scope.projectId,
    scope.sessionId,
    () => wt.materialize(),
  );
}

/** Clears session worktree snapshot after VFS or rule mutations. */
export function invalidateSessionWorktreeSnapshot(
  runtime: MobileNovelMasterRuntime,
  projectId: string,
  sessionId: string,
): void {
  runtime.macroCache.clear(projectId, sessionId);
}
