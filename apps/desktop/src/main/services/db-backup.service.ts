/**
 * Full SQLite database export/import for desktop (file-level copy).
 *
 * @module services/db-backup
 */
import { copyFile, readFile, unlink, writeFile } from "node:fs/promises";
import { dialog, type BrowserWindow } from "electron";
import {
  checkpointDesktopDatabase,
  closeDesktopConnection,
} from "../runtime/connection.js";
import { resolveDbPath } from "../runtime/resolve-db-path.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

const SQLITE_MAGIC = "SQLite format 3";
const BACKUP_EXT = ".nmbackup";

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

  try {
    await copyFile(dbPath, bakPath).catch(() => undefined);
    await closeDesktopConnection();
    await writeFile(dbPath, bytes);
    return "imported";
  } catch (error) {
    await copyFile(bakPath, dbPath).catch(() => undefined);
    throw error;
  } finally {
    await unlink(bakPath).catch(() => undefined);
  }
}
