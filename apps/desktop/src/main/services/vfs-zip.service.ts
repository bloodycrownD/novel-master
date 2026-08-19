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
  if (scope.kind === "global-meta") {
    return `vfs-global-meta${pathSuffix}.zip`;
  }
  if (scope.kind === "project-meta") {
    return `vfs-project-${scope.projectId}-meta${pathSuffix}.zip`;
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

/** 弹框选择 zip 并读字节（新建弹窗预检用）；用户取消返回 null。 */
export async function pickVfsZipBytesWithDialog(
  parentWindow?: BrowserWindow | null,
): Promise<Uint8Array | null> {
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
    return null;
  }
  const bytes = new Uint8Array(await readFile(result.filePaths[0]!));
  assertZipArchive(bytes);
  return bytes;
}

/** 字节直写导入（不弹框）：选文件与确认已在 Renderer 前置完成。 */
export async function importVfsZipBytes(
  runtime: DesktopNovelMasterRuntime,
  scope: VfsScope,
  options: {
    readonly bytes: Uint8Array;
    readonly confirmed: boolean;
    readonly directoryPath?: string;
  },
): Promise<void> {
  const directoryPath = resolveDirectoryPath(options.directoryPath);
  assertZipArchive(options.bytes);
  const zipSvc = createVfsZipIoService(runtime.conn);
  await zipSvc.import(scope, options.bytes, {
    confirmed: options.confirmed,
    directoryPath,
  });
}

export async function importVfsZipWithDialog(
  runtime: DesktopNovelMasterRuntime,
  scope: VfsScope,
  options: { readonly confirmed: boolean; readonly directoryPath?: string },
  parentWindow?: BrowserWindow | null,
): Promise<"imported" | "cancelled"> {
  const bytes = await pickVfsZipBytesWithDialog(parentWindow);
  if (bytes == null) {
    return "cancelled";
  }
  await importVfsZipBytes(runtime, scope, {
    bytes,
    confirmed: options.confirmed,
    directoryPath: options.directoryPath,
  });
  return "imported";
}
