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

function assertZipArchive(bytes: Uint8Array): void {
  const ok =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
  if (!ok) {
    throw new VfsZipError(
      'INVALID_ZIP',
      `not a ZIP archive (${bytes.length} bytes)`,
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

export async function exportVfsZip(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
): Promise<'saved' | 'cancelled'> {
  const zipSvc = createVfsZipIoService(runtime.conn);
  const bytes = await zipSvc.export(scope);
  assertZipArchive(bytes);

  const fileName = vfsZipExportFileName(scope);
  const tmpPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${fileName}`;

  await ReactNativeBlobUtil.fs.writeFile(tmpPath, bytesToBase64(bytes), 'base64');

  try {
    const [result] = await saveDocuments({
      sourceUris: [toFileUri(tmpPath)],
      mimeType: 'application/zip',
      fileName,
      copy: Platform.OS === 'ios',
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
