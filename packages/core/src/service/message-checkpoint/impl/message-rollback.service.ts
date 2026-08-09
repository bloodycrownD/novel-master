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
  scopeKey,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  sessionFsRollbackMessageNotFound,
  sessionFsRollbackMessageSessionMismatch,
  sessionFsRollbackRevisionBackfillRequired,
  sessionFsRollbackVfsRestoreFailed,
  sessionFsRollbackUndoSendEmptyTarget,
  sessionFsRollbackConflict,
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
  /**
   * A-22 乐观锁快照：plan 解析时会话消息总数。事务开始时重读会话消息计数，
   * 与该快照不一致即代表间隙期间有 agent 写入，需要重试或拒。
   */
  messageCountSnapshot: number;
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
 * A-22 乐观锁最大重试次数。
 *
 * @remarks plan 解析（多次 await 读）与事务开始之间存在 TOCTOU 间隙：agent 可能在此期间写入新消息。
 * 每次事务开始时重读会话消息计数与快照对比；不一致即重试整个 plan+事务。
 * 3 次上限是为了避免在高频写入会话上死循环——冲突仍持续时向上报 ROLLBACK_CONFLICT。
 */
const ROLLBACK_OPTIMISTIC_RETRY_LIMIT = 3;

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

    // A-22 乐观锁重试循环：plan 解析（多次 await 读）与事务开始之间有 TOCTOU 间隙，
    // 事务内重读会话消息计数与快照对比，不一致代表间隙期间有 agent 写入，重试整个 plan+事务。
    // 冲突持续超过上限才向上报 ROLLBACK_CONFLICT，避免在高频写入会话上死循环。
    for (let attempt = 1; ; attempt++) {
      const plan = await this.resolveRollbackPlan(
        sessionId,
        projectId,
        anchorMessageId,
      );

      // S-13 护栏：undo_send 解析出的 targetTree 为空意味着没有 baseline 快照可对齐，
      // 一旦进入 reconcileVfsPaths 会把 live 树里所有路径都当「需删除」处理——
      // 这正是纯文本 chat 路径「聊一轮再 undo_send」把整个会话工作区删光的根因。
      // 仅当确实要 reconcile VFS 时才拦；skipVfsReconcile 只截断消息、不碰文件，
      // 空 targetTree 不会造成破坏，仍然放行（例如 DF-U1 的降级回滚）。
      if (
        !options?.skipVfsReconcile &&
        plan.mode === "undo_send" &&
        plan.targetTree.size === 0
      ) {
        throw sessionFsRollbackUndoSendEmptyTarget(sessionId, anchorMessageId);
      }

      if (!options?.skipVfsReconcile) {
        const missing = await findMissingRevisionPointers(
          this.deps.revisions,
          this.deps.entries,
          plan.scope,
          plan.targetTree,
          plan.pathsNeedWrite,
        );
        if (missing.length > 0 && !options?.revisionHeadBackfill) {
          throw sessionFsRollbackRevisionBackfillRequired(missing, {
            sessionId,
            messageId: anchorMessageId,
          });
        }
      }

      try {
        await this.deps.conn.transaction(async (tx) => {
          // A-22 乐观锁：事务刚开始，未写任何东西之前重读会话消息计数，
          // 与 plan 阶段记录的快照不一致代表间隙期间 agent 有写入。
          // 这里用 tx 作用域的 SqliteMessageRepository——驱动事务持锁期间，
          // 只有 tx 面能安全查询（不能走 this.deps.messages，那会重入驱动的 mutex 死锁）。
          // messages 没有独立的 countBySession 方法，这里用 listBySession 的 length 作为快照源，
          // 与 plan 阶段读路径一致。
          const txMessages = new SqliteMessageRepository(tx);
          const currentMessages = await txMessages.listBySession(sessionId);
          if (currentMessages.length !== plan.messageCountSnapshot) {
            throw sessionFsRollbackConflict(
              sessionId,
              anchorMessageId,
              plan.messageCountSnapshot,
              currentMessages.length,
            );
          }

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
            afterSeq: plan.truncateAfterSeq,
            sweepRevisions: true,
          });
        });
        // 成功 → 跳出重试循环。
        break;
      } catch (error) {
        // 仅乐观锁冲突才重试；其他错误（护栏、backfill required、vfs restore failed）直接向上。
        const isConflict = isSessionFsError(error, "ROLLBACK_CONFLICT");
        if (!isConflict || attempt >= ROLLBACK_OPTIMISTIC_RETRY_LIMIT) {
          throw error;
        }
        // 冲突重试前不再做其他事——重新 resolveRollbackPlan 会拉到最新的消息列表。
      }
    }

    sessionApiPromptTokenCache.invalidate(sessionId);
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
      // prior 为空时回退到 anchor 自身的 checkpoint。
      // 角色卡 / ZIP 导入会在事务末尾给空 checkpoint 的 message 补 baseline 快照，
      // 这样「导入后聊一轮再回滚首条 user」时，虽然 prior（seq<anchor.seq）为空，
      // 但 anchor 自身有 baseline checkpoint 可用，回滚到导入后的状态而非空树。
      if (targetTree.size === 0) {
        const anchorTree = await this.deps.checkpoints.loadFileTree(
          sessionId,
          anchor.id,
        );
        if (anchorTree != null) {
          targetTree = anchorTree;
        }
      }
      // undo_send 始终按 prior 基线 diff 当前工作区。空 targetTree 历史上意味着
      // 「删光会话文件」，但 S-13 护栏已在 rollbackToMessage 拦住空 targetTree 的
      // reconcile 调用，避免误删；这里保持 hasDirectTargetTree 语义不变。
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
      // entry_id 化后 tail pointer 只有 entryId；用 live heads 把 entryId 反解成当前逻辑路径，
      // 再判是否落在 targetTree 外（需删除）。已不在 live 树里的 entry 跳过（无物可删）。
      if (tailPointers.length > 0) {
        const liveHeads = await listSessionFileHeads(
          this.deps.entries,
          projectId,
          sessionId,
        );
        const pathByEntryId = new Map(
          liveHeads.map((h) => [h.entryId, h.logicalPath]),
        );
        for (const pointer of tailPointers) {
          const logicalPath = pathByEntryId.get(pointer.entryId);
          if (logicalPath != null && !targetTree.has(logicalPath)) {
            pathsNeedDelete.add(logicalPath);
          }
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
      // A-22 快照：listBySession 的 length 即 plan 阶段的会话消息计数，
      // 事务内重读会话消息计以此为准。
      messageCountSnapshot: allMessages.length,
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
    const scopeKeyStr = scopeKey(scope);
    const vfs = this.scopedVfs(projectId, sessionId, tx);
    const revisions = new SqliteVfsRevisionRepository(tx);
    const entries = new SqliteVfsEntryRepository(tx);
    const liveHeadRows = await listSessionFileHeads(entries, projectId, sessionId);
    const liveHeadByPath = new Map(
      liveHeadRows.map((head) => [head.logicalPath, head.headVersion]),
    );
    const entryIdByPath = new Map(
      liveHeadRows.map((head) => [head.logicalPath, head.entryId]),
    );

    // 需写盘的路径先解析出 entryId（live 优先，缺时按 path 探测）。
    const reconcilePairs: Array<{
      logicalPath: string;
      entryId: number;
      version: number;
    }> = [];
    for (const logicalPath of pathsNeedWrite) {
      const version = targetTree.get(logicalPath);
      if (version != null) {
        let entryId = entryIdByPath.get(logicalPath);
        if (entryId == null) {
          const entry = await entries.findByPath(scopeKeyStr, logicalPath);
          entryId = entry?.entryId ?? -1;
        }
        reconcilePairs.push({ logicalPath, entryId, version });
      }
    }

    const queryable = reconcilePairs.filter((pair) => pair.entryId >= 0);
    const revisionMetaByKey = await revisions.findMetasByEntryVersions(
      queryable.map((pair) => ({ entryId: pair.entryId, version: pair.version })),
    );
    const liveHashByPath = await entries.findContentHashesByPaths(
      scopeKeyStr,
      [...new Set(reconcilePairs.map((pair) => pair.logicalPath))],
    );
    const prefetch = { entryIdByPath, revisionMetaByKey, liveHashByPath };
    // backfill 会 append 新 revision 使 meta 变化，沿用 prefetch 的 revisionMetaByKey
    // 会有 stale prefetch——此处有意不放 revisionMetaByKey，由 restorePathToRevision
    // 逐条 findMetaByEntryAndVersion 查最新 meta，不并入 prefetch。
    const prefetchForRestore = useRevisionHeadBackfill
      ? { liveHashByPath: prefetch.liveHashByPath, entryIdByPath: prefetch.entryIdByPath }
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
                tx,
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
