/**
 * Default message service.
 *
 * @module service/chat/impl/message.service
 */

import { randomUUID } from "node:crypto";
import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import type { ChatMessage, MessageContent } from "@/domain/chat/model/message.js";
import type { ChatSession } from "@/domain/chat/model/session.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { copyVfsTree } from "@/domain/vfs/vfs-tree-copy.js";
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
}

/**
 * Message service with monotonic `seq` and fork support.
 */
export class DefaultMessageService implements MessageService {
  constructor(private readonly deps: MessageServiceDeps) {}

  listBySession(sessionId: string): Promise<ChatMessage[]> {
    return this.deps.messages.listBySession(sessionId);
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
    const deleted = await this.deps.messages.delete(id);
    if (!deleted) {
      throw chatNotFound("message", id);
    }
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
        title: source.title == null ? null : `${source.title} (fork)`,
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
}
