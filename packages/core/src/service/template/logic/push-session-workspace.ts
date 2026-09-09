/**
 * 从 session 工作区推送回 project 模板（VFS replace + worktree copyScope）。
 *
 * 与 {@link initializeSessionWorkspace} 完全镜像的推送方向：
 * session → project 整树覆盖，workplace 目录规则随推送一并覆盖。
 * project 域没有 checkpoint / 版本链外挂（`head_version` 仅记账），
 * 因此推送不清理任何 checkpoint，也无 exclude 语义。
 *
 * @module service/template/logic/push-session-workspace
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { replaceVfsSubtree } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { mapSessionWorkplacePathToProject } from "@/domain/workplace/logic/workplace-path-map.js";
import { workplaceScopeKey } from "@/domain/workplace/logic/workplace-scope.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";

/**
 * 用当前 session 工作区整树覆盖 project 模板（文件 + workplace 规则）。
 */
export async function pushSessionWorkspace(
  tx: TdbcConnection,
  projectId: string,
  sessionId: string
): Promise<void> {
  const vfs = new SqliteVfsEntryRepository(tx);
  const revisions = new SqliteVfsRevisionRepository(tx);
  const worktree = new SqliteWorkplaceRepository(tx);
  await replaceVfsSubtree(
    vfs,
    { scopeKey: `session:${projectId}:${sessionId}` },
    "/",
    { scopeKey: `project:${projectId}` },
    "/",
    {
      revisions,
      contentStore: new SqliteVfsContentStore(tx),
    }
  );
  await worktree.copyScope(
    workplaceScopeKey({ kind: "session", projectId, sessionId }),
    workplaceScopeKey({ kind: "project", projectId }),
    mapSessionWorkplacePathToProject
  );
}
