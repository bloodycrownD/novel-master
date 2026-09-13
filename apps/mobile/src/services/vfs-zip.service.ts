/**
 * Mobile VFS ZIP export/import via Core service + system file UI.
 * Export: temp cache file + platform "Save as" (local destination).
 * Import: document picker + keepLocalCopy + confirmed full replace.
 */
import {types} from '@react-native-documents/picker';
import {
  createVfsZipIoService,
  type VfsScope,
  type VfsZipImportOptions,
  VfsZipError,
} from '@novel-master/core/vfs';
import {exportBytesViaDocumentPicker, pickAndReadBytes} from './document-io';
import {blobFs, bytesToBase64} from './rn-file-io';
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

/** 根目录导出时以项目名命名；解析失败回退备用名，不阻断导出。 */
async function resolveWorkspaceZipName(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
): Promise<string> {
  const projectId = (scope as {projectId?: string}).projectId;
  if (projectId == null) {
    return WORKSPACE_FALLBACK_ZIP_NAME;
  }
  try {
    const project = await runtime.projects.get(projectId);
    return `${project.name}.zip`;
  } catch {
    return WORKSPACE_FALLBACK_ZIP_NAME;
  }
}

const EOCD_SIGNATURE = 0x06054b50;

/** 自文件尾向前扫描 EOCD（PK\\x05\\x06），用于发现截断或损坏的归档。 */
function findZipEocdOffset(bytes: Uint8Array): number {
  const minEocdSize = 22;
  const maxCommentLen = 0xffff;
  const searchStart = Math.max(0, bytes.length - (minEocdSize + maxCommentLen));
  for (let i = bytes.length - minEocdSize; i >= searchStart; i--) {
    const sig =
      (bytes[i]! |
        (bytes[i + 1]! << 8) |
        (bytes[i + 2]! << 16) |
        (bytes[i + 3]! << 24)) >>>
      0;
    if (sig === EOCD_SIGNATURE) {
      return i;
    }
  }
  return -1;
}

function assertZipArchive(bytes: Uint8Array): void {
  const hasLocalHeader =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
  if (!hasLocalHeader) {
    throw new VfsZipError(
      'INVALID_ZIP',
      `not a ZIP archive (${bytes.length} bytes)`,
    );
  }
  if (findZipEocdOffset(bytes) < 0) {
    throw new VfsZipError(
      'INVALID_ZIP',
      `ZIP archive incomplete or corrupt (${bytes.length} bytes, missing EOCD)`,
    );
  }
}

/**
 * 导出 VFS 子树为 ZIP：默认名 = 覆盖名（fileName） > 子目录末段 > 根目录项目名
 * > 备用名；仅作保存框默认值，用户可改。
 */
export async function exportVfsZip(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options: {
    readonly directoryPath?: string;
    readonly fileName?: string;
  } = {},
): Promise<'saved' | 'cancelled'> {
  const directoryPath =
    options.directoryPath == null || options.directoryPath.trim() === ''
      ? '/'
      : options.directoryPath;
  const zipSvc = createVfsZipIoService(runtime.conn);
  const bytes = await zipSvc.export(scope, {directoryPath});
  assertZipArchive(bytes);

  const base = zipBaseNameFromPath(directoryPath);
  const zipName =
    options.fileName ??
    (base != null
      ? `${base}.zip`
      : await resolveWorkspaceZipName(runtime, scope));

  return exportBytesViaDocumentPicker({
    fileName: zipName,
    mimeType: 'application/zip',
    write: tmpPath =>
      blobFs().writeFile(tmpPath, bytesToBase64(bytes), 'base64'),
  });
}

/** 选 zip + 拷入缓存 + 读字节（导入链路共用）；用户取消返回 null。 */
export async function pickZipFileBytes(): Promise<Uint8Array | null> {
  const bytes = await pickAndReadBytes({
    mimeTypes: [types.zip],
    localFileName: 'import.zip',
    buildCopyError: copyError =>
      new VfsZipError(
        'INVALID_ZIP',
        copyError ?? 'failed to copy picked ZIP into app cache',
      ),
    buildMissingError: fsPath =>
      new VfsZipError('INVALID_ZIP', `ZIP file not found at ${fsPath}`),
  });
  if (bytes == null) {
    return null;
  }
  assertZipArchive(bytes);
  return bytes;
}

export async function importVfsZip(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options: Pick<VfsZipImportOptions, 'confirmed'> & {
    readonly directoryPath?: string;
  },
): Promise<void> {
  const zipBytes = await pickZipFileBytes();
  if (zipBytes == null) {
    return;
  }

  const directoryPath =
    options.directoryPath == null || options.directoryPath.trim() === ''
      ? '/'
      : options.directoryPath;
  const zipSvc = createVfsZipIoService(runtime.conn);
  await zipSvc.import(scope, zipBytes, {
    confirmed: options.confirmed,
    directoryPath,
  });
}
