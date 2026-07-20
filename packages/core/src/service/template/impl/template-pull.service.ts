/**
 * Template pull orchestration (VFS replace + worktree replace).
 *
 * @module service/template/impl/template-pull.service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { replaceVfsSubtree } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import { workplaceScopeKey } from "@/domain/workplace/logic/workplace-scope.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { chatNotFound } from "@/errors/chat-errors.js";
import { initializeSessionWorkspace } from "@/service/template/logic/initialize-session-workspace.js";
import type { TemplatePullService } from "../template-pull.port.js";

/**
 * Default template pull: delete target subtree then copy from parent.
 */
export class DefaultTemplatePullService implements TemplatePullService {
  constructor(private readonly conn: TdbcConnection) {}

  async projectTemplatePull(projectId: string): Promise<void> {
    await this.conn.transaction(async (tx) => {
      const vfs = new SqliteVfsEntryRepository(tx);
      const worktree = new SqliteWorkplaceRepository(tx);
      await replaceVfsSubtree(
        vfs,
        "/template",
        `/projects/${projectId}/template`,
      );
      await worktree.copyScope(
        workplaceScopeKey({ kind: "global" }),
        workplaceScopeKey({ kind: "project", projectId }),
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
    await this.conn.transaction(async (tx) => {
      await initializeSessionWorkspace(tx, session.projectId, sessionId, {
        clearCheckpoints: true,
      });
    });
  }
}