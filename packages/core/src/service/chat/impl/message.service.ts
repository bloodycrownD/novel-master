/**
 * Default message service.
 *
 * @module service/chat/impl/message.service
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { assertMessageContent } from "@/domain/chat/content/parse-message-content.js";
import type { MessageContent } from "@/domain/chat/model/content-block.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { ChatSession } from "@/domain/chat/model/session.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { nextForkSessionTitle } from "@/domain/chat/logic/fork-session-title.js";
import { copyVfsTree } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { sweepSessionRevisions } from "@/domain/message-checkpoint/logic/revision-gc.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { chatInvalidArgument, chatNotFound } from "@/errors/chat-errors.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { MessageService } from "../message.port.js";

function reposFor(conn: TdbcConnection) {
  return {
    sessions: new SqliteSessionRepository(conn),
    messages: new SqliteMessageRepository(conn),
    vfs: new SqliteVfsEntryRepository(conn),
  };
}

/** Dependencies for {@link DefaultMessageService}. */
export interface MessageServiceDeps {
  readonly conn: TdbcConnection;
  readonly sessions: SessionRepository;
  readonly messages: MessageRepository;
  readonly vfs: VfsEntryRepository;
  readonly checkpoints: MessageCheckpointRepository;
  readonly revisions: VfsRevisionRepository;
}

/**
 * Message service with monotonic `seq` and fork support.
 */
export class DefaultMessageService implements MessageService {
  constructor(private readonly deps: MessageServiceDeps) {}

  listBySession(sessionId: string): Promise<ChatMessage[]> {
    return this.deps.messages.listBySession(sessionId);
  }

  listBySessionTail(
    sessionId: string,
    options: { limit: number },
  ): Promise<ChatMessage[]> {
    return this.deps.messages.listBySessionTail(sessionId, options.limit);
  }

  listBySessionPage(
    sessionId: string,
    options: { limit: number; beforeSeq?: number },
  ): Promise<ChatMessage[]> {
    return this.deps.messages.listBySessionPage(
      sessionId,
      options.limit,
      options.beforeSeq,
    );
  }

  async get(id: string): Promise<ChatMessage> {
    const message = await this.deps.messages.findById(id);
    if (message == null) {
      throw chatNotFound("message", id);
    }
    return message;
  }

  async append(
    sessionId: string,
    role: string,
    content: MessageContent,
    options?: { provider?: string | null; raw?: Record<string, unknown> | null },
  ): Promise<ChatMessage> {
    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }
    assertMessageContent(content);
    const seq = await this.deps.messages.nextSeq(sessionId);
    // New messages are visible by default
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
    await this.deps.messages.insert(message);
    return message;
  }

  async delete(id: string): Promise<void> {
    const message = await this.deps.messages.findById(id);
    if (message == null) {
      throw chatNotFound("message", id);
    }

    const session = await this.deps.sessions.findById(message.sessionId);
    if (session == null) {
      throw chatNotFound("session", message.sessionId);
    }

    await this.deps.conn.transaction(async (tx) => {
      const messages = new SqliteMessageRepository(tx);
      const checkpoints = new SqliteMessageCheckpointRepository(tx);
      const entries = new SqliteVfsEntryRepository(tx);
      const revisions = new SqliteVfsRevisionRepository(tx);

      const deleted = await messages.delete(id);
      if (!deleted) {
        throw chatNotFound("message", id);
      }

      await checkpoints.deleteCheckpointsForMessages(message.sessionId, [id]);
      await sweepSessionRevisions(
        revisions,
        entries,
        checkpoints,
        session.projectId,
        message.sessionId,
      );
    });
  }

  async updateContent(
    messageId: string,
    content: MessageContent,
  ): Promise<ChatMessage> {
    assertMessageContent(content);
    const updated = await this.deps.messages.updateContent(
      messageId,
      JSON.stringify(content),
    );
    if (!updated) {
      throw chatNotFound("message", messageId);
    }
    return this.get(messageId);
  }

  async fork(sessionId: string, upToMessageId: string): Promise<ChatSession> {
    const source = await this.deps.sessions.findById(sessionId);
    if (source == null) {
      throw chatNotFound("session", sessionId);
    }
    const upTo = await this.deps.messages.findById(upToMessageId);
    if (upTo == null || upTo.sessionId !== sessionId) {
      throw chatNotFound("message", upToMessageId, { sessionId });
    }
    const all = await this.deps.messages.listBySession(sessionId);
    const projectSessions = await this.deps.sessions.listByProject(
      source.projectId,
    );
    const forkTitle = nextForkSessionTitle(
      source.title,
      projectSessions.map((s) => s.title),
    );
    return this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const toCopy = all.filter((m) => m.seq <= upTo.seq);
      if (toCopy.length === 0) {
        throw chatInvalidArgument("No messages to fork up to the given id");
      }
      const now = Date.now();
      const forked: ChatSession = {
        id: randomUUID(),
        projectId: source.projectId,
        title: forkTitle,
        userVfsPendingJson: source.userVfsPendingJson,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.sessions.insert(forked);
      await copyVfsTree(
        r.vfs,
        `/projects/${source.projectId}/sessions/${source.id}`,
        `/projects/${source.projectId}/sessions/${forked.id}`,
      );

      let seq = 1;
      for (const msg of toCopy) {
        // Preserve hidden state when forking
        await r.messages.insert({
          ...msg,
          id: randomUUID(),
          sessionId: forked.id,
          seq,
        });
        seq++;
      }
      return forked;
    });
  }

  async hide(messageId: string): Promise<void> {
    const updated = await this.deps.messages.updateHidden(messageId, true);
    if (!updated) {
      throw chatNotFound("message", messageId);
    }
  }

  async show(messageId: string): Promise<void> {
    const updated = await this.deps.messages.updateHidden(messageId, false);
    if (!updated) {
      throw chatNotFound("message", messageId);
    }
  }

  async hideRange(sessionId: string, fromSeq: number, toSeq: number): Promise<number> {
    // Verify session exists
    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }
    return this.deps.messages.updateHiddenRange(sessionId, fromSeq, toSeq, true);
  }

  async showRange(sessionId: string, fromSeq: number, toSeq: number): Promise<number> {
    // Verify session exists
    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }
    return this.deps.messages.updateHiddenRange(sessionId, fromSeq, toSeq, false);
  }
}
