/**
 * Default {@link MessageRollbackService} implementation.
 *
 * @module service/message-checkpoint/impl/message-rollback.service
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { resolveRollbackAnchorMessage } from "@/domain/message-checkpoint/logic/resolve-rollback-anchor.js";
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
  sessionFsRollbackVfsRestoreFailed,
  isSessionFsError,
} from "@/errors/session-fs-errors.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createScopedVfsService } from "@/service/vfs/create-scoped-vfs-service.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";
import type {
  MessageRollbackService,
  RollbackOptions,
} from "../message-rollback.port.js";

/** Dependencies for {@link DefaultMessageRollbackService}. */
export interface MessageRollbackServiceDeps {
  readonly conn: TdbcConnection;
  readonly messages: MessageRepository;
  readonly entries: VfsEntryRepository;
  readonly revisions: VfsRevisionRepository;
  readonly checkpoints: MessageCheckpointRepository;
}

/** 回滚计划：anchor、tail、待 reconcile 路径与目标树。 */
type RollbackPlan = {
  anchor: ChatMessage;
  tailMessageIds: string[];
  pathsToReconcile: Set<string>;
  targetTree: Map<string, number>;
  projectId: string;
  sessionId: string;
  scope: VfsScope;
};

function formatDegradableMessage(cause: unknown): string {
  let detail: string;
  if (isSessionFsError(cause) || isVfsError(cause)) {
    detail = cause.message;
  } else if (cause instanceof Error) {
    detail = cause.message;
  } else {
    detail = String(cause);
  }
  return `工作区无法恢复：${detail}`;
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
    options?: RollbackOptions,
  ): Promise<void> {
    const plan = await this.resolveRollbackPlan(
      sessionId,
      projectId,
      anchorMessageId,
    );

    await this.deps.conn.transaction(async (tx) => {
      if (!options?.skipVfsReconcile) {
        try {
          await this.reconcileVfsPaths(tx, plan);
        } catch (cause) {
          throw sessionFsRollbackVfsRestoreFailed(
            formatDegradableMessage(cause),
            { sessionId, messageId: anchorMessageId },
          );
        }
      }
      await this.truncateTailState(tx, sessionId, plan);
    });
  }

  private async resolveRollbackPlan(
    sessionId: string,
    projectId: string,
    anchorMessageId: string,
  ): Promise<RollbackPlan> {
    const clicked = await this.deps.messages.findById(anchorMessageId);
    if (clicked == null) {
      throw sessionFsRollbackMessageNotFound(anchorMessageId);
    }
    if (clicked.sessionId !== sessionId) {
      throw sessionFsRollbackMessageSessionMismatch(anchorMessageId, sessionId);
    }

    const allMessages = await this.deps.messages.listBySession(sessionId);
    const anchor =
      resolveRollbackAnchorMessage(allMessages, anchorMessageId) ?? clicked;
    const tail = allMessages.filter((m) => m.seq > anchor.seq);
    const tailMessageIds = tail.map((m) => m.id);

    const directTargetTree = await this.deps.checkpoints.loadFileTree(
      sessionId,
      anchor.id,
    );
    const targetTree = await resolveRollbackTargetTree(
      this.deps.checkpoints,
      sessionId,
      anchor.id,
      anchor.seq,
    );

    const scope: VfsScope = { kind: "session", projectId, sessionId };
    const tailPointers = await this.deps.checkpoints.listFilePointersForMessages(
      sessionId,
      tailMessageIds,
    );
    const tailLogicalPaths = tailPointers.map((p) => p.logicalPath);

    const pathsToReconcile = new Set<string>([
      ...tailLogicalPaths,
      ...targetTree.keys(),
    ]);
    if (directTargetTree != null) {
      const currentFiles = await listSessionFileHeads(
        this.deps.entries,
        projectId,
        sessionId,
      );
      for (const { logicalPath } of currentFiles) {
        if (!targetTree.has(logicalPath)) {
          pathsToReconcile.add(logicalPath);
        }
      }
    }

    return {
      anchor,
      tailMessageIds,
      pathsToReconcile,
      targetTree,
      projectId,
      sessionId,
      scope,
    };
  }

  private async reconcileVfsPaths(
    tx: TdbcConnection,
    plan: RollbackPlan,
  ): Promise<void> {
    const { scope, pathsToReconcile, targetTree, projectId, sessionId } = plan;
    const vfs = this.scopedVfs(projectId, sessionId, tx);
    const revisions = new SqliteVfsRevisionRepository(tx);

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
  }

  private async truncateTailState(
    tx: TdbcConnection,
    sessionId: string,
    plan: RollbackPlan,
  ): Promise<void> {
    const revisions = new SqliteVfsRevisionRepository(tx);
    const checkpoints = new SqliteMessageCheckpointRepository(tx);
    const messages = new SqliteMessageRepository(tx);
    const entries = new SqliteVfsEntryRepository(tx);

    await checkpoints.deleteCheckpointsForMessages(
      sessionId,
      plan.tailMessageIds,
    );
    await messages.deleteAfterSeq(sessionId, plan.anchor.seq);

    await sweepSessionRevisions(
      revisions,
      entries,
      checkpoints,
      plan.projectId,
      sessionId,
    );
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
