/**
 * 从 project template 初始化 session 工作区（VFS replace + worktree copyScope）。
 *
 * @module service/template/logic/initialize-session-workspace
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { replaceVfsSubtree } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { mapProjectWorkplacePathToSession } from "@/domain/workplace/logic/workplace-path-map.js";
import { workplaceScopeKey } from "@/domain/workplace/logic/workplace-scope.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
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
  options: InitializeSessionWorkspaceOptions
): Promise<void> {
  if (options.clearCheckpoints) {
    await deleteSessionFsData(tx, sessionId, projectId);
  }
  const vfs = new SqliteVfsEntryRepository(tx);
  const revisions = new SqliteVfsRevisionRepository(tx);
  const worktree = new SqliteWorkplaceRepository(tx);
  await replaceVfsSubtree(
    vfs,
    { scopeKey: `project:${projectId}` },
    "/",
    { scopeKey: `session:${projectId}:${sessionId}` },
    "/",
    {
      revisions,
      contentStore: new SqliteVfsContentStore(tx),
      // 技能已重定位到独立 meta 域，project 域全部内容都带入 session，无需排除项
    }
  );
  await worktree.copyScope(
    workplaceScopeKey({ kind: "project", projectId }),
    workplaceScopeKey({ kind: "session", projectId, sessionId }),
    mapProjectWorkplacePathToSession
  );
}
