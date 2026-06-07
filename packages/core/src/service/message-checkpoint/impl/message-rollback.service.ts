/**
 * Default {@link MessageRollbackService} implementation.
 *
 * @module service/message-checkpoint/impl/message-rollback.service
 */

import { resolveRollbackTargetTree } from "@/domain/message-checkpoint/logic/resolve-target-tree.js";
import { restorePathToRevision } from "@/domain/message-checkpoint/logic/restore-path.js";
import { sweepSessionRevisions } from "@/domain/message-checkpoint/logic/revision-gc.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  sessionFsRollbackMessageNotFound,
  sessionFsRollbackMessageSessionMismatch,
} from "@/errors/session-fs-errors.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createScopedVfsService } from "@/service/vfs/create-scoped-vfs-service.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";
import type { MessageRollbackService } from "../message-rollback.port.js";

/** Dependencies for {@link DefaultMessageRollbackService}. */
export interface MessageRollbackServiceDeps {
  readonly conn: TdbcConnection;
  readonly messages: MessageRepository;
  readonly entries: VfsEntryRepository;
  readonly revisions: VfsRevisionRepository;
  readonly checkpoints: MessageCheckpointRepository;
}

/**
 * Forward-restores the workspace to an anchor checkpoint tree and truncates tail state.
 */
export class DefaultMessageRollbackService implements MessageRollbackService {
  constructor(private readonly deps: MessageRollbackServiceDeps) {}

  async rollbackToMessage(
    sessionId: string,
    projectId: string,
    anchorMessageId: string,
  ): Promise<void> {
    const anchor = await this.deps.messages.findById(anchorMessageId);
    if (anchor == null) {
      throw sessionFsRollbackMessageNotFound(anchorMessageId);
    }
    if (anchor.sessionId !== sessionId) {
      throw sessionFsRollbackMessageSessionMismatch(anchorMessageId, sessionId);
    }

    const allMessages = await this.deps.messages.listBySession(sessionId);
    const tail = allMessages.filter((m) => m.seq > anchor.seq);
    const tailMessageIds = tail.map((m) => m.id);

    // Rollback is composite: always truncate tail messages; restore workspace when a
    // checkpoint tree exists (direct, prior, or empty baseline when none).
    const targetTree = await resolveRollbackTargetTree(
      this.deps.checkpoints,
      sessionId,
      anchorMessageId,
      anchor.seq,
    );

    const scope: VfsScope = { kind: "session", projectId, sessionId };
    const tailPointers = await this.deps.checkpoints.listFilePointersForMessages(
      sessionId,
      tailMessageIds,
    );
    const tailLogicalPaths = tailPointers.map((p) => p.logicalPath);

    // Boundary: reconcile tail-touched paths and target tree only — pre-anchor manual files stay put (R3).
    const pathsToReconcile = new Set<string>([
      ...tailLogicalPaths,
      ...targetTree.keys(),
    ]);

    await this.deps.conn.transaction(async (tx) => {
      const vfs = this.scopedVfs(projectId, sessionId, tx);
      const revisions = new SqliteVfsRevisionRepository(tx);
      const checkpoints = new SqliteMessageCheckpointRepository(tx);
      const messages = new SqliteMessageRepository(tx);
      const entries = new SqliteVfsEntryRepository(tx);

      for (const logicalPath of pathsToReconcile) {
        const version = targetTree.get(logicalPath);
        if (version != null) {
          await restorePathToRevision(
            vfs,
            revisions,
            scope,
            logicalPath,
            version,
          );
        } else {
          await this.deletePathIfExists(vfs, logicalPath);
        }
      }

      await checkpoints.deleteCheckpointsForMessages(sessionId, tailMessageIds);
      await messages.deleteAfterSeq(sessionId, anchor.seq);

      // Boundary: GC runs after tail checkpoints are removed so unreachable revisions can be dropped.
      await sweepSessionRevisions(
        revisions,
        entries,
        checkpoints,
        projectId,
        sessionId,
      );
    });
  }

  private scopedVfs(
    projectId: string,
    sessionId: string,
    conn: TdbcConnection,
  ): VfsService {
    return createScopedVfsService(conn, {
      kind: "session",
      projectId,
      sessionId,
    });
  }

  private async deletePathIfExists(
    vfs: VfsService,
    logicalPath: string,
  ): Promise<void> {
    try {
      await vfs.delete(logicalPath);
    } catch (error) {
      if (!isVfsError(error, "NOT_FOUND")) {
        throw error;
      }
    }
  }
}
