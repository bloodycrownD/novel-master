/**
 * Database backup IPC — export/import with rebootstrap on import.
 */
import { BrowserWindow } from "electron";
import type {
  BackupExportResult,
  BackupImportResult,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { rebootstrapDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  exportDatabaseBackup,
  importDatabaseBackup,
} from "../../services/db-backup.service.js";
import {
  acquireDesktopDbMaintenanceBusy,
  releaseDesktopDbMaintenanceBusy,
} from "../../services/db-maintenance-busy.js";
import { formatIpcError } from "../ipc-error.js";

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}

export async function handleBackupExport(): Promise<
  IpcResult<BackupExportResult>
> {
  try {
    const rt = await getDesktopRuntime();
    const result = await exportDatabaseBackup(rt, parentWindow());
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleBackupImport(): Promise<
  IpcResult<BackupImportResult>
> {
  // ic-20 外层令牌：busy 为计数/令牌配对——底层 importDatabaseBackupFromBytes
  // 已 acquire/release 自平衡；这里再持一枚，覆盖「库文件已替换、
  // rebootstrap 尚未完成」的重建窗口，release 严格在 rebootstrap 完成之后
  // （finally 兜底失败路径）。计数语义下与底层令牌互不提前清位。
  acquireDesktopDbMaintenanceBusy();
  try {
    const result = await importDatabaseBackup(parentWindow());
    if (result === "imported") {
      await rebootstrapDesktopRuntime();
    }
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  } finally {
    releaseDesktopDbMaintenanceBusy();
  }
}
