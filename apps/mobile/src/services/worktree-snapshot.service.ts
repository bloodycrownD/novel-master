/**
 * Session worktree 快照 helpers（仅消费方 ② 持久 worktreeDisplay）。
 *
 * 工作区 UI 列表须经 {@link WorktreeService.buildListRows} 实时读取，不得经本模块取 list。
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
