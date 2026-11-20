/**
 * Single SQLite connection for desktop (VFS + SKSP share one DB).
 * Boundary: main process only — renderer must use IPC.
 */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { NovelMasterBootstrap, TdbcOpen, ZlibAccelerator, type TdbcConnection } from "@novel-master/core";
import { BetterSqlite3Register } from "@novel-master/tdbc-driver-better-sqlite3";
import { TokenizerNodeRegister } from "@novel-master/tokenizer-driver-node";
import { DesktopSksp } from "./register-platform-drivers.js";
import { DesktopDbPath } from "./resolve-db-path.js";
import { TokenizerAssetsRoot } from "./resolve-tokenizer-assets-root.js";

let conn: TdbcConnection | undefined;
let initPromise: Promise<TdbcConnection> | undefined;
let registered = false;

// nm-style 注记：命名镜像 mobile db/connection.ts 的 MobileDb 先例。
export namespace DesktopDb {
  /** Opens (once) the app DB with core bootstrap and platform drivers. */
  export async function get(): Promise<TdbcConnection> {
    if (conn) {
      return conn;
    }
    if (!initPromise) {
      initPromise = (async (): Promise<TdbcConnection> => {
        // SKSP 平台解析失败沿拒绝通道出：本 singleton 的失败通道是 rejection
        // （bootstrap 的 INFRA_BASELINE_TOO_OLD 同款），不为此把
        // DesktopDb.get 改成 Result 去波及全部调用方。
        if (!registered) {
          BetterSqlite3Register.register();
          const sksp = DesktopSksp.registerDriver();
          if (!sksp.ok) return Promise.reject(sksp.error);
          TokenizerNodeRegister.register({ assetsRoot: TokenizerAssetsRoot.resolve() });
          // Node 侧原生 zlib 加速器（P1-4）：core 禁止静态 import node: 模块，
          // 由 desktop main（唯一跑解压的进程；renderer 不引 core 解压路径）注册。
          // 注意：compressZlib 目前恒不传 level，下面三元里的 level 分支是给
          // 将来 level 透传预留的；保持它是因为加速器契约里 level 是可选形参。
          ZlibAccelerator.register({ deflate: (data, level) => (level === undefined ? deflateSync(data) : deflateSync(data, { level })), inflate: (data) => inflateSync(data) });
          registered = true;
        }
        const dbPath = resolve(DesktopDbPath.resolve());
        await mkdir(dirname(dbPath), { recursive: true });
        const c = await TdbcOpen.open(`tdbc:sqlite:file:${dbPath}`, { driver: "better-sqlite3" });
        await NovelMasterBootstrap.bootstrap(c);
        conn = c;
        return c;
      })();
    }
    return initPromise;
  }

  /** Closes the shared connection and clears init state (backup import / rebootstrap). */
  export async function close(): Promise<void> {
    await conn?.close();
    conn = undefined;
    initPromise = undefined;
  }

  /** WAL checkpoint before file-level copy (export backup). */
  export async function checkpoint(connection: TdbcConnection): Promise<void> {
    await connection.execute("PRAGMA wal_checkpoint(FULL)");
  }
}
