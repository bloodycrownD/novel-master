/**
 * Chat service factories.
 *
 * @module service/chat/create-chat-services
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteProjectRepository } from "@/domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { DefaultProjectService } from "./impl/project.service.js";
import { DefaultSessionService } from "./impl/session.service.js";
import { DefaultMessageService } from "./impl/message.service.js";
import { DefaultUsageStatsService } from "./impl/usage-stats.service.js";
import type { ProjectService } from "./project.port.js";
import type { SessionService } from "./session.port.js";
import type { MessageService } from "./message.port.js";
import type { UsageStatsService } from "./usage-stats.port.js";

/** Shared chat services wired from one connection. */
export interface ChatServiceBundle {
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  readonly usageStats: UsageStatsService;
}

/**
 * Session service 创建所需的额外依赖：读 workspace 当前 agentId/modelId
 * 以及 registry 首项回落。
 */
export interface ChatServicesSessionDeps {
  readonly state: {
    getCurrentAgentId(): Promise<string | null | undefined>;
    getCurrentModelId(): Promise<string | null | undefined>;
  };
  readonly agentRegistry: {
    listAgentIds(): Promise<readonly string[]>;
  };
}

/**
 * Creates project, session, and message services sharing repositories.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 * @param sessionDeps - Session service 创建会话时读 workspace 当前指针所需；
 *   projects/messages 不消费此参数。
 */
export function createChatServices(
  conn: TdbcConnection,
  sessionDeps: ChatServicesSessionDeps
): ChatServiceBundle {
  const projectRepo = new SqliteProjectRepository(conn);
  const sessionRepo = new SqliteSessionRepository(conn);
  const messageRepo = new SqliteMessageRepository(conn);
  const vfsRepo = new SqliteVfsEntryRepository(conn);
  const checkpointRepo = new SqliteMessageCheckpointRepository(conn);
  const revisionRepo = new SqliteVfsRevisionRepository(conn);

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
    state: sessionDeps.state,
    agentRegistry: sessionDeps.agentRegistry,
  });

  const messages = new DefaultMessageService({
    conn,
    sessions: sessionRepo,
    messages: messageRepo,
    vfs: vfsRepo,
    checkpoints: checkpointRepo,
    revisions: revisionRepo,
  });

  const usageStats = new DefaultUsageStatsService(conn);

  return { projects, sessions, messages, usageStats };
}

/** Creates a {@link ProjectService} instance. */
export function createProjectService(conn: TdbcConnection): ProjectService {
  return createChatServices(conn, _stubSessionDeps()).projects;
}

/** Creates a {@link SessionService} instance. */
export function createSessionService(
  conn: TdbcConnection,
  sessionDeps: ChatServicesSessionDeps
): SessionService {
  return createChatServices(conn, sessionDeps).sessions;
}

/** Creates a {@link MessageService} instance. */
export function createMessageService(conn: TdbcConnection): MessageService {
  return createChatServices(conn, _stubSessionDeps()).messages;
}

/** Creates a {@link UsageStatsService} instance. */
export function createUsageStatsService(
  conn: TdbcConnection
): UsageStatsService {
  return createChatServices(conn, _stubSessionDeps()).usageStats;
}

/**
 * `createProjectService` / `createMessageService` 不消费 session 依赖，
 * 但复用 `createChatServices` 时仍需构造一份占位（永不触发 state/registry 调用）。
 */
function _stubSessionDeps(): ChatServicesSessionDeps {
  return {
    state: {
      getCurrentAgentId: async () => undefined,
      getCurrentModelId: async () => undefined,
    },
    agentRegistry: {
      listAgentIds: async () => [],
    },
  };
}
