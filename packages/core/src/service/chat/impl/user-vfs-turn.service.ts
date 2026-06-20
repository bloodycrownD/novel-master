/**
 * 用户 VFS UA 两段用例默认实现。
 *
 * @module service/chat/impl/user-vfs-turn.service
 */

import { assertMessageContent } from "@/domain/chat/content/parse-message-content.js";
import { mergePendingVfsTurns } from "@/domain/chat/logic/merge-pending-vfs-turns.js";
import {
  USER_VFS_TURN_ACK_TEXT,
  wrapUserVfsActionsForStorage,
} from "@/domain/chat/logic/user-vfs-turn-constants.js";
import type { MessageContent } from "@/domain/chat/model/content-block.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
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
import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
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
  readonly messages: MessageService;
  readonly toolRunner: ToolRunner<BuiltinToolContext>;
  readonly resolveToolCtx: (
    sessionId: string,
    projectId: string,
  ) => BuiltinToolContext;
  readonly messageCheckpoint: MessageCheckpointService;
}

async function loadPendingQueue(
  sessions: SessionRepository,
  sessionId: string,
): Promise<UserVfsPendingQueue> {
  const json = await sessions.getUserVfsPendingJson(sessionId);
  if (json == null || json.trim() === "") {
    return [];
  }
  return userVfsPendingQueueSchema.parse(JSON.parse(json));
}

async function savePendingQueue(
  sessions: SessionRepository,
  sessionId: string,
  queue: UserVfsPendingQueue,
): Promise<void> {
  if (queue.length === 0) {
    await sessions.setUserVfsPendingJson(sessionId, null);
    return;
  }
  await sessions.setUserVfsPendingJson(sessionId, JSON.stringify(queue));
}

async function appendMessageInTx(
  tx: TdbcConnection,
  sessionId: string,
  role: string,
  content: MessageContent,
  options?: { provider?: string | null; raw?: Record<string, unknown> | null },
): Promise<ChatMessage> {
  assertMessageContent(content);
  const messages = new SqliteMessageRepository(tx);
  const seq = await messages.nextSeq(sessionId);
  const message: ChatMessage = {
    id: randomUUID(),
    sessionId,
    seq,
    role,
    content,
    provider: options?.provider ?? null,
    raw: options?.raw ?? null,
    createdAtMs: Date.now(),
    hidden: false,
  };
  await messages.insert(message);
  return message;
}

/**
 * 编排 execute → pending、flush → UA 两段 + checkpoint。
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

    const queue = await loadPendingQueue(this.deps.sessions, sessionId);
    const entry: UserVfsPendingEntry = {
      actionXml: op.actionXml,
      tools: op.tools.map((tool) => ({ id: tool.id, name: tool.name })),
      createdAtMs: Date.now(),
    };
    queue.push(entry);
    await savePendingQueue(this.deps.sessions, sessionId, queue);
    return { ok: true };
  }

  private async flushPendingInTransaction(
    tx: TdbcConnection,
    sessionId: string,
    pending: UserVfsPendingQueue,
  ): Promise<ChatMessage> {
    const { actionsXml } = mergePendingVfsTurns(pending);
    const text = wrapUserVfsActionsForStorage(actionsXml);

    const actionUser = await appendMessageInTx(
      tx,
      sessionId,
      "user",
      { blocks: [{ type: "text", text }] },
      {
        raw: {
          metadata: {
            source: "user",
            synthetic: true,
            kind: "user_vfs_action",
          },
        },
      },
    );

    await appendMessageInTx(
      tx,
      sessionId,
      "assistant",
      { blocks: [{ type: "text", text: USER_VFS_TURN_ACK_TEXT }] },
      {
        raw: {
          metadata: {
            synthetic: true,
            kind: "user_vfs_ack",
          },
        },
      },
    );

    const sessions = new SqliteSessionRepository(tx);
    await sessions.setUserVfsPendingJson(sessionId, null);
    return actionUser;
  }

  async flushPendingUserVfsTurns(
    sessionId: string,
  ): Promise<UserVfsFlushResult> {
    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }

    const pending = await loadPendingQueue(this.deps.sessions, sessionId);
    if (pending.length === 0) {
      return { flushed: false };
    }

    const actionUser = await this.deps.conn.transaction((tx) =>
      this.flushPendingInTransaction(tx, sessionId, pending),
    );

    await this.deps.messageCheckpoint.capture(
      sessionId,
      session.projectId,
      actionUser.id,
    );

    return { flushed: true };
  }

  async hasPendingTurns(sessionId: string): Promise<boolean> {
    const pending = await loadPendingQueue(this.deps.sessions, sessionId);
    return pending.length > 0;
  }
}
