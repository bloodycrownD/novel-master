/**
 * 从 project template 初始化 session 工作区（VFS replace + worktree copyScope）。
 *
 * @module service/template/logic/initialize-session-workspace
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { VfsTreeCopy } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { WorkplacePathMap } from "@/domain/workplace/logic/workplace-path-map.js";
import { WorkplaceScope } from "@/domain/workplace/logic/workplace-scope.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import { SessionFsServiceFactory } from "@/service/session-fs/create-session-fs-service.js";

interface InitializeSessionWorkspaceOptions {
    /** pull 时清空 message checkpoint；create 时不清。 */
    readonly clearCheckpoints: boolean;
}

/** session 工作区初始化集合（pull 时从 project template 重置 VFS/worktree）。 */
export const SessionWorkspaceInit = {
    /**
   * 将会话 VFS/worktree 重置为当前 project template 快照。
   */
    async initialize(tx: TdbcConnection, projectId: string, sessionId: string, options: InitializeSessionWorkspaceOptions): Promise<void> {
        if (options.clearCheckpoints) {
            await SessionFsServiceFactory.deleteData(tx, projectId, sessionId);
        }
    const vfs = new SqliteVfsEntryRepository(tx);
    const revisions = new SqliteVfsRevisionRepository(tx);
    const worktree = new SqliteWorkplaceRepository(tx);
    await VfsTreeCopy.replaceSubtree({ repo: vfs, from: { scope: { scopeKey: `project:${projectId}` }, pathPrefix: "/" }, to: { scope: { scopeKey: `session:${projectId}:${sessionId}` }, pathPrefix: "/" },
        revisions,
        contentStore: new SqliteVfsContentStore(tx),
        // 技能已重定位到独立 meta 域，project 域全部内容都带入 session，无需排除项
    });
        await worktree.copyScope(WorkplaceScope.key({ kind: "project", projectId }), WorkplaceScope.key({ kind: "session", projectId, sessionId }), WorkplacePathMap.mapProjectToSession);
    },
} as const;
