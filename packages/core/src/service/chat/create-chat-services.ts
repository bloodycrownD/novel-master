/**
 * Chat service factories.
 *
 * @module service/chat/create-chat-services
 */

import type { TdbcConnection } from "../../infra/tdbc/connection.js";
import { SqliteProjectRepository } from "../../domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "../../domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "../../domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "../../domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { DefaultProjectService } from "./impl/project.service.js";
import { DefaultSessionService } from "./impl/session.service.js";
import { DefaultMessageService } from "./impl/message.service.js";
import type { ProjectService } from "./project.port.js";
import type { SessionService } from "./session.port.js";
import type { MessageService } from "./message.port.js";
import { deleteSessionFsData } from "../session-fs/create-session-fs-service.js";

/** Shared chat repositories wired from one connection. */
export interface ChatServiceBundle {
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
}

/**
 * Creates project, session, and message services sharing repositories.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 * @param options.deleteSessionFsData - Hook to purge session-fs rows on session delete
 */
export function createChatServices(
  conn: TdbcConnection,
  options?: { deleteSessionFsData?: (sessionId: string) => Promise<void> },
): ChatServiceBundle {
  const deleteFs =
    options?.deleteSessionFsData ??
    ((sessionId: string) => deleteSessionFsData(conn, sessionId));
  const projectRepo = new SqliteProjectRepository(conn);
  const sessionRepo = new SqliteSessionRepository(conn);
  const messageRepo = new SqliteMessageRepository(conn);
  const vfsRepo = new SqliteVfsEntryRepository(conn);

  const projects = new DefaultProjectService({
    conn,
    projects: projectRepo,
    sessions: sessionRepo,
    messages: messageRepo,
    vfs: vfsRepo,
  });

  const sessions = new DefaultSessionService({
    conn,
    projects: projectRepo,
    sessions: sessionRepo,
    messages: messageRepo,
    vfs: vfsRepo,
    deleteSessionFsData: deleteFs,
  });

  const messages = new DefaultMessageService({
    conn,
    sessions: sessionRepo,
    messages: messageRepo,
    vfs: vfsRepo,
  });

  return { projects, sessions, messages };
}

/** Creates a {@link ProjectService} instance. */
export function createProjectService(conn: TdbcConnection): ProjectService {
  return createChatServices(conn).projects;
}

/** Creates a {@link SessionService} instance. */
export function createSessionService(
  conn: TdbcConnection,
  options?: { deleteSessionFsData?: (sessionId: string) => Promise<void> },
): SessionService {
  return createChatServices(conn, options).sessions;
}

/** Creates a {@link MessageService} instance. */
export function createMessageService(conn: TdbcConnection): MessageService {
  return createChatServices(conn).messages;
}
