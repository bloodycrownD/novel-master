/**
 * Default {@link MessageRollbackService} implementation.
 *
 * @module service/message-checkpoint/impl/message-rollback.service
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { findMissingRevisionPointers } from "@/domain/message-checkpoint/logic/detect-missing-revisions.js";
import { resolveRollbackAnchorMessage } from "@/domain/message-checkpoint/logic/resolve-rollback-anchor.js";
import { resolveRollbackTargetTree } from "@/domain/message-checkpoint/logic/resolve-target-tree.js";
import {
  restorePathToRevision,
  restorePathToRevisionWithBackfill,
} from "@/domain/message-checkpoint/logic/restore-path.js";
import {
  createTruncateTailDepsFromTx,
  truncateTailInTransaction,
} from "@/service/message-checkpoint/truncate-tail-wiring.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {
  sessionFsRollbackMessageNotFound,
  sessionFsRollbackMessageSessionMismatch,
  sessionFsRollbackRevisionBackfillRequired,
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

function assertRollbackOptionsCompatible(options?: RollbackOptions): void {
  if (options?.skipVfsReconcile && options?.revisionHeadBackfill) {
    throw new Error(
      "skipVfsReconcile 与 revisionHeadBackfill 不能同时指定",
    );
  }
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
    assertRollbackOptionsCompatible(options);

    const plan = await this.resolveRollbackPlan(
      sessionId,
      projectId,
      anchorMessageId,
    );

    if (!options?.skipVfsReconcile) {
      const missing = await findMissingRevisionPointers(
        this.deps.revisions,
        plan.scope,
        plan.targetTree,
        plan.pathsToReconcile,
      );
      if (missing.length > 0 && !options?.revisionHeadBackfill) {
        throw sessionFsRollbackRevisionBackfillRequired(missing, {
          sessionId,
          messageId: anchorMessageId,
        });
      }
    }

    await this.deps.conn.transaction(async (tx) => {
      if (!options?.skipVfsReconcile) {
        try {
          await this.reconcileVfsPaths(
            tx,
            plan,
            options?.revisionHeadBackfill === true,
          );
        } catch (cause) {
          throw sessionFsRollbackVfsRestoreFailed(
            formatDegradableMessage(cause),
            { sessionId, messageId: anchorMessageId },
          );
        }
      }
      await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), {
        projectId: plan.projectId,
        sessionId: plan.sessionId,
        afterSeq: plan.anchor.seq,
        sweepRevisions: true,
      });
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
    useRevisionHeadBackfill: boolean,
  ): Promise<void> {
    const { scope, pathsToReconcile, targetTree, projectId, sessionId } = plan;
    const vfs = this.scopedVfs(projectId, sessionId, tx);
    const revisions = new SqliteVfsRevisionRepository(tx);
    const entries = new SqliteVfsEntryRepository(tx);

    for (const logicalPath of pathsToReconcile) {
      const version = targetTree.get(logicalPath);
      if (version != null) {
        if (useRevisionHeadBackfill) {
          await restorePathToRevisionWithBackfill(
            vfs,
            revisions,
            entries,
            scope,
            logicalPath,
            version,
          );
        } else {
          await restorePathToRevision(
            vfs,
            revisions,
            scope,
            logicalPath,
            version,
          );
        }
      } else {
        await this.deletePathIfExists(vfs, logicalPath);
      }
    }
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
