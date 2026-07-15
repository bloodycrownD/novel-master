/**
 * Default session service.
 *
 * @module service/chat/impl/session.service
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { ChatSession } from "@/domain/chat/model/session.js";
import type { ProjectRepository } from "@/domain/chat/repositories/project.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { copyVfsTree, deleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { DefaultTemplatePullService } from "@/service/template/impl/template-pull.service.js";
import { chatInvalidArgument, chatNotFound } from "@/errors/chat-errors.js";
import { SqliteProjectRepository } from "@/domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { deleteSessionFsData } from "@/service/session-fs/create-session-fs-service.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import { initializeSessionWorkspace } from "@/service/template/logic/initialize-session-workspace.js";
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
      await initializeSessionWorkspace(tx, projectId, session.id, {
        clearCheckpoints: false,
      });
      return session;
    });
  }

  async rename(id: string, title: string): Promise<ChatSession> {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      throw chatInvalidArgument("session title must not be empty");
    }
    const existing = await this.get(id);
    const updatedAtMs = Date.now();
    const updated = await this.deps.sessions.updateTitle(
      id,
      trimmed,
      updatedAtMs,
    );
    if (!updated) {
      throw chatNotFound("session", id);
    }
    return { ...existing, title: trimmed, updatedAtMs };
  }

  async delete(id: string): Promise<void> {
    const session = await this.get(id);
    await this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      await r.messages.deleteBySession(id);
      await deleteSessionFsData(tx, id);
      await createSessionKkvService(tx).clearSession(id);
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

  async pullTemplate(sessionId: string): Promise<void> {
    await this.get(sessionId);
    await new DefaultTemplatePullService(this.deps.conn).sessionTemplatePull(
      sessionId,
    );
  }

  /**
   * 复制会话（VFS + 消息）。
   *
   * @remarks **不**复制 `session_kkv_entry`；新会话侧 kkv 为空，首次拼装重建。
   */
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
      // 刻意不复制 session_kkv（SPEC：fork/copy 不复制 kkv）
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
