/**
 * Desktop VFS ZIP export/import via Core service + Electron dialog.
 *
 * @module services/vfs-zip
 */
import { AppError, createVfsZipIoService, type VfsScope } from "@novel-master/core/vfs";
import { Result } from "@novel-master/core/errors";
import { dialog, type BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

/**
 * 从目标路径推导 ZIP 基名：子目录取末段、文件取文件名；根目录返回 null
 * （由服务层解析项目名，见 resolveWorkspaceZipName）。
 */
export function zipBaseNameFromPath(targetPath: string): string | null {
  const normalized = targetPath.replace(/\/+$/, "");
  if (normalized === "" || normalized === "/") {
    return null;
  }
  const lastSegment = normalized.slice(normalized.lastIndexOf("/") + 1);
  return lastSegment === "" ? null : lastSegment;
}

/** 根目录导出的备用名：项目已删除或域无 projectId 时使用。 */
const WORKSPACE_FALLBACK_ZIP_NAME = "workspace.zip";

function assertZipArchive(bytes: Uint8Array): Result<void, AppError> {
  const hasMagic = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ok = hasMagic && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
  if (!ok) {
    return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", { detail: `not a ZIP archive (${bytes.length} bytes)` }));
  }
  return Result.ok(undefined);
}

function resolveDirectoryPath(directoryPath?: string): string {
  if (directoryPath == null || directoryPath.trim() === "") {
    return "/";
  }
  return directoryPath;
}

/**
 * 导出 VFS 子树为 ZIP：默认名 = 覆盖名（fileName） > 子目录末段 > 根目录项目名
 * > 备用名；仅作保存框默认值，用户可改。
 */
type ExportVfsZipOptions = { readonly directoryPath?: string; readonly fileName?: string };
type ExportZipResult = Result<"saved" | "cancelled", AppError>;

export async function exportVfsZipWithDialog(runtime: DesktopNovelMasterRuntime, scope: VfsScope, options: ExportVfsZipOptions = {}, parentWindow?: BrowserWindow | null): Promise<ExportZipResult> {
  const directoryPath = resolveDirectoryPath(options.directoryPath);
  const zipSvc = createVfsZipIoService(runtime.conn);
  const exported = await zipSvc.export(scope, { directoryPath });
  // 失败沿 Result 返回，由唯一调用方 handleVfsZipExport 转码。
  if (!exported.ok) return Result.err(exported.error);
  const bytes = exported.value;
  const archiveCheck = assertZipArchive(bytes);
  if (!archiveCheck.ok) return Result.err(archiveCheck.error);

  const base = zipBaseNameFromPath(directoryPath);
  let defaultPath: string;
  if (options.fileName != null) {
    defaultPath = options.fileName;
  } else if (base != null) {
    defaultPath = `${base}.zip`;
  } else {
    // 根目录导出时以项目名命名；解析失败回退备用名，不阻断导出。
    const projectId = (scope as { projectId?: string }).projectId;
    const project = projectId == null ? null : await runtime.projects.get(projectId);
    defaultPath = project?.ok === true ? `${project.value.name}.zip` : WORKSPACE_FALLBACK_ZIP_NAME;
  }

  const win = parentWindow ?? undefined;
  const saveDialogOptions: Electron.SaveDialogOptions = { defaultPath, filters: [{ name: "ZIP Archive", extensions: ["zip"] }] };
  const result = win ? await dialog.showSaveDialog(win, saveDialogOptions) : await dialog.showSaveDialog(saveDialogOptions);
  if (result.canceled || result.filePath == null) {
    return Result.ok("cancelled");
  }
  await writeFile(result.filePath, bytes);
  return Result.ok("saved");
}

/** 弹框选择 zip 并读字节（新建弹窗预检用）；用户取消返回 null（`Result.ok(null)`）。 */
export async function pickVfsZipBytesWithDialog(parentWindow?: BrowserWindow | null): Promise<Result<Uint8Array | null, AppError>> {
  const win = parentWindow ?? undefined;
  const openDialogOptions: Electron.OpenDialogOptions = { filters: [{ name: "ZIP Archive", extensions: ["zip"] }], properties: ["openFile"] };
  const result = win ? await dialog.showOpenDialog(win, openDialogOptions) : await dialog.showOpenDialog(openDialogOptions);
  if (result.canceled || result.filePaths.length === 0) {
    return Result.ok(null);
  }
  const bytes = new Uint8Array(await readFile(result.filePaths[0]!));
  const archiveCheck = assertZipArchive(bytes);
  if (!archiveCheck.ok) return Result.err(archiveCheck.error);
  return Result.ok(bytes);
}

/** 字节直写导入（不弹框）：选文件与确认已在 Renderer 前置完成。 */
type ImportVfsZipBytesOptions = { readonly bytes: Uint8Array; readonly confirmed: boolean; readonly directoryPath?: string };

export async function importVfsZipBytes(runtime: DesktopNovelMasterRuntime, scope: VfsScope, options: ImportVfsZipBytesOptions): Promise<Result<void, AppError>> {
  const directoryPath = resolveDirectoryPath(options.directoryPath);
  const archiveCheck = assertZipArchive(options.bytes);
  if (!archiveCheck.ok) return archiveCheck;
  const zipSvc = createVfsZipIoService(runtime.conn);
  return zipSvc.import(scope, options.bytes, {
    confirmed: options.confirmed,
    directoryPath,
  });
}

type ImportVfsZipOptions = { readonly confirmed: boolean; readonly directoryPath?: string };
type ImportZipResult = Result<"imported" | "cancelled", AppError>;

export async function importVfsZipWithDialog(runtime: DesktopNovelMasterRuntime, scope: VfsScope, options: ImportVfsZipOptions, parentWindow?: BrowserWindow | null): Promise<ImportZipResult> {
  const picked = await pickVfsZipBytesWithDialog(parentWindow);
  if (!picked.ok) return Result.err(picked.error);
  if (picked.value == null) {
    return Result.ok("cancelled");
  }
  const importOptions = { bytes: picked.value, confirmed: options.confirmed, directoryPath: options.directoryPath };
  const imported = await importVfsZipBytes(runtime, scope, importOptions);
  if (!imported.ok) return Result.err(imported.error);
  return Result.ok("imported");
}
