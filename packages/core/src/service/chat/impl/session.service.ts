/**
 * Default session service.
 *
 * @module service/chat/impl/session.service
 */

import { randomUUID } from "node:crypto";
import type { TdbcConnection } from "../../../infra/tdbc/connection.js";
import type { ChatSession } from "../../../domain/chat/model/session.js";
import type { ProjectRepository } from "../../../domain/chat/repositories/project.port.js";
import type { SessionRepository } from "../../../domain/chat/repositories/session.port.js";
import type { MessageRepository } from "../../../domain/chat/repositories/message.port.js";
import type { VfsEntryRepository } from "../../../domain/vfs/repositories/vfs-entry.port.js";
import { copyVfsTree, deleteVfsPrefix } from "../../../domain/vfs/vfs-tree-copy.js";
import { chatNotFound } from "../../../errors/chat-errors.js";
import { SqliteProjectRepository } from "../../../domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "../../../domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "../../../domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "../../../domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { deleteSessionFsData } from "../../session-fs/create-session-fs-service.js";
import type { SessionService } from "../session.port.js";

function reposFor(conn: TdbcConnection) {
  return {
    projects: new SqliteProjectRepository(conn),
    sessions: new SqliteSessionRepository(conn),
    messages: new SqliteMessageRepository(conn),
    vfs: new SqliteVfsEntryRepository(conn),
  };
}

/** Dependencies for {@link DefaultSessionService}. */
export interface SessionServiceDeps {
  readonly conn: TdbcConnection;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly messages: MessageRepository;
  readonly vfs: VfsEntryRepository;
}

/**
 * Session service; `create` copies project template into session VFS.
 */
export class DefaultSessionService implements SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  async listByProject(projectId: string): Promise<ChatSession[]> {
    await this.requireProject(projectId);
    return this.deps.sessions.listByProject(projectId);
  }

  async get(id: string): Promise<ChatSession> {
    const session = await this.deps.sessions.findById(id);
    if (session == null) {
      throw chatNotFound("session", id);
    }
    return session;
  }

  async create(
    projectId: string,
    title?: string | null,
  ): Promise<ChatSession> {
    await this.requireProject(projectId);
    return this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const now = Date.now();
      const session: ChatSession = {
        id: randomUUID(),
        projectId,
        title: title ?? null,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.sessions.insert(session);
      await copyVfsTree(
        r.vfs,
        `/projects/${projectId}/template`,
        `/projects/${projectId}/sessions/${session.id}`,
      );
      return session;
    });
  }

  async delete(id: string): Promise<void> {
    const session = await this.get(id);
    await this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      await r.messages.deleteBySession(id);
      await deleteSessionFsData(tx, id);
      await deleteVfsPrefix(
        r.vfs,
        `/projects/${session.projectId}/sessions/${id}`,
      );
      const deleted = await r.sessions.delete(id);
      if (!deleted) {
        throw chatNotFound("session", id);
      }
    });
  }

  async copy(id: string): Promise<ChatSession> {
    const source = await this.get(id);
    return this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const now = Date.now();
      const copy: ChatSession = {
        id: randomUUID(),
        projectId: source.projectId,
        title: source.title == null ? null : `${source.title} (copy)`,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.sessions.insert(copy);
      await copyVfsTree(
        r.vfs,
        `/projects/${source.projectId}/sessions/${source.id}`,
        `/projects/${source.projectId}/sessions/${copy.id}`,
      );
      const messages = await r.messages.listBySession(source.id);
      for (const msg of messages) {
        await r.messages.insert({
          ...msg,
          id: randomUUID(),
          sessionId: copy.id,
        });
      }
      return copy;
    });
  }

  private async requireProject(projectId: string): Promise<void> {
    const project = await this.deps.projects.findById(projectId);
    if (project == null) {
      throw chatNotFound("project", projectId);
    }
  }
}
