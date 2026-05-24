/**
 * Shared Novel Master CLI runtime (DB open + service factories).
 *
 * @module runtime
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  bootstrapNovelMaster,
  createKkvService,
  createMessageService,
  createProjectService,
  createScopedVfsService,
  createSessionFsService,
  createSessionService,
  open,
  type KkvService,
  type MessageService,
  type ProjectService,
  type SessionFsService,
  type SessionService,
  type TdbcConnection,
  type VfsService,
} from "@novel-master/core";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";
import { extractDbPath } from "./vfs/parse-args.js";

const DEFAULT_DB = "./.novel-master/novel.db";

/**
 * Resolves database file path: NOVEL_MASTER_DB > --db > default.
 */
export function resolveDbPath(argv: readonly string[]): string {
  if (process.env.NOVEL_MASTER_DB) {
    return process.env.NOVEL_MASTER_DB;
  }
  const fromFlag = extractDbPath(argv).dbPath;
  if (fromFlag != null) {
    return fromFlag;
  }
  return DEFAULT_DB;
}

/** Open connection with all domain services wired. */
export interface NovelMasterRuntime {
  readonly conn: TdbcConnection;
  readonly kkv: KkvService;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  readonly sessionFs: SessionFsService;
  globalVfs(): VfsService;
  projectVfs(projectId: string): VfsService;
  sessionVfs(projectId: string, sessionId: string): VfsService;
}

/**
 * Opens SQLite, bootstraps full schema, and returns service handles.
 */
export async function createNovelMasterRuntime(
  argv: readonly string[],
): Promise<NovelMasterRuntime> {
  registerBetterSqlite3Driver();
  const dbPath = resolve(resolveDbPath(argv));
  await mkdir(dirname(dbPath), { recursive: true });
  const conn = await open(`tdbc:sqlite:file:${dbPath}`, {
    driver: "better-sqlite3",
  });
  await bootstrapNovelMaster(conn);
  return {
    conn,
    kkv: createKkvService(conn),
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
