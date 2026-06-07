import {
  bootstrapNovelMaster,
  createMessageService,
  createPersistentPreferences,
  createPersistentState,
  createProjectService,
  createScopedVfsService,
  createMessageCheckpointService,
  createSessionFsService,
  createSessionService,
  open,
  type MessageCheckpointService,
  type MessageService,
  type PersistentPreferences,
  type PersistentState,
  type ProjectService,
  type SessionFsService,
  type SessionService,
  type TdbcConnection,
  type VfsService,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

export interface NovelMasterTestContext {
  readonly conn: TdbcConnection;
  readonly state: PersistentState;
  readonly preferences: PersistentPreferences;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  readonly sessionFs: SessionFsService;
  readonly messageCheckpoint: MessageCheckpointService;
  globalVfs(): VfsService;
  projectVfs(projectId: string): VfsService;
  sessionVfs(projectId: string, sessionId: string): VfsService;
}

export async function openNovelMasterTestConnection(): Promise<NovelMasterTestContext> {
  registerBetterSqlite3Driver();
  const conn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  await bootstrapNovelMaster(conn);
  return {
    conn,
    state: createPersistentState(conn),
    preferences: createPersistentPreferences(conn),
    projects: createProjectService(conn),
    sessions: createSessionService(conn),
    messages: createMessageService(conn),
    sessionFs: createSessionFsService(conn),
    messageCheckpoint: createMessageCheckpointService(conn),
    globalVfs: () => createScopedVfsService(conn, { kind: "global" }),
    projectVfs: (projectId) =>
      createScopedVfsService(conn, { kind: "project", projectId }),
    sessionVfs: (projectId, sessionId) =>
      createScopedVfsService(conn, {
        kind: "session",
        projectId,
        sessionId,
      }),
  };
}
