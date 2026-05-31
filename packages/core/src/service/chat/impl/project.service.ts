/**
 * Default project service.
 *
 * @module service/chat/impl/project.service
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { ChatProject } from "@/domain/chat/model/project.js";
import type { ProjectRepository } from "@/domain/chat/repositories/project.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { projectVfsPrefix } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { copyVfsTree, deleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { chatNotFound } from "@/errors/chat-errors.js";
import { SqliteProjectRepository } from "@/domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { deleteSessionFsData } from "@/service/session-fs/create-session-fs-service.js";
import { DefaultTemplatePullService } from "@/service/template/impl/template-pull.service.js";
import type { ProjectService } from "../project.port.js";

function reposFor(conn: TdbcConnection) {
  return {
    projects: new SqliteProjectRepository(conn),
    sessions: new SqliteSessionRepository(conn),
    messages: new SqliteMessageRepository(conn),
    vfs: new SqliteVfsEntryRepository(conn),
  };
}

/** Dependencies for {@link DefaultProjectService}. */
export interface ProjectServiceDeps {
  readonly conn: TdbcConnection;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly messages: MessageRepository;
  readonly vfs: VfsEntryRepository;
}

/**
 * Project service with VFS template copy on `copy`.
 */
export class DefaultProjectService implements ProjectService {
  constructor(private readonly deps: ProjectServiceDeps) {}

  list(): Promise<ChatProject[]> {
    return this.deps.projects.list();
  }

  async get(id: string): Promise<ChatProject> {
    const project = await this.deps.projects.findById(id);
    if (project == null) {
      throw chatNotFound("project", id);
    }
    return project;
  }

  async create(name: string): Promise<ChatProject> {
    const now = Date.now();
    const project: ChatProject = {
      id: randomUUID(),
      name,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.deps.projects.insert(project);
    return project;
  }

  async delete(id: string): Promise<void> {
    await this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const project = await r.projects.findById(id);
      if (project == null) {
        throw chatNotFound("project", id);
      }
      const sessionList = await r.sessions.listByProject(id);
      for (const session of sessionList) {
        await r.messages.deleteBySession(session.id);
        await deleteSessionFsData(tx, session.id);
        await deleteVfsPrefix(
          r.vfs,
          `/projects/${id}/sessions/${session.id}`,
        );
      }
      await r.sessions.deleteByProject(id);
      await deleteVfsPrefix(r.vfs, projectVfsPrefix(id));
      const deleted = await r.projects.delete(id);
      if (!deleted) {
        throw chatNotFound("project", id);
      }
    });
  }

  async pullTemplate(projectId: string): Promise<void> {
    await this.get(projectId);
    await new DefaultTemplatePullService(this.deps.conn).projectTemplatePull(
      projectId,
    );
  }

  async copy(id: string): Promise<ChatProject> {
    const source = await this.get(id);
    return this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const now = Date.now();
      const copy: ChatProject = {
        id: randomUUID(),
        name: `${source.name} (copy)`,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.projects.insert(copy);
      await copyVfsTree(
        r.vfs,
        `${projectVfsPrefix(id)}/template`,
        `${projectVfsPrefix(copy.id)}/template`,
      );
      return copy;
    });
  }
}
