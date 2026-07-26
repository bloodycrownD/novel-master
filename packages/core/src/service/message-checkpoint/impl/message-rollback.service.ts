/**
 * Default {@link MessageRollbackService} implementation.
 *
 * @module service/message-checkpoint/impl/message-rollback.service
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { isPlainUserUndoSendEligible } from "@/domain/chat/logic/editable-text-from-message.js";
import type { RollbackMode } from "@/domain/chat/logic/rollback-confirm-copy.js";
import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { findMissingRevisionPointers } from "@/domain/message-checkpoint/logic/detect-missing-revisions.js";
import { resolveRollbackAnchorMessage } from "@/domain/message-checkpoint/logic/resolve-rollback-anchor.js";
import {
  resolvePriorRollbackTargetTree,
  resolveRollbackTargetTree,
} from "@/domain/message-checkpoint/logic/resolve-target-tree.js";
import { resolveReconcilePathSets } from "@/domain/message-checkpoint/logic/resolve-reconcile-paths.js";
import {
  restorePathToRevision,
  restorePathToRevisionWithBackfill,
} from "@/domain/message-checkpoint/logic/restore-path.js";
import {
  createTruncateTailDepsFromTx,
  truncateTailInTransaction,
} from "@/service/message-checkpoint/truncate-tail-wiring.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import {
  toPhysicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
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
import { sessionApiPromptTokenCache } from "@/infra/tokenizer/logic/session-api-prompt-token-cache.js";
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

/** 回滚计划：模式、anchor、tail、待 reconcile 路径与目标树。 */
type RollbackPlan = {
  mode: RollbackMode;
  anchor: ChatMessage;
  truncateAfterSeq: number;
  tailMessageIds: string[];
  pathsNeedWrite: ReadonlySet<string>;
  pathsNeedDelete: ReadonlySet<string>;
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
    const tAll = Date.now();

    const tPlan0 = Date.now();
    const plan = await this.resolveRollbackPlan(
      sessionId,
      projectId,
      anchorMessageId,
    );
    const planMs = Date.now() - tPlan0;
    console.log("[nm-rollback] plan", {
      mode: plan.mode,
      pathsNeedWrite: plan.pathsNeedWrite.size,
      pathsNeedDelete: plan.pathsNeedDelete.size,
      targetTree: plan.targetTree.size,
      tailMessages: plan.tailMessageIds.length,
      skipVfsReconcile: options?.skipVfsReconcile === true,
      ms: planMs,
    });

    let missingMs = 0;
    let missingCount = 0;
    if (!options?.skipVfsReconcile) {
      const tMissing0 = Date.now();
      const missing = await findMissingRevisionPointers(
        this.deps.revisions,
        plan.scope,
        plan.targetTree,
        plan.pathsNeedWrite,
      );
      missingMs = Date.now() - tMissing0;
      missingCount = missing.length;
      console.log("[nm-rollback] missing-check", {
        missing: missingCount,
        ms: missingMs,
      });
      if (missing.length > 0 && !options?.revisionHeadBackfill) {
        throw sessionFsRollbackRevisionBackfillRequired(missing, {
          sessionId,
          messageId: anchorMessageId,
        });
      }
    }

    let reconcileMs = 0;
    let truncateSweepMs = 0;
    const tTx0 = Date.now();
    await this.deps.conn.transaction(async (tx) => {
      if (!options?.skipVfsReconcile) {
        const tRec0 = Date.now();
        let reconcileStats: {
          skippedSameVersion: number;
          skippedSameContentHash: number;
          restored: number;
          deleted: number;
        } | null = null;
        try {
          reconcileStats = await this.reconcileVfsPaths(
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
        reconcileMs = Date.now() - tRec0;
        console.log("[nm-rollback] reconcile", {
          pathsNeedWrite: plan.pathsNeedWrite.size,
          pathsNeedDelete: plan.pathsNeedDelete.size,
          ...reconcileStats,
          ms: reconcileMs,
        });
      }
      const tTrunc0 = Date.now();
      await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), {
        projectId: plan.projectId,
        sessionId: plan.sessionId,
        afterSeq: plan.truncateAfterSeq,
        sweepRevisions: true,
      });
      truncateSweepMs = Date.now() - tTrunc0;
      console.log("[nm-rollback] truncate+sweep (revision-only, no sync blob)", {
        ms: truncateSweepMs,
      });
    });
    const txMs = Date.now() - tTx0;
    sessionApiPromptTokenCache.invalidate(sessionId);
    console.log("[nm-rollback] core done", {
      mode: plan.mode,
      planMs,
      missingMs,
      missingCount,
      reconcileMs,
      truncateSweepMs,
      txMs,
      totalMs: Date.now() - tAll,
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

    const mode: RollbackMode = isPlainUserUndoSendEligible(anchor)
      ? "undo_send"
      : "rewind";
    const truncateAfterSeq =
      mode === "undo_send" ? anchor.seq - 1 : anchor.seq;

    const tail =
      mode === "undo_send"
        ? allMessages.filter((m) => m.seq >= anchor.seq)
        : allMessages.filter((m) => m.seq > anchor.seq);
    const tailMessageIds = tail.map((m) => m.id);

    let targetTree: Map<string, number>;
    let hasDirectTargetTree: boolean;

    if (mode === "undo_send") {
      targetTree = await resolvePriorRollbackTargetTree(
        this.deps.checkpoints,
        sessionId,
        anchor.seq - 1,
      );
      // undo_send 始终按 prior 基线 diff 当前工作区（空树 = 删光会话文件）
      hasDirectTargetTree = true;
    } else {
      const directTargetTree = await this.deps.checkpoints.loadFileTree(
        sessionId,
        anchor.id,
      );
      targetTree = await resolveRollbackTargetTree(
        this.deps.checkpoints,
        sessionId,
        anchor.id,
        anchor.seq,
      );
      hasDirectTargetTree = directTargetTree != null;
    }

    const scope: VfsScope = { kind: "session", projectId, sessionId };

    const reconcileSets = await resolveReconcilePathSets(
      this.deps.entries,
      this.deps.revisions,
      scope,
      targetTree,
      hasDirectTargetTree,
    );

    const pathsNeedDelete = new Set(reconcileSets.pathsNeedDelete);
    if (tailMessageIds.length > 0) {
      const tailPointers =
        await this.deps.checkpoints.listFilePointersForMessages(
          sessionId,
          tailMessageIds,
        );
      for (const pointer of tailPointers) {
        if (!targetTree.has(pointer.logicalPath)) {
          pathsNeedDelete.add(pointer.logicalPath);
        }
      }
    }

    return {
      mode,
      truncateAfterSeq,
      anchor,
      tailMessageIds,
      pathsNeedWrite: reconcileSets.pathsNeedWrite,
      pathsNeedDelete,
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
  ): Promise<{
    skippedSameVersion: number;
    skippedSameContentHash: number;
    restored: number;
    deleted: number;
  }> {
    const { scope, pathsNeedWrite, pathsNeedDelete, targetTree, projectId, sessionId } = plan;
    const vfs = this.scopedVfs(projectId, sessionId, tx);
    const revisions = new SqliteVfsRevisionRepository(tx);
    const entries = new SqliteVfsEntryRepository(tx);
    const liveHeadRows = await listSessionFileHeads(entries, projectId, sessionId);
    const liveHeadByPath = new Map(
      liveHeadRows.map((head) => [head.logicalPath, head.headVersion]),
    );

    const reconcilePairs: Array<{
      logicalPath: string;
      physical: string;
      version: number;
    }> = [];
    for (const logicalPath of pathsNeedWrite) {
      const version = targetTree.get(logicalPath);
      if (version != null) {
        reconcilePairs.push({
          logicalPath,
          physical: toPhysicalPath(scope, logicalPath),
          version,
        });
      }
    }

    const revisionMetaByKey = await revisions.findMetasByPathVersions(
      reconcilePairs.map((pair) => ({
        path: pair.physical,
        version: pair.version,
      })),
    );
    const liveHashByPath = await entries.findContentHashesByPaths([
      ...new Set(reconcilePairs.map((pair) => pair.physical)),
    ]);
    const prefetch = { revisionMetaByKey, liveHashByPath };
    const prefetchForRestore = useRevisionHeadBackfill
      ? { liveHashByPath: prefetch.liveHashByPath }
      : prefetch;

    let skippedSameVersion = 0;
    let skippedSameContentHash = 0;
    let restored = 0;
    let deleted = 0;

    for (const logicalPath of pathsNeedWrite) {
      const version = targetTree.get(logicalPath);
      if (version != null) {
        const outcome = useRevisionHeadBackfill
          ? (
              await restorePathToRevisionWithBackfill(
                vfs,
                revisions,
                entries,
                scope,
                logicalPath,
                version,
                liveHeadByPath,
                prefetchForRestore,
              )
            ).outcome
          : await restorePathToRevision(
              vfs,
              revisions,
              scope,
              logicalPath,
              version,
              liveHeadByPath,
              entries,
              prefetchForRestore,
            );
        if (outcome === "skipped_same_version") {
          skippedSameVersion++;
        } else if (outcome === "skipped_same_content_hash") {
          skippedSameContentHash++;
        } else if (outcome === "deleted") {
          deleted++;
        } else {
          restored++;
        }
      }
    }

    for (const logicalPath of pathsNeedDelete) {
      await this.deletePathIfExists(vfs, logicalPath);
      deleted++;
    }

    return {
      skippedSameVersion,
      skippedSameContentHash,
      restored,
      deleted,
    };
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
