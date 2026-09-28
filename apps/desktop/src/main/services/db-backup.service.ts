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
import { clearDesktopRuntimeHandle } from "../runtime/desktop-runtime-singleton.js";
import { resolveDbPath } from "../runtime/resolve-db-path.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import {
  acquireDesktopDbMaintenanceBusy,
  releaseDesktopDbMaintenanceBusy,
} from "./db-maintenance-busy.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

/** Close live DB only after dropping the runtime handle (avoids stale conn use). */
async function closeLiveDbForBackupImport(): Promise<void> {
  clearDesktopRuntimeHandle();
  await closeDesktopConnection();
}

const SQLITE_MAGIC = "SQLite format 3";
const EXPORT_ATTACH_ALIAS = "export_db";

function backupFileName(): string {
  return "nmbackup.db";
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

/**
 * 将数据库导出到指定路径（checkpoint → 拷贝 → 清除服务商三表），无文件对话框。
 * 调用方负责 Agent 守卫与目标路径管理。
 *
 * ic-20：busy 为计数/令牌配对——底层入口 acquire、出口 finally release
 * 自平衡（云同步等直接调底层的路径「期间 true、结束后 false」天然成立）；
 * 最外层流程（备份导入 / 云同步 pull）另持一枚令牌、在 rebootstrap 完成
 * 之后 release，含重建窗口的完整互斥。计数语义下嵌套调用互不提前清位。
 */
export async function exportDatabaseBackupToPath(
  runtime: DesktopNovelMasterRuntime,
  destPath: string,
): Promise<void> {
  acquireDesktopDbMaintenanceBusy();
  try {
    await checkpointDesktopDatabase(runtime.conn);
    const dbPath = resolveDbPath();
    await copyFile(dbPath, destPath);
    await scrubProviderTablesInDatabase(
      runtime.conn,
      destPath,
      EXPORT_ATTACH_ALIAS,
    );
  } finally {
    releaseDesktopDbMaintenanceBusy();
  }
}

/**
 * 从本地快照文件导入数据库（dump → close → cp 替换 → restore），无对话框与 rebootstrap。
 * 调用方须在成功后执行 rebootstrap。
 *
 * ic-20：busy 为计数/令牌配对——底层 acquire/release 自平衡，覆盖「关连接
 * + 覆盖库文件」窗口；最外层流程在 rebootstrap 完成之后 release（见
 * backup.ts / cloud-sync.ts 调用路径），含重建窗口的完整互斥。
 */
export async function importDatabaseBackupFromPath(
  srcPath: string,
): Promise<void> {
  acquireDesktopDbMaintenanceBusy();
  try {
    const header = await readFile(srcPath, { encoding: null });
    assertSqliteFile(new Uint8Array(header.subarray(0, 16)));

    const dbPath = resolveDbPath();
    const bakPath = `${dbPath}.nmbackup.bak`;

    const liveConn = await getDesktopConnection();
    const providerSnapshot = await dumpProviderTableSnapshot(liveConn);

    try {
      await copyFile(dbPath, bakPath).catch(() => undefined);
      await closeLiveDbForBackupImport();
      await copyFile(srcPath, dbPath);

      const restoreConn = await openDbForProviderRestore();
      try {
        await restoreProviderTableSnapshot(restoreConn, providerSnapshot);
      } finally {
        await restoreConn.close();
      }
    } catch (error) {
      await copyFile(bakPath, dbPath).catch(() => undefined);
      throw error;
    } finally {
      await unlink(bakPath).catch(() => undefined);
    }
  } finally {
    releaseDesktopDbMaintenanceBusy();
  }
}

/**
 * 从内存中的备份字节导入数据库（dump → close → replace → restore），无对话框与 rebootstrap。
 * 调用方须在成功后执行 rebootstrap。
 *
 * ic-20：busy 为计数/令牌配对——同 {@link importDatabaseBackupFromPath}。
 */
export async function importDatabaseBackupFromBytes(
  bytes: Uint8Array,
): Promise<void> {
  acquireDesktopDbMaintenanceBusy();
  try {
    assertSqliteFile(bytes);

    const dbPath = resolveDbPath();
    const bakPath = `${dbPath}.nmbackup.bak`;

    const liveConn = await getDesktopConnection();
    const providerSnapshot = await dumpProviderTableSnapshot(liveConn);

    try {
      await copyFile(dbPath, bakPath).catch(() => undefined);
      await closeLiveDbForBackupImport();
      await writeFile(dbPath, bytes);

      const restoreConn = await openDbForProviderRestore();
      try {
        await restoreProviderTableSnapshot(restoreConn, providerSnapshot);
      } finally {
        await restoreConn.close();
      }
    } catch (error) {
      await copyFile(bakPath, dbPath).catch(() => undefined);
      throw error;
    } finally {
      await unlink(bakPath).catch(() => undefined);
    }
  } finally {
    releaseDesktopDbMaintenanceBusy();
  }
}

export async function exportDatabaseBackup(
  runtime: DesktopNovelMasterRuntime,
  parentWindow?: BrowserWindow | null,
): Promise<"saved" | "cancelled"> {
  if (isDesktopAgentActive()) {
    throw new Error("Agent 运行中，请稍后再导出数据库");
  }

  const fileName = backupFileName();
  const win = parentWindow ?? undefined;

  const result = win
    ? await dialog.showSaveDialog(win, {
        defaultPath: fileName,
        filters: [
          { name: "Novel Master Backup", extensions: ["db", "nmbackup"] },
        ],
      })
    : await dialog.showSaveDialog({
        defaultPath: fileName,
        filters: [
          { name: "Novel Master Backup", extensions: ["db", "nmbackup"] },
        ],
      });
  if (result.canceled || result.filePath == null) {
    return "cancelled";
  }

  await exportDatabaseBackupToPath(runtime, result.filePath);
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
  await importDatabaseBackupFromBytes(bytes);
  return "imported";
}
