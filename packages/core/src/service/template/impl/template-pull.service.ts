/**
 * Template pull orchestration (VFS replace + worktree replace).
 *
 * @module service/template/impl/template-pull.service
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { replaceVfsSubtree } from "@/domain/vfs/vfs-tree-copy.js";
import { SqliteWorktreeRepository } from "@/domain/worktree/repositories/impl/sqlite-worktree.repository.js";
import { mapProjectWorktreePathToSession } from "@/domain/worktree/worktree-path-map.js";
import { worktreeScopeKey } from "@/domain/worktree/worktree-scope.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { chatNotFound } from "@/errors/chat-errors.js";
import { deleteSessionFsData } from "@/service/session-fs/create-session-fs-service.js";
import type { TemplatePullService } from "../template-pull.port.js";

/**
 * Default template pull: delete target subtree then copy from parent.
 */
export class DefaultTemplatePullService implements TemplatePullService {
  constructor(private readonly conn: TdbcConnection) {}

  async projectTemplatePull(projectId: string): Promise<void> {
    await this.conn.transaction(async (tx) => {
      const vfs = new SqliteVfsEntryRepository(tx);
      const worktree = new SqliteWorktreeRepository(tx);
      await replaceVfsSubtree(
        vfs,
        "/template",
        `/projects/${projectId}/template`,
      );
      await worktree.copyScope(
        worktreeScopeKey({ kind: "global" }),
        worktreeScopeKey({ kind: "project", projectId }),
        (p) => p,
      );
    });
  }

  async sessionTemplatePull(sessionId: string): Promise<void> {
    const sessions = new SqliteSessionRepository(this.conn);
    const session = await sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }
    const projectId = session.projectId;
    await this.conn.transaction(async (tx) => {
      await deleteSessionFsData(tx, sessionId);
      const vfs = new SqliteVfsEntryRepository(tx);
      const worktree = new SqliteWorktreeRepository(tx);
      await replaceVfsSubtree(
        vfs,
        `/projects/${projectId}/template`,
        `/projects/${projectId}/sessions/${sessionId}`,
      );
      await worktree.copyScope(
        worktreeScopeKey({ kind: "project", projectId }),
        worktreeScopeKey({
          kind: "session",
          projectId,
          sessionId,
        }),
        mapProjectWorktreePathToSession,
      );
    });
  }
}
