/**
 * Single SQLite connection for desktop (VFS + SKSP share one DB).
 * Boundary: main process only — renderer must use IPC.
 */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { bootstrapNovelMaster, open, registerZlibCodecAccelerator, type TdbcConnection } from "@novel-master/core";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";
import { registerTokenizerNodeDriver } from "@novel-master/tokenizer-driver-node";
import { registerPlatformSkspDriver } from "./register-platform-drivers.js";
import { resolveDbPath } from "./resolve-db-path.js";
import { resolveTokenizerAssetsRoot } from "./resolve-tokenizer-assets-root.js";

let conn: TdbcConnection | undefined;
let initPromise: Promise<TdbcConnection> | undefined;
let registered = false;

function ensureDriversRegistered(): void {
  if (registered) {
    return;
  }
  registerBetterSqlite3Driver();
  registerPlatformSkspDriver();
  registerTokenizerNodeDriver({ assetsRoot: resolveTokenizerAssetsRoot() });
  // Node 侧原生 zlib 加速器（P1-4）：core 禁止静态 import node: 模块，
  // 由 desktop main（唯一跑解压的进程；renderer 不引 core 解压路径）注册。
  registerZlibCodecAccelerator({
    deflate: (data, level) =>
      level === undefined ? deflateSync(data) : deflateSync(data, { level }),
    inflate: (data) => inflateSync(data),
  });
  registered = true;
}

/** Opens (once) the app DB with core bootstrap and platform drivers. */
export async function getDesktopConnection(): Promise<TdbcConnection> {
  if (conn) {
    return conn;
  }
  if (!initPromise) {
    initPromise = (async () => {
      ensureDriversRegistered();
      const dbPath = resolve(resolveDbPath());
      await mkdir(dirname(dbPath), { recursive: true });
      const c = await open(`tdbc:sqlite:file:${dbPath}`, {
        driver: "better-sqlite3",
      });
      await bootstrapNovelMaster(c);
      conn = c;
      return c;
    })();
  }
  return initPromise;
}

/** Closes the shared connection and clears init state (backup import / rebootstrap). */
export async function closeDesktopConnection(): Promise<void> {
  await conn?.close();
  conn = undefined;
  initPromise = undefined;
}

/** WAL checkpoint before file-level copy (export backup). */
export async function checkpointDesktopDatabase(
  connection: TdbcConnection,
): Promise<void> {
  await connection.execute("PRAGMA wal_checkpoint(FULL)");
}
