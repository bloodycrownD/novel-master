/**
 * Desktop VFS ZIP export/import via Core service + Electron dialog.
 *
 * ZIP 基名推导、目录路径规范化与归档魔数校验都在 core（`@novel-master/core/vfs`）；
 * 本模块只保留 Electron 对话框与文件落盘。
 *
 * @module services/vfs-zip
 */
import { VfsServiceFactory, assertZipArchive, resolveZipDirectoryPath, zipBaseNameFromPath, type VfsScope } from "@novel-master/core/vfs";
import { AppError } from "@novel-master/core/errors";
import { Result } from "@novel-master/core/errors";
import { dialog, type BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

/** 根目录导出的备用名：项目已删除或域无 projectId 时使用。 */
const WORKSPACE_FALLBACK_ZIP_NAME = "workspace.zip";

/**
 * 导出 VFS 子树为 ZIP：默认名 = 覆盖名（fileName） > 子目录末段 > 根目录项目名
 * > 备用名；仅作保存框默认值，用户可改。
 */
type ExportVfsZipOptions = { readonly directoryPath?: string; readonly fileName?: string };
type ExportZipResult = Result<"saved" | "cancelled", AppError>;

export async function exportVfsZipWithDialog(runtime: DesktopNovelMasterRuntime, scope: VfsScope, options: ExportVfsZipOptions = {}, parentWindow?: BrowserWindow | null): Promise<ExportZipResult> {
  const directoryPathResult = resolveZipDirectoryPath(options.directoryPath);
  if (!directoryPathResult.ok) return Result.err(directoryPathResult.error);
  const directoryPath = directoryPathResult.value;
  const zipSvc = VfsServiceFactory.createZipIo(runtime.conn);
  const exported = await zipSvc.export(scope, { directoryPath });
  // 失败沿 Result 返回，由唯一调用方 handleVfsZipExport 转码。
  if (!exported.ok) return Result.err(exported.error);
  const bytes = exported.value;
  const archiveCheck = assertZipArchive(bytes, "magic");
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
  const archiveCheck = assertZipArchive(bytes, "magic");
  if (!archiveCheck.ok) return Result.err(archiveCheck.error);
  return Result.ok(bytes);
}

/** 字节直写导入（不弹框）：选文件与确认已在 Renderer 前置完成。 */
type ImportVfsZipBytesOptions = { readonly bytes: Uint8Array; readonly confirmed: boolean; readonly directoryPath?: string };

export async function importVfsZipBytes(runtime: DesktopNovelMasterRuntime, scope: VfsScope, options: ImportVfsZipBytesOptions): Promise<Result<void, AppError>> {
  const archiveCheck = assertZipArchive(options.bytes, "magic");
  if (!archiveCheck.ok) return archiveCheck;
  const directoryPathResult = resolveZipDirectoryPath(options.directoryPath);
  if (!directoryPathResult.ok) return Result.err(directoryPathResult.error);
  const zipSvc = VfsServiceFactory.createZipIo(runtime.conn);
  return zipSvc.import(scope, options.bytes, {
    confirmed: options.confirmed,
    directoryPath: directoryPathResult.value,
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
