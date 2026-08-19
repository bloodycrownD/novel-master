import {
  bootstrapNovelMaster,
  createPersistentPreferences,
  createPersistentState,
  decode,
  open,
  type PersistentPreferences,
  type PersistentState,
  type TdbcConnection,
} from "@novel-master/core";
import {
  agentDefinitionSchema,
  createAgentRegistryService,
  type AgentRegistryService,
} from "@novel-master/core/agent";
import {
  createMessageService,
  createProjectService,
  createSessionService,
  type MessageService,
  type ProjectService,
  type SessionService,
} from "@novel-master/core/chat";
import {
  createMessageCheckpointService,
  type MessageCheckpointService,
} from "@novel-master/core/message-checkpoint";
import {
  createSessionFsService,
  type SessionFsService,
} from "@novel-master/core/session-fs";
import {
  createSessionKkvService,
  type SessionKkvService,
} from "@novel-master/core/session-kkv";
import { createScopedVfsService, type VfsService } from "@novel-master/core/vfs";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

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
  registerBetterSqlite3Driver();
  const conn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  await bootstrapNovelMaster(conn);
  const state = createPersistentState(conn);
  const agentRegistry = createAgentRegistryService(conn, state);
  // 种子化一个默认 agent + workspace 指针，让多数调用 ctx.sessions.create() 的测试
  // 无需手动设置 workspace agent 也能跑。
  await agentRegistry.upsert(
    "test-default-agent",
    decode(
      {
        schemaVersion: 1,
        name: "测试默认 Agent",
        prompts: { persist: {}, dynamic: {} },
      },
      agentDefinitionSchema,
    ),
  );
  await state.setCurrentAgentId("test-default-agent");
  return {
    conn,
    state,
    agentRegistry,
    preferences: createPersistentPreferences(conn),
    projects: createProjectService(conn),
    sessions: createSessionService(conn, { state, agentRegistry }),
    messages: createMessageService(conn),
    sessionFs: createSessionFsService(conn),
    messageCheckpoint: createMessageCheckpointService(conn),
    sessionKkv: createSessionKkvService(conn),
    globalVfs: () => createScopedVfsService(conn, { kind: "global" }),
    projectVfs: (projectId) =>
      createScopedVfsService(conn, { kind: "project", projectId }),
    sessionVfs: (projectId, sessionId) =>
      createScopedVfsService(conn, {
        kind: "session",
        projectId,
        sessionId,
      }),
    globalMetaVfs: () => createScopedVfsService(conn, { kind: "global-meta" }),
    projectMetaVfs: (projectId) =>
      createScopedVfsService(conn, { kind: "project-meta", projectId }),
  };
}
