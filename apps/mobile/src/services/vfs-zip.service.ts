/**
 * Mobile VFS ZIP export/import via Core service + system file UI.
 * Export: temp cache file + platform "Save as" (local destination).
 * Import: document picker + keepLocalCopy + confirmed full replace.
 *
 * ZIP 基名推导、目录路径规范化与归档完整性校验都在 core（`@novel-master/core/vfs`）；
 * 本模块只保留 picker / 缓存落盘。
 */
import {types} from '@react-native-documents/picker';
import {AppError} from '@novel-master/core/errors';
import {
    VfsServiceFactory,
    VfsZipArchive,
    VfsZipPath,
    type VfsScope,
    type VfsZipImportOptions,
} from '@novel-master/core/vfs';
import {Encoding} from '@novel-master/core/common';
import {Result} from '@novel-master/core/errors';
import {DocumentIo, type PickAndReadOptions} from './document-io';
import {RnFileIo} from './rn-file-io';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** 根目录导出的备用名：项目已删除或域无 projectId 时使用。 */
const WORKSPACE_FALLBACK_ZIP_NAME = 'workspace.zip';

/**
 * 导出 VFS 子树为 ZIP：默认名 = 覆盖名（fileName） > 子目录末段 > 根目录项目名
 * > 备用名；仅作保存框默认值，用户可改。
 */
type ExportVfsZipOptions = {
    readonly directoryPath?: string;
    readonly fileName?: string;
};

type ImportVfsZipOptions = Pick<VfsZipImportOptions, 'confirmed'> & {
    readonly directoryPath?: string;
};

export namespace VfsZipService {
    // nm-style: keep-local — 独立 IO 管线（项目名解析 → `.zip` 命名）；Result/catch 双层回退到备用名是不变量，内联进条件 await 会打散兜底语义。
    /** 根目录导出时以项目名命名；解析失败回退备用名，不阻断导出。 */
    async function resolveWorkspaceZipName(runtime: MobileNovelMasterRuntime, scope: VfsScope): Promise<string> {
        const projectId = (scope as {projectId?: string}).projectId;
        if (projectId == null) {
            return WORKSPACE_FALLBACK_ZIP_NAME;
        }
        try {
            const project = await runtime.projects.get(projectId);
            // 解析失败回退备用名，不阻断导出（错误通道迁移四期：Result 失败同款兜底）。
            if (!project.ok) {
                return WORKSPACE_FALLBACK_ZIP_NAME;
            }
            return `${project.value.name}.zip`;
        } catch {
            return WORKSPACE_FALLBACK_ZIP_NAME;
        }
    }

    export async function exportZip(runtime: MobileNovelMasterRuntime, scope: VfsScope, options: ExportVfsZipOptions = {}): Promise<Result<'saved' | 'cancelled', AppError>> {
        const directoryPathResult = VfsZipPath.resolveDirectoryPath(options.directoryPath);
        if (!directoryPathResult.ok) return Result.err(directoryPathResult.error);
        const directoryPath = directoryPathResult.value;
        const zipSvc = VfsServiceFactory.createZipIo(runtime.conn);
        const exported = await zipSvc.export(scope, {directoryPath});
        if (!exported.ok) return Result.err(exported.error);
        const bytes = exported.value;
        const archiveCheck = VfsZipArchive.assert(bytes, 'complete');
        if (!archiveCheck.ok) return Result.err(archiveCheck.error);

        const base = VfsZipPath.baseNameFromPath(directoryPath);
        const zipName = options.fileName ?? (base != null ? `${base}.zip` : await resolveWorkspaceZipName(runtime, scope));

        return Result.ok(await DocumentIo.exportBytes({
            fileName: zipName,
            mimeType: 'application/zip',
            write: tmpPath => RnFileIo.blobFs().writeFile(tmpPath, Encoding.bytesToBase64(bytes), 'base64'),
        }));
    }

    /** 选 zip + 拷入缓存 + 读字节（导入链路共用）；用户取消返回 null（`Result.ok(null)`）。 */
    export async function pickBytes(): Promise<Result<Uint8Array | null, AppError>> {
        const pickOptions: PickAndReadOptions = {
            mimeTypes: [types.zip],
            localFileName: 'import.zip',
            buildCopyError: copyError => new AppError('VFS_ZIP_INVALID_ARCHIVE', {detail: copyError ?? 'failed to copy picked ZIP into app cache'}),
            buildMissingError: fsPath => new AppError('VFS_ZIP_INVALID_ARCHIVE', {detail: `ZIP file not found at ${fsPath}`}),
        };
        const bytes = await DocumentIo.pickAndReadBytes(pickOptions);
        if (bytes == null) {
            return Result.ok(null);
        }
        const archiveCheck = VfsZipArchive.assert(bytes, 'complete');
        if (!archiveCheck.ok) return Result.err(archiveCheck.error);
        return Result.ok(bytes);
    }

    // nm-style: keep-public — vfs-zip.service.test.ts 多用例直接 import 断言；4 个 file-manager 集成测试 mock 模块接缝，测试锁名（锁名随成员迁移为 VfsZipService.importZip，消费点波次同步）
    export async function importZip(runtime: MobileNovelMasterRuntime, scope: VfsScope, options: ImportVfsZipOptions): Promise<Result<void, AppError>> {
        const picked = await pickBytes();
        if (!picked.ok) return Result.err(picked.error);
        if (picked.value == null) {
            return Result.ok(undefined);
        }
        const zipBytes = picked.value;

        const directoryPathResult = VfsZipPath.resolveDirectoryPath(options.directoryPath);
        if (!directoryPathResult.ok) return Result.err(directoryPathResult.error);
        const zipSvc = VfsServiceFactory.createZipIo(runtime.conn);
        return zipSvc.import(scope, zipBytes, {
            confirmed: options.confirmed,
            directoryPath: directoryPathResult.value,
        });
    }
}
