import {  NovelMasterBootstrap, createPersistentPreferences, PersistentStateFactory, SerializationDecode, TdbcOpen, type PersistentPreferences, type PersistentState, type TdbcConnection  } from "@novel-master/core";
import {  agentDefinitionSchema, AgentServiceFactory, type AgentRegistryService  } from "@novel-master/core/agent";
import {  ChatServiceFactory, type MessageService, type ProjectService, type SessionService  } from "@novel-master/core/chat";
import {  SqliteProjectRepository  } from "../../src/domain/chat/repositories/impl/sqlite-project.repository.js";
import {  SqliteSessionRepository  } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
import {  SqliteMessageRepository  } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {  SqliteVfsEntryRepository  } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {  DefaultProjectService  } from "../../src/service/chat/impl/project.service.js";
import {  DefaultSessionService  } from "../../src/service/chat/impl/session.service.js";
import {  MessageCheckpointFactory, type MessageCheckpointService  } from "@novel-master/core/message-checkpoint";
import {  SessionFsServiceFactory, type SessionFsService  } from "@novel-master/core/session-fs";
import {  SessionKkvServiceFactory, type SessionKkvService  } from "@novel-master/core/session-kkv";
import {  VfsServiceFactory, type VfsService  } from "@novel-master/core/vfs";
import {  BETTER_SQLITE3_DRIVER_NAME, BetterSqlite3Register  } from "@novel-master/tdbc-driver-better-sqlite3";

export interface NovelMasterTestContext {
  readonly conn: TdbcConnection;
  readonly state: PersistentState;
  readonly preferences: PersistentPreferences;
  readonly agentRegistry: AgentRegistryService;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  readonly sessionFs: SessionFsService;
  readonly sessionKkv: SessionKkvService;
  readonly messageCheckpoint: MessageCheckpointService;
  globalVfs(): VfsService;
  projectVfs(projectId: string): VfsService;
  sessionVfs(projectId: string, sessionId: string): VfsService;
  globalMetaVfs(): VfsService;
  projectMetaVfs(projectId: string): VfsService;
}

export async function openNovelMasterTestConnection(): Promise<NovelMasterTestContext> {
  BetterSqlite3Register.register();
  const conn = await TdbcOpen.open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  await NovelMasterBootstrap.bootstrap(conn);
  const state = PersistentStateFactory.create(conn);
  const agentRegistry = AgentServiceFactory.createRegistry(conn, state);
  // 种子化一个默认 agent + workspace 指针，让多数调用 ctx.sessions.create() 的测试
  // 无需手动设置 workspace agent 也能跑。
  await agentRegistry.upsert(
    "test-default-agent",
    SerializationDecode.decode(
      {
        schemaVersion: 1,
        name: "测试默认 Agent",
        prompts: { persist: {}, dynamic: {} },
      },
      agentDefinitionSchema,
    ),
  );
  await state.setCurrentAgentId("test-default-agent");
  const projectRepo = new SqliteProjectRepository(conn);
  const sessionRepo = new SqliteSessionRepository(conn);
  const messageRepo = new SqliteMessageRepository(conn);
  const vfsRepo = new SqliteVfsEntryRepository(conn);
  return {
    conn,
    state,
    agentRegistry,
    preferences: createPersistentPreferences(conn),
    projects: new DefaultProjectService({ conn, projects: projectRepo, sessions: sessionRepo, messages: messageRepo, vfs: vfsRepo }),
    sessions: new DefaultSessionService({ conn, projects: projectRepo, sessions: sessionRepo, messages: messageRepo, vfs: vfsRepo, state, agentRegistry }),
    messages: ChatServiceFactory.createMessage(conn),
    sessionFs: SessionFsServiceFactory.create(conn),
    messageCheckpoint: MessageCheckpointFactory.create(conn),
    sessionKkv: SessionKkvServiceFactory.create(conn),
    globalVfs: () => VfsServiceFactory.createScoped(conn, { kind: "global" }),
    projectVfs: (projectId) =>
      VfsServiceFactory.createScoped(conn, { kind: "project", projectId }),
    sessionVfs: (projectId, sessionId) =>
      VfsServiceFactory.createScoped(conn, {
        kind: "session",
        projectId,
        sessionId,
      }),
    globalMetaVfs: () => VfsServiceFactory.createScoped(conn, { kind: "global-meta" }),
    projectMetaVfs: (projectId) =>
      VfsServiceFactory.createScoped(conn, { kind: "project-meta", projectId }),
  };
}
