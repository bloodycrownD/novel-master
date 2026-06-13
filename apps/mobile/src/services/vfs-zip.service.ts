/**
 * Mobile VFS ZIP export/import via Core service + system file UI.
 * Export: temp cache file + platform "Save as" (local destination).
 * Import: document picker + keepLocalCopy + confirmed full replace.
 */
import {Platform} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  createVfsZipIoService,
  type VfsScope,
  type VfsZipBuildFn,
  type VfsZipImportOptions,
  VfsZipError,
} from '@novel-master/core';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  saveDocuments,
  types,
} from '@react-native-documents/picker';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {nativeBuildVfsZip} from '../native/vfs-zip-native';

function vfsZipExportFileName(scope: VfsScope): string {
  if (scope.kind === 'global') {
    return 'vfs-global.zip';
  }
  if (scope.kind === 'project') {
    return `vfs-project-${scope.projectId}.zip`;
  }
  return `vfs-session-${scope.sessionId}.zip`;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return globalThis.btoa(binary);
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
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

/** blob-util on Android mishandles `file://` + encoded paths; use absolute fs path. */
function localUriToFsPath(localUri: string): string {
  const withoutScheme = localUri.startsWith('file://')
    ? localUri.slice('file://'.length)
    : localUri;
  return decodeURIComponent(withoutScheme);
}

async function readFileUriAsBytes(localUri: string): Promise<Uint8Array> {
  const fsPath = localUriToFsPath(localUri);
  const exists = await ReactNativeBlobUtil.fs.exists(fsPath);
  if (!exists) {
    throw new VfsZipError('INVALID_ZIP', `ZIP file not found at ${fsPath}`);
  }
  const base64 = await ReactNativeBlobUtil.fs.readFile(fsPath, 'base64');
  return base64ToBytes(base64);
}

async function readPickedZipAsBytes(uri: string): Promise<Uint8Array> {
  const [copyResult] = await keepLocalCopy({
    files: [{uri, fileName: 'import.zip'}],
    destination: 'cachesDirectory',
  });

  if (copyResult.status !== 'success') {
    throw new VfsZipError(
      'INVALID_ZIP',
      copyResult.copyError ?? 'failed to copy picked ZIP into app cache',
    );
  }

  const bytes = await readFileUriAsBytes(copyResult.localUri);
  assertZipArchive(bytes);
  return bytes;
}

export type ExportVfsZipOptions = {
  /** Invoked once when native zip fails and export retries with Core default STORE. */
  onNativeZipFallback?: () => void;
};

/** 检测 gather 结果是否含非 ASCII 条目名（native zip 易乱码 UTF-8 路径）。 */
export function hasNonAsciiZipEntryName(input: {
  files: ReadonlyMap<string, string>;
  directoryEntryNames: readonly string[];
}): boolean {
  const nonAscii = /[^\x00-\x7F]/;
  for (const name of input.files.keys()) {
    if (nonAscii.test(name)) {
      return true;
    }
  }
  for (const name of input.directoryEntryNames) {
    if (nonAscii.test(name)) {
      return true;
    }
  }
  return false;
}

/** Marks failures from the injected buildZip step (native zip), not VFS gather. */
class NativeZipBuildFailedError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error ? cause.message : 'native zip build failed',
    );
    this.name = 'NativeZipBuildFailedError';
  }
}

/** Android-only: wrap native buildZip so fallback catches zip step failures only. */
const androidNativeBuildZip: VfsZipBuildFn = async (input) => {
  if (hasNonAsciiZipEntryName(input)) {
    throw new NativeZipBuildFailedError(
      new Error('non-ASCII entry names require Core ZIP builder'),
    );
  }
  try {
    return await nativeBuildVfsZip(input);
  } catch (cause) {
    throw new NativeZipBuildFailedError(cause);
  }
};

async function exportVfsZipBytes(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options?: ExportVfsZipOptions,
): Promise<Uint8Array> {
  if (Platform.OS !== 'android') {
    // iOS still uses Core default fflate STORE until M3 native zip is validated.
    const zipSvc = createVfsZipIoService(runtime.conn);
    return await zipSvc.export(scope);
  }

  try {
    const zipSvc = createVfsZipIoService(runtime.conn, {
      buildZip: androidNativeBuildZip,
    });
    return await zipSvc.export(scope);
  } catch (error) {
    if (!(error instanceof NativeZipBuildFailedError)) {
      throw error;
    }
    options?.onNativeZipFallback?.();
    const fallbackSvc = createVfsZipIoService(runtime.conn);
    return await fallbackSvc.export(scope);
  }
}

export async function exportVfsZip(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options?: ExportVfsZipOptions,
): Promise<'saved' | 'cancelled'> {
  const bytes = await exportVfsZipBytes(runtime, scope, options);
  assertZipArchive(bytes);

  const fileName = vfsZipExportFileName(scope);
  const tmpPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${fileName}`;

  await ReactNativeBlobUtil.fs.writeFile(tmpPath, bytesToBase64(bytes), 'base64');

  try {
    const [result] = await saveDocuments({
      sourceUris: [toFileUri(tmpPath)],
      mimeType: 'application/zip',
      fileName,
      copy: true,
    });
    if (result?.error) {
      throw new Error(result.error);
    }
    return 'saved';
  } catch (error) {
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
      return 'cancelled';
    }
    throw error;
  } finally {
    await ReactNativeBlobUtil.fs.unlink(tmpPath).catch(() => undefined);
  }
}

export async function importVfsZip(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options: Pick<VfsZipImportOptions, 'confirmed'>,
): Promise<void> {
  const [file] = await pick({
    type: [types.zip],
    allowMultiSelection: false,
  });
  if (file == null) {
    return;
  }

  const zipBytes = await readPickedZipAsBytes(file.uri);
  const zipSvc = createVfsZipIoService(runtime.conn);
  await zipSvc.import(scope, zipBytes, {
    confirmed: options.confirmed,
  });
}

