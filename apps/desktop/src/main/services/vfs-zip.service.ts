/**
 * Desktop VFS ZIP export/import via Core service + Electron dialog.
 *
 * @module services/vfs-zip
 */
import { createVfsZipIoService, VfsZipError, type VfsScope } from "@novel-master/core";
import { dialog, type BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

function vfsZipExportFileName(scope: VfsScope): string {
  if (scope.kind === "global") {
    return "vfs-global.zip";
  }
  if (scope.kind === "project") {
    return `vfs-project-${scope.projectId}.zip`;
  }
  return `vfs-session-${scope.sessionId}.zip`;
}

function assertZipArchive(bytes: Uint8Array): void {
  const ok =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
  if (!ok) {
    throw new VfsZipError(
      "INVALID_ZIP",
      `not a ZIP archive (${bytes.length} bytes)`,
    );
  }
}

export async function exportVfsZipWithDialog(
  runtime: DesktopNovelMasterRuntime,
  scope: VfsScope,
  parentWindow?: BrowserWindow | null,
): Promise<"saved" | "cancelled"> {
  const zipSvc = createVfsZipIoService(runtime.conn);
  const bytes = await zipSvc.export(scope);
  assertZipArchive(bytes);

  const win = parentWindow ?? undefined;
  const result = win
    ? await dialog.showSaveDialog(win, {
        defaultPath: vfsZipExportFileName(scope),
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      })
    : await dialog.showSaveDialog({
        defaultPath: vfsZipExportFileName(scope),
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      });
  if (result.canceled || result.filePath == null) {
    return "cancelled";
  }
  await writeFile(result.filePath, bytes);
  return "saved";
}

export async function importVfsZipWithDialog(
  runtime: DesktopNovelMasterRuntime,
  scope: VfsScope,
  options: { readonly confirmed: boolean },
  parentWindow?: BrowserWindow | null,
): Promise<"imported" | "cancelled"> {
  const win = parentWindow ?? undefined;
  const result = win
    ? await dialog.showOpenDialog(win, {
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
        properties: ["openFile"],
      })
    : await dialog.showOpenDialog({
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
        properties: ["openFile"],
      });
  if (result.canceled || result.filePaths.length === 0) {
    return "cancelled";
  }

  const bytes = new Uint8Array(await readFile(result.filePaths[0]!));
  assertZipArchive(bytes);
  const zipSvc = createVfsZipIoService(runtime.conn);
  await zipSvc.import(scope, bytes, { confirmed: options.confirmed });
  return "imported";
}
