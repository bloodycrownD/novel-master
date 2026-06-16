import {
  bootstrapNovelMaster,
  createPersistentPreferences,
  createPersistentState,
  open,
  type PersistentPreferences,
  type PersistentState,
  type TdbcConnection,
} from "@novel-master/core";
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
  createSessionFsService,
  type MessageCheckpointService,
  type SessionFsService,
} from "@novel-master/core/session-fs";
import { createScopedVfsService, type VfsService } from "@novel-master/core/vfs";
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
