/**
 * 用户 VFS U-A-U-A 用例默认实现。
 *
 * @module service/chat/impl/user-vfs-turn.service
 */

import { mergePendingVfsTurns } from "@/domain/chat/logic/merge-pending-vfs-turns.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import type { ToolRunner } from "@/domain/tool/logic/tool-runner.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import {
  userVfsPendingQueueSchema,
  type UserVfsPendingEntry,
  type UserVfsPendingQueue,
} from "@/domain/chat/model/user-vfs-pending.schema.js";
import { chatInvalidArgument, chatNotFound } from "@/errors/chat-errors.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import type { MessageService } from "../message.port.js";
import type {
  UserVfsFlushResult,
  UserVfsTurnExecuteResult,
  UserVfsTurnOp,
  UserVfsTurnService,
} from "../user-vfs-turn.port.js";
import { TOOL_TURN_BRIDGE_TEXT } from "./append-tool-turn-bridge.js";

/** {@link DefaultUserVfsTurnService} 依赖。 */
export interface UserVfsTurnServiceDeps {
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

/**
 * 编排 execute → pending、flush → U-A-U-A + checkpoint。
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
    const outcomes = await this.deps.toolRunner.runParallel(
      op.tools.map((tool) => ({ name: tool.name, input: tool.input })),
      toolCtx,
    );

    const failed = outcomes.find((o) => !o.ok);
    if (failed != null) {
      return { ok: false, error: failed.error };
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

    const merged = mergePendingVfsTurns(pending);

    await this.deps.messages.append(
      sessionId,
      "user",
      { blocks: [{ type: "text", text: merged.actionsXml }] },
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

    await this.deps.messages.append(
      sessionId,
      "assistant",
      { blocks: [...merged.toolUses] },
      {
        raw: {
          metadata: {
            synthetic: true,
            actor: "user",
            toolInputCompressed: true,
          },
        },
      },
    );

    const toolResultUser = await this.deps.messages.append(
      sessionId,
      "user",
      { blocks: [...merged.toolResults] },
      {
        raw: {
          metadata: {
            source: "user",
            synthetic: true,
          },
        },
      },
    );

    await this.deps.messages.append(
      sessionId,
      "assistant",
      { blocks: [{ type: "text", text: TOOL_TURN_BRIDGE_TEXT }] },
      {
        raw: {
          metadata: {
            synthetic: true,
            kind: "tool_turn_bridge",
          },
        },
      },
    );

    await savePendingQueue(this.deps.sessions, sessionId, []);
    await this.deps.messageCheckpoint.capture(
      sessionId,
      session.projectId,
      toolResultUser.id,
    );

    return { flushed: true };
  }
}
