/**
 * 用户 VFS：execute → pending → flush 产出 user_ops 附件（不再落 UA）。
 *
 * @module service/chat/impl/user-vfs-turn.service
 */

import { buildUserOpsAttachment } from "@/domain/chat/logic/build-user-ops-attachment.js";
import {
  collectUserOpsChangedPaths,
  diffWorkspaceForUserVfsFlush,
  isWorkspaceFlushDiffEmpty,
  type WorkspaceFlushDiff,
} from "@/domain/chat/logic/diff-workspace-for-user-vfs-flush.js";
import { resolveCurrentWorkspaceSnapshot } from "@/domain/chat/logic/resolve-current-workspace-snapshot.js";
import { resolveFlushBaselineTree } from "@/domain/chat/logic/resolve-flush-baseline-tree.js";
import { synthesizeUserVfsFlushActions } from "@/domain/chat/logic/synthesize-user-vfs-flush-actions.js";
import type { WorkspaceFlushSnapshot } from "@/domain/chat/logic/workspace-flush-snapshot.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import {
  SESSION_KKV_DOMAIN_USER_VFS_PENDING,
  USER_VFS_PENDING_QUEUE_KEY,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import {
  toPhysicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import {
  userVfsPendingQueueSchema,
  type UserVfsPendingEntry,
  type UserVfsPendingQueue,
} from "@/domain/chat/model/user-vfs-pending.schema.js";
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
  /** pending 队列：session kkv 域 `user_vfs_pending`。 */
  readonly sessionKkv: SessionKkvService;
  readonly messages: MessageService;
  /** flush 基准解析：会话消息 seq 上界。 */
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

async function loadRevisionContent(
  revisions: VfsRevisionRepository,
  scope: VfsScope,
  logicalPath: string,
  version: number,
): Promise<string> {
  const physical = toPhysicalPath(scope, logicalPath);
  const rev = await revisions.findByPathAndVersion(physical, version);
  if (rev == null || rev.status === "deleted") {
    return "";
  }
  return rev.content ?? "";
}

/** 读取 baseline / current 快照中各 path 的 revision 正文。 */
async function loadWorkspaceFlushContentMaps(
  revisions: VfsRevisionRepository,
  scope: VfsScope,
  baseline: WorkspaceFlushSnapshot,
  current: WorkspaceFlushSnapshot,
): Promise<{
  baselineContentByPath: Map<string, string>;
  currentContentByPath: Map<string, string>;
}> {
  const baselineContentByPath = new Map<string, string>();
  const currentContentByPath = new Map<string, string>();

  for (const [path, version] of baseline.fileTree) {
    baselineContentByPath.set(
      path,
      await loadRevisionContent(revisions, scope, path, version),
    );
  }

  for (const [path, version] of current.fileTree) {
    currentContentByPath.set(
      path,
      await loadRevisionContent(revisions, scope, path, version),
    );
  }

  return { baselineContentByPath, currentContentByPath };
}

async function loadPendingQueue(
  sessionKkv: SessionKkvService,
  sessionId: string,
): Promise<UserVfsPendingQueue> {
  const json = await sessionKkv.get(
    sessionId,
    SESSION_KKV_DOMAIN_USER_VFS_PENDING,
    USER_VFS_PENDING_QUEUE_KEY,
  );
  if (json == null || json.trim() === "") {
    return [];
  }
  return userVfsPendingQueueSchema.parse(JSON.parse(json));
}

async function savePendingQueue(
  sessionKkv: SessionKkvService,
  sessionId: string,
  queue: UserVfsPendingQueue,
): Promise<void> {
  if (queue.length === 0) {
    await sessionKkv.delete(
      sessionId,
      SESSION_KKV_DOMAIN_USER_VFS_PENDING,
      USER_VFS_PENDING_QUEUE_KEY,
    );
    return;
  }
  await sessionKkv.set(
    sessionId,
    SESSION_KKV_DOMAIN_USER_VFS_PENDING,
    USER_VFS_PENDING_QUEUE_KEY,
    JSON.stringify(queue),
  );
}

/**
 * 编排 execute → pending、flush → user_ops 附件（清空 pending，不落 UA）。
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
      if (restoreErrors.length > 0) {
        return {
          ok: false,
          error: new MutatingPathRestoreCompositeError(restoreErrors),
          partialFailure: true,
        };
      }
      return { ok: false, error: failed.error, partialFailure: true };
    }

    const queue = await loadPendingQueue(this.deps.sessionKkv, sessionId);
    const entry: UserVfsPendingEntry = {
      actionXml: op.actionXml,
      tools: op.tools.map((tool) => ({ id: tool.id, name: tool.name })),
      createdAtMs: Date.now(),
    };
    queue.push(entry);
    await savePendingQueue(this.deps.sessionKkv, sessionId, queue);
    return { ok: true };
  }

  async flushPendingUserVfsTurns(
    sessionId: string,
  ): Promise<UserVfsFlushResult> {
    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }

    const pending = await loadPendingQueue(this.deps.sessionKkv, sessionId);
    if (pending.length === 0) {
      return { flushed: false, attachments: [] };
    }

    const diff = await this.resolveWorkspaceFlushDiff(
      sessionId,
      session.projectId,
    );
    const actionsXml = synthesizeUserVfsFlushActions(diff);

    if (isWorkspaceFlushDiffEmpty(diff) || actionsXml.trim() === "") {
      await savePendingQueue(this.deps.sessionKkv, sessionId, []);
      return { flushed: false, attachments: [] };
    }

    const toolNames = pending.flatMap((e) => e.tools.map((t) => t.name));
    const name =
      toolNames.length > 0 ? [...new Set(toolNames)].join(", ") : "user_ops";
    const attachments = [buildUserOpsAttachment(actionsXml, name)];

    await savePendingQueue(this.deps.sessionKkv, sessionId, []);
    return { flushed: true, attachments };
  }

  /**
   * 相对 checkpoint 的净 path 集；不读 pending 也不改队列。
   */
  async previewUserOpsChangedPaths(
    sessionId: string,
  ): Promise<readonly string[]> {
    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }

    const diff = await this.resolveWorkspaceFlushDiff(
      sessionId,
      session.projectId,
    );
    return collectUserOpsChangedPaths(diff);
  }

  async hasPendingTurns(sessionId: string): Promise<boolean> {
    const pending = await loadPendingQueue(this.deps.sessionKkv, sessionId);
    return pending.length > 0;
  }

  /** flush / preview 共用：baseline + current + 正文 → 净 diff。 */
  private async resolveWorkspaceFlushDiff(
    sessionId: string,
    projectId: string,
  ): Promise<WorkspaceFlushDiff> {
    const baseline = await resolveFlushBaselineTree(
      this.deps.checkpoints,
      this.deps.chatMessages,
      sessionId,
    );
    const current = await resolveCurrentWorkspaceSnapshot(
      this.deps.entries,
      projectId,
      sessionId,
    );
    const scope: VfsScope = {
      kind: "session",
      projectId,
      sessionId,
    };
    const { baselineContentByPath, currentContentByPath } =
      await loadWorkspaceFlushContentMaps(
        this.deps.revisions,
        scope,
        baseline,
        current,
      );

    return diffWorkspaceForUserVfsFlush({
      baseline,
      current,
      baselineContentByPath,
      currentContentByPath,
    });
  }
}
