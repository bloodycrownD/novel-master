import {
  bootstrapNovelMaster,
  createConfigService,
  createKkvService,
  createMessageService,
  createProjectService,
  createScopedVfsService,
  createSessionFsService,
  createSessionService,
  open,
  type ConfigService,
  type KkvService,
  type MessageService,
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
  readonly kkv: KkvService;
  readonly config: ConfigService;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  readonly sessionFs: SessionFsService;
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
    kkv: createKkvService(conn),
    config: createConfigService(conn),
    projects: createProjectService(conn),
    sessions: createSessionService(conn),
    messages: createMessageService(conn),
    sessionFs: createSessionFsService(conn),
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
