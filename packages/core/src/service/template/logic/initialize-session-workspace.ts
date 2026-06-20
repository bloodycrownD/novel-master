/**
 * 从 project template 初始化 session 工作区（VFS replace + worktree copyScope）。
 *
 * @module service/template/logic/initialize-session-workspace
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { replaceVfsSubtree } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { mapProjectWorktreePathToSession } from "@/domain/worktree/logic/worktree-path-map.js";
import { worktreeScopeKey } from "@/domain/worktree/logic/worktree-scope.js";
import { SqliteWorktreeRepository } from "@/domain/worktree/repositories/impl/sqlite-worktree.repository.js";
import { deleteSessionFsData } from "@/service/session-fs/create-session-fs-service.js";

export interface InitializeSessionWorkspaceOptions {
  /** pull 时清空 message checkpoint；create 时不清。 */
  readonly clearCheckpoints: boolean;
}

/**
 * 将会话 VFS/worktree 重置为当前 project template 快照。
 */
export async function initializeSessionWorkspace(
  tx: TdbcConnection,
  projectId: string,
  sessionId: string,
  options: InitializeSessionWorkspaceOptions,
): Promise<void> {
  if (options.clearCheckpoints) {
    await deleteSessionFsData(tx, sessionId);
  }
  const vfs = new SqliteVfsEntryRepository(tx);
  const worktree = new SqliteWorktreeRepository(tx);
  await replaceVfsSubtree(
    vfs,
    `/projects/${projectId}/template`,
    `/projects/${projectId}/sessions/${sessionId}`,
  );
  await worktree.copyScope(
    worktreeScopeKey({ kind: "project", projectId }),
    worktreeScopeKey({ kind: "session", projectId, sessionId }),
    mapProjectWorktreePathToSession,
  );
}