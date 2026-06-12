/**
 * 全量 SQLite 数据库导出/导入（文件级拷贝 + 服务商表隔离）。
 *
 * @module services/db-backup
 */
import { copyFile, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import {
  dumpProviderTableSnapshot,
  open,
  restoreProviderTableSnapshot,
  scrubProviderTablesInDatabase,
  type TdbcConnection,
} from "@novel-master/core";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";
import {
  checkpointDesktopDatabase,
  closeDesktopConnection,
  getDesktopConnection,
} from "../runtime/connection.js";
import { resolveDbPath } from "../runtime/resolve-db-path.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

const SQLITE_MAGIC = "SQLite format 3";
const BACKUP_EXT = ".nmbackup";
const EXPORT_ATTACH_ALIAS = "export_db";

function backupFileName(): string {
  return `novel-master-backup-${Date.now()}${BACKUP_EXT}`;
}

function assertSqliteFile(bytes: Uint8Array): void {
  if (bytes.length < 16) {
    throw new Error("文件过小，不是有效的数据库备份");
  }
  const header = String.fromCharCode(...bytes.subarray(0, 16));
  if (!header.startsWith(SQLITE_MAGIC)) {
    throw new Error("不是有效的 SQLite 数据库备份");
  }
}

/**
 * 短连接打开 live DB，仅用于导入后恢复本机服务商三表（不跑 bootstrap）。
 */
async function openDbForProviderRestore(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  const dbPath = resolve(resolveDbPath());
  return open(`tdbc:sqlite:file:${dbPath}`, { driver: "better-sqlite3" });
}

export async function exportDatabaseBackup(
  runtime: DesktopNovelMasterRuntime,
  parentWindow?: BrowserWindow | null,
): Promise<"saved" | "cancelled"> {
  if (isDesktopAgentActive()) {
    throw new Error("Agent 运行中，请稍后再导出数据库");
  }

  await checkpointDesktopDatabase(runtime.conn);
  const dbPath = resolveDbPath();
  const fileName = backupFileName();
  const win = parentWindow ?? undefined;

  const result = win
    ? await dialog.showSaveDialog(win, {
        defaultPath: fileName,
        filters: [{ name: "Novel Master Backup", extensions: ["nmbackup"] }],
      })
    : await dialog.showSaveDialog({
        defaultPath: fileName,
        filters: [{ name: "Novel Master Backup", extensions: ["nmbackup"] }],
      });
  if (result.canceled || result.filePath == null) {
    return "cancelled";
  }

  await copyFile(dbPath, result.filePath);
  await scrubProviderTablesInDatabase(
    runtime.conn,
    result.filePath,
    EXPORT_ATTACH_ALIAS,
  );
  return "saved";
}

export async function importDatabaseBackup(
  parentWindow?: BrowserWindow | null,
): Promise<"imported" | "cancelled"> {
  if (isDesktopAgentActive()) {
    throw new Error("Agent 运行中，请稍后再导入数据库");
  }

  const win = parentWindow ?? undefined;
  const result = win
    ? await dialog.showOpenDialog(win, {
        filters: [
          { name: "Novel Master Backup", extensions: ["nmbackup", "db"] },
        ],
        properties: ["openFile"],
      })
    : await dialog.showOpenDialog({
        filters: [
          { name: "Novel Master Backup", extensions: ["nmbackup", "db"] },
        ],
        properties: ["openFile"],
      });
  if (result.canceled || result.filePaths.length === 0) {
    return "cancelled";
  }

  const pickedPath = result.filePaths[0]!;
  const bytes = await readFile(pickedPath);
  assertSqliteFile(bytes);

  const dbPath = resolveDbPath();
  const bakPath = `${dbPath}.nmbackup.bak`;

  const liveConn = await getDesktopConnection();
  const providerSnapshot = await dumpProviderTableSnapshot(liveConn);

  try {
    await copyFile(dbPath, bakPath).catch(() => undefined);
    await closeDesktopConnection();
    await writeFile(dbPath, bytes);

    const restoreConn = await openDbForProviderRestore();
    try {
      await restoreProviderTableSnapshot(restoreConn, providerSnapshot);
    } finally {
      await restoreConn.close();
    }

    return "imported";
  } catch (error) {
    await copyFile(bakPath, dbPath).catch(() => undefined);
    throw error;
  } finally {
    await unlink(bakPath).catch(() => undefined);
  }
}
