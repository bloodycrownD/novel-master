import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  bootstrapVfs,
  createVfsService,
  open,
  type TdbcConnection,
  type VfsService,
} from "@novel-master/core";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";
import { extractDbPath } from "./parse-args.js";

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

/**
 * Opens SQLite, bootstraps VFS schema, and returns a service instance.
 */
export async function createVfsRuntime(argv: readonly string[]): Promise<{
  vfs: VfsService;
  conn: TdbcConnection;
}> {
  registerBetterSqlite3Driver();
  const dbPath = resolve(resolveDbPath(argv));
  await mkdir(dirname(dbPath), { recursive: true });
  const url = `tdbc:sqlite:file:${dbPath}`;
  const conn = await open(url, { driver: "better-sqlite3" });
  await bootstrapVfs(conn);
  const vfs = createVfsService(conn);
  return { vfs, conn };
}
