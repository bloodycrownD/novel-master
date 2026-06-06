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
  try {
    const result = await importDatabaseBackup(parentWindow());
    if (result === "imported") {
      await rebootstrapDesktopRuntime();
    }
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
