/**
 * Mobile VFS ZIP export/import via Core service + system file UI.
 * Export: temp cache file + platform "Save as" (local destination).
 * Import: document picker + keepLocalCopy + confirmed full replace.
 */
import {types} from '@react-native-documents/picker';
import {AppError, createVfsZipIoService, type VfsScope, type VfsZipImportOptions} from '@novel-master/core/vfs';
import {Encoding} from '@novel-master/core/common';
import {Result} from '@novel-master/core/errors';
import {exportBytesViaDocumentPicker, pickAndReadBytes, type PickAndReadOptions} from './document-io';
import {blobFs} from './rn-file-io';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/**
 * 从目标路径推导 ZIP 基名：子目录取末段、文件取文件名；根目录返回 null
 * （由服务层解析项目名，见 resolveWorkspaceZipName）。
 */
export function zipBaseNameFromPath(targetPath: string): string | null {
  const normalized = targetPath.replace(/\/+$/, '');
  if (normalized === '' || normalized === '/') {
    return null;
  }
  const lastSegment = normalized.slice(normalized.lastIndexOf('/') + 1);
  return lastSegment === '' ? null : lastSegment;
}

/** 根目录导出的备用名：项目已删除或域无 projectId 时使用。 */
const WORKSPACE_FALLBACK_ZIP_NAME = 'workspace.zip';

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

const EOCD_SIGNATURE = 0x06054b50;

function assertZipArchive(bytes: Uint8Array): Result<void, AppError> {
  const isZipLocal = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const hasLocalHeader = isZipLocal && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
  if (!hasLocalHeader) {
    return Result.err(new AppError('VFS_ZIP_INVALID_ARCHIVE', {detail: `not a ZIP archive (${bytes.length} bytes)`}));
  }
  // 自文件尾向前扫描 EOCD（PK\\x05\\x06），用于发现截断或损坏的归档。
  const minEocdSize = 22;
  const maxCommentLen = 0xffff;
  const searchStart = Math.max(0, bytes.length - (minEocdSize + maxCommentLen));
  let eocdOffset = -1;
  for (let i = bytes.length - minEocdSize; i >= searchStart; i--) {
    const sig = (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0;
    if (sig === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    return Result.err(new AppError('VFS_ZIP_INVALID_ARCHIVE', {detail: `ZIP archive incomplete or corrupt (${bytes.length} bytes, missing EOCD)`}));
  }
  return Result.ok(undefined);
}

/**
 * 导出 VFS 子树为 ZIP：默认名 = 覆盖名（fileName） > 子目录末段 > 根目录项目名
 * > 备用名；仅作保存框默认值，用户可改。
 */
type ExportVfsZipOptions = {
  readonly directoryPath?: string;
  readonly fileName?: string;
};

export async function exportVfsZip(runtime: MobileNovelMasterRuntime, scope: VfsScope, options: ExportVfsZipOptions = {}): Promise<Result<'saved' | 'cancelled', AppError>> {
  const directoryPath = options.directoryPath == null || options.directoryPath.trim() === '' ? '/' : options.directoryPath;
  const zipSvc = createVfsZipIoService(runtime.conn);
  const exported = await zipSvc.export(scope, {directoryPath});
  if (!exported.ok) return Result.err(exported.error);
  const bytes = exported.value;
  const archiveCheck = assertZipArchive(bytes);
  if (!archiveCheck.ok) return Result.err(archiveCheck.error);

  const base = zipBaseNameFromPath(directoryPath);
  const zipName = options.fileName ?? (base != null ? `${base}.zip` : await resolveWorkspaceZipName(runtime, scope));

  const exportResult = await exportBytesViaDocumentPicker({
    fileName: zipName,
    mimeType: 'application/zip',
    write: tmpPath => blobFs().writeFile(tmpPath, Encoding.bytesToBase64(bytes), 'base64'),
  });
  return Result.ok(exportResult);
}

/** 选 zip + 拷入缓存 + 读字节（导入链路共用）；用户取消返回 null（`Result.ok(null)`）。 */
export async function pickZipFileBytes(): Promise<Result<Uint8Array | null, AppError>> {
  const pickOptions: PickAndReadOptions = {
    mimeTypes: [types.zip],
    localFileName: 'import.zip',
    buildCopyError: copyError => new AppError('VFS_ZIP_INVALID_ARCHIVE', {detail: copyError ?? 'failed to copy picked ZIP into app cache'}),
    buildMissingError: fsPath => new AppError('VFS_ZIP_INVALID_ARCHIVE', {detail: `ZIP file not found at ${fsPath}`}),
  };
  const bytes = await pickAndReadBytes(pickOptions);
  if (bytes == null) {
    return Result.ok(null);
  }
  const archiveCheck = assertZipArchive(bytes);
  if (!archiveCheck.ok) return Result.err(archiveCheck.error);
  return Result.ok(bytes);
}

type ImportVfsZipOptions = Pick<VfsZipImportOptions, 'confirmed'> & {
  readonly directoryPath?: string;
};

export async function importVfsZip(runtime: MobileNovelMasterRuntime, scope: VfsScope, options: ImportVfsZipOptions): Promise<Result<void, AppError>> {
  const picked = await pickZipFileBytes();
  if (!picked.ok) return Result.err(picked.error);
  if (picked.value == null) {
    return Result.ok(undefined);
  }
  const zipBytes = picked.value;

  const directoryPath = options.directoryPath == null || options.directoryPath.trim() === '' ? '/' : options.directoryPath;
  const zipSvc = createVfsZipIoService(runtime.conn);
  return zipSvc.import(scope, zipBytes, {
    confirmed: options.confirmed,
    directoryPath,
  });
}
