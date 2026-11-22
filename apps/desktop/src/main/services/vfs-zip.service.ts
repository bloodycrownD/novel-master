/**
 * Desktop VFS ZIP 选包与字节直写导入（Core service + Electron dialog）。
 *
 * ZIP 基名推导、目录路径规范化与归档魔数校验都在 core（`@novel-master/core/vfs`）；
 * 弹框导出/导入的对话框编排已内联进 `ipc/handlers/vfs.ts`。
 *
 * @module services/vfs-zip
 */
import { VfsServiceFactory, VfsZipArchive, VfsZipPath, type VfsScope } from "@novel-master/core/vfs";
import { AppError } from "@novel-master/core/errors";
import { Result } from "@novel-master/core/errors";
import { dialog, type BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

type ImportVfsZipBytesOptions = { readonly bytes: Uint8Array; readonly confirmed: boolean; readonly directoryPath?: string };

// nm-style 注记：命名对齐 mobile 波 1 裁决（VfsZipService，双端镜像先例）。
export namespace VfsZipService {
    /** 弹框选择 zip 并读字节（新建弹窗预检用）；用户取消返回 null（`Result.ok(null)`）。 */
    export async function pickBytesWithDialog(parentWindow?: BrowserWindow | null): Promise<Result<Uint8Array | null, AppError>> {
        const win = parentWindow ?? undefined;
        const openDialogOptions: Electron.OpenDialogOptions = { filters: [{ name: "ZIP Archive", extensions: ["zip"] }], properties: ["openFile"] };
        const result = win ? await dialog.showOpenDialog(win, openDialogOptions) : await dialog.showOpenDialog(openDialogOptions);
        if (result.canceled || result.filePaths.length === 0) {
            return Result.ok(null);
        }
        const bytes = new Uint8Array(await readFile(result.filePaths[0]!));
        const archiveCheck = VfsZipArchive.assert(bytes, "magic");
        if (!archiveCheck.ok) return Result.err(archiveCheck.error);
        return Result.ok(bytes);
    }

    /** 字节直写导入（不弹框）：选文件与确认已在 Renderer 前置完成。 */
    export async function importBytes(runtime: DesktopNovelMasterRuntime, scope: VfsScope, options: ImportVfsZipBytesOptions): Promise<Result<void, AppError>> {
        const archiveCheck = VfsZipArchive.assert(options.bytes, "magic");
        if (!archiveCheck.ok) return archiveCheck;
        const directoryPathResult = VfsZipPath.resolveDirectoryPath(options.directoryPath);
        if (!directoryPathResult.ok) return Result.err(directoryPathResult.error);
        const zipSvc = VfsServiceFactory.createZipIo(runtime.conn);
        return zipSvc.import(scope, options.bytes, {
            confirmed: options.confirmed,
            directoryPath: directoryPathResult.value,
        });
    }
}

