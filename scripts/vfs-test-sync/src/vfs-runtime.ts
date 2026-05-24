import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  bootstrapNovelMaster,
  createVfsService,
  open,
  type TdbcConnection,
  type VfsService,
} from "@novel-master/core";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";

const DEFAULT_DB = "./.novel-master/novel.db";

/**
 * Resolves database file path: NOVEL_MASTER_DB > --db > default.
 */
export function resolveDbPath(argv: readonly string[]): string {
  if (process.env.NOVEL_MASTER_DB) {
    return process.env.NOVEL_MASTER_DB;
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") {
      const value = argv[i + 1];
      if (value != null) {
        return value;
      }
    }
  }
  return DEFAULT_DB;
}

/**
 * Opens SQLite, bootstraps VFS schema, and returns a service instance.
 * Mirrors {@link apps/cli/src/vfs/runtime.ts} bootstrap logic.
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
  await bootstrapNovelMaster(conn);
  const vfs = createVfsService(conn);
  return { vfs, conn };
}
