/**
 * 用户 VFS：execute → 操作日志 → flush 产出 user_ops 附件（不再落 UA；停写 pending kkv）。
 *
 * @module service/chat/impl/user-vfs-turn.service
 */

import { buildUserOpsAttachmentsFromLogEntries } from "@/domain/chat/logic/build-user-ops-attachment.js";
import {
  appendUserOpsLog,
  clearUserOpsLog,
  hasUnsentUserOpsLog,
  listUserOpsLog,
} from "@/domain/chat/logic/chat-user-ops-log-store.js";
import type { UserOpsActionSummary } from "@/domain/chat/logic/synthesize-user-vfs-flush-actions.js";
import { userOpsLogEntryFromTurnOp } from "@/domain/chat/logic/user-ops-log-from-turn-op.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import { sweepSessionRevisions } from "@/domain/message-checkpoint/logic/revision-gc.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import type { ToolRunner } from "@/domain/tool/logic/tool-runner.js";
import {
  collectMutatingPathsFromCalls,
  extractMutatingPaths,
} from "@/domain/vfs/logic/extract-mutating-paths.js";
import {
  captureMutatingPathHeadSnapshots,
  MutatingPathRestoreCompositeError,
  restoreMutatingPathHeads,
} from "@/domain/vfs/logic/restore-mutating-path-heads.js";
import { chatInvalidArgument, chatNotFound } from "@/errors/chat-errors.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { MessageService } from "../message.port.js";
import type {
  UserVfsFlushResult,
  UserVfsTurnExecuteResult,
  UserVfsTurnOp,
  UserVfsTurnService,
} from "../user-vfs-turn.port.js";

/** {@link DefaultUserVfsTurnService} 依赖。 */
export interface UserVfsTurnServiceDeps {
  readonly conn: TdbcConnection;
  readonly sessions: SessionRepository;
  /**
   * 历史：曾写 `user_vfs_pending`；现仅保留以便工厂签名稳定 / truncate 清旧域。
   * execute / flush **不再**读写 pending 队列。
   */
  readonly sessionKkv: SessionKkvService;
  readonly messages: MessageService;
  /**
   * 历史：净 diff preview 曾读消息列表；preview* 已 stub，保留以便工厂签名稳定。
   * @deprecated
   */
  readonly chatMessages: MessageRepository;
  readonly checkpoints: MessageCheckpointRepository;
  readonly entries: VfsEntryRepository;
  readonly revisions: VfsRevisionRepository;
  readonly toolRunner: ToolRunner<BuiltinToolContext>;
  readonly resolveToolCtx: (
    sessionId: string,
    projectId: string,
  ) => BuiltinToolContext;
  /**
   * 历史依赖：checkpoint 已改挂带 user_ops 的 user append；保留以便工厂签名稳定。
   */
  readonly messageCheckpoint: MessageCheckpointService;
}

/**
 * 编排 execute → 操作日志、flush → user_ops 附件（清空 store，不落 UA）。
 */
export class DefaultUserVfsTurnService implements UserVfsTurnService {
  constructor(private readonly deps: UserVfsTurnServiceDeps) {}

  async executeOp(
    sessionId: string,
    op: UserVfsTurnOp,
  ): Promise<UserVfsTurnExecuteResult> {
    if (op.tools.length === 0) {
      throw chatInvalidArgument("userVfsTurn.op.tools must not be empty");
    }
    if (op.actionXml.trim() === "") {
      throw chatInvalidArgument("userVfsTurn.op.actionXml must not be empty");
    }

    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }

    const toolCtx = this.deps.resolveToolCtx(sessionId, session.projectId);
    const calls = op.tools.map((tool) => ({
      name: tool.name,
      input: tool.input,
    }));
    const mutatingPaths = collectMutatingPathsFromCalls(calls);
    const headSnapshots = await captureMutatingPathHeadSnapshots(
      toolCtx.vfs,
      mutatingPaths,
    );

    const outcomes = await this.deps.toolRunner.runParallel(calls, toolCtx);

    const failed = outcomes.find((o) => !o.ok);
    if (failed != null) {
      const restoreErrors: unknown[] = [];
      for (let index = outcomes.length - 1; index >= 0; index -= 1) {
        const outcome = outcomes[index]!;
        if (!outcome.ok) {
          continue;
        }
        const tool = op.tools[index]!;
        const paths = extractMutatingPaths({
          name: tool.name,
          input: tool.input,
        });
        if (paths == null || paths.length === 0) {
          continue;
        }
        try {
          await restoreMutatingPathHeads(toolCtx.vfs, headSnapshots, paths);
        } catch (error: unknown) {
          if (error instanceof MutatingPathRestoreCompositeError) {
            restoreErrors.push(...error.causes);
          } else {
            restoreErrors.push(error);
          }
        }
      }
      // restore 尝试结束后不论 composite 仍 sweep 一次（末尾全库 blob gc）
      await sweepSessionRevisions(
        this.deps.revisions,
        this.deps.entries,
        this.deps.checkpoints,
        session.projectId,
        sessionId,
        this.deps.conn,
      );
      await runDeferredBlobGc(this.deps.conn);
      if (restoreErrors.length > 0) {
        return {
          ok: false,
          error: new MutatingPathRestoreCompositeError(restoreErrors),
          partialFailure: true,
        };
      }
      return { ok: false, error: failed.error, partialFailure: true };
    }

    // 写盘已成功：日志失败不回滚盘（D1）
    try {
      const entry = userOpsLogEntryFromTurnOp(op);
      appendUserOpsLog(sessionId, entry);
    } catch {
      // toast / 记错由上层；此处吞掉以免破坏已成功写盘
    }
    return { ok: true };
  }

  async flushPendingUserVfsTurns(
    sessionId: string,
  ): Promise<UserVfsFlushResult> {
    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }

    const entries = listUserOpsLog(sessionId);
    if (entries.length === 0) {
      return { flushed: false, attachments: [] };
    }

    const attachments = buildUserOpsAttachmentsFromLogEntries(entries);
    clearUserOpsLog(sessionId);
    return { flushed: true, attachments };
  }

  /**
   * @deprecated 净 diff 热路径已拆除；恒返回 `[]`。状态条请改读 UserOpsLogStore。
   */
  async previewUserOpsActions(
    _sessionId: string,
  ): Promise<readonly UserOpsActionSummary[]> {
    return [];
  }

  /**
   * @deprecated 净 diff 热路径已拆除；恒返回 `[]`。门闩请改读 hasPendingTurns / log store。
   */
  async previewUserOpsChangedPaths(
    _sessionId: string,
  ): Promise<readonly string[]> {
    return [];
  }

  async hasPendingTurns(sessionId: string): Promise<boolean> {
    return hasUnsentUserOpsLog(sessionId);
  }
}
