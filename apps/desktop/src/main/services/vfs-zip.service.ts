/**
 * Desktop VFS ZIP export/import via Core service + Electron dialog.
 *
 * @module services/vfs-zip
 */
import { createVfsZipIoService, VfsZipError, type VfsScope } from "@novel-master/core/vfs";
import { dialog, type BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

function vfsZipExportFileName(scope: VfsScope, directoryPath: string): string {
  const pathSuffix =
    directoryPath === "/"
      ? ""
      : `-${directoryPath.replace(/^\//, "").replace(/\//g, "-")}`;
  if (scope.kind === "global") {
    return `vfs-global${pathSuffix}.zip`;
  }
  if (scope.kind === "project") {
    return `vfs-project-${scope.projectId}${pathSuffix}.zip`;
  }
  return `vfs-session-${scope.sessionId}${pathSuffix}.zip`;
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

function resolveDirectoryPath(directoryPath?: string): string {
  if (directoryPath == null || directoryPath.trim() === "") {
    return "/";
  }
  return directoryPath;
}

export async function exportVfsZipWithDialog(
  runtime: DesktopNovelMasterRuntime,
  scope: VfsScope,
  options: { readonly directoryPath?: string } = {},
  parentWindow?: BrowserWindow | null,
): Promise<"saved" | "cancelled"> {
  const directoryPath = resolveDirectoryPath(options.directoryPath);
  const zipSvc = createVfsZipIoService(runtime.conn);
  const bytes = await zipSvc.export(scope, { directoryPath });
  assertZipArchive(bytes);

  const win = parentWindow ?? undefined;
  const defaultPath = vfsZipExportFileName(scope, directoryPath);
  const result = win
    ? await dialog.showSaveDialog(win, {
        defaultPath,
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      })
    : await dialog.showSaveDialog({
        defaultPath,
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
  options: { readonly confirmed: boolean; readonly directoryPath?: string },
  parentWindow?: BrowserWindow | null,
): Promise<"imported" | "cancelled"> {
  const directoryPath = resolveDirectoryPath(options.directoryPath);
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
  await zipSvc.import(scope, bytes, {
    confirmed: options.confirmed,
    directoryPath,
  });
  return "imported";
}
