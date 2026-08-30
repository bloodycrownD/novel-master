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
import {
  exportBytesViaDocumentPicker,
  pickAndReadBytes,
} from './document-io';
import {blobFs, bytesToBase64} from './rn-file-io';
import type {MobileNovelMasterRuntime} from '../runtime/types';

function vfsZipExportFileName(scope: VfsScope, directoryPath: string): string {
  const pathSuffix =
    directoryPath === '/'
      ? ''
      : `-${directoryPath.replace(/^\//, '').replace(/\//g, '-')}`;
  if (scope.kind === 'global') {
    return `vfs-global${pathSuffix}.zip`;
  }
  if (scope.kind === 'global-meta') {
    return `vfs-global-meta${pathSuffix}.zip`;
  }
  if (scope.kind === 'project-meta') {
    return `vfs-project-${scope.projectId}-meta${pathSuffix}.zip`;
  }
  if (scope.kind === 'project') {
    return `vfs-project-${scope.projectId}${pathSuffix}.zip`;
  }
  return `vfs-session-${scope.sessionId}${pathSuffix}.zip`;
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

export async function exportVfsZip(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options: { readonly directoryPath?: string } = {},
): Promise<'saved' | 'cancelled'> {
  const directoryPath =
    options.directoryPath == null || options.directoryPath.trim() === ''
      ? '/'
      : options.directoryPath;
  const zipSvc = createVfsZipIoService(runtime.conn);
  const bytes = await zipSvc.export(scope, { directoryPath });
  assertZipArchive(bytes);

  return exportBytesViaDocumentPicker({
    fileName: vfsZipExportFileName(scope, directoryPath),
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
