/**
 * Full SQLite database export/import for mobile (file-level copy).
 *
 * @module services/db-backup.service
 */
import {Platform} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  saveDocuments,
  types,
} from '@react-native-documents/picker';
import {
  checkpointMobileDatabase,
  closeMobileConnection,
} from '../db/connection';
import {resolveMobileDatabaseFilePath} from '../db/db-file-path';
import {isMobileAgentActive} from '../runtime/agent-activity';
import type {MobileNovelMasterRuntime} from '../runtime/types';

const SQLITE_MAGIC = 'SQLite format 3';
const BACKUP_EXT = '.nmbackup';

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function localUriToFsPath(localUri: string): string {
  const withoutScheme = localUri.startsWith('file://')
    ? localUri.slice('file://'.length)
    : localUri;
  return decodeURIComponent(withoutScheme);
}

function backupFileName(): string {
  return `novel-master-backup-${Date.now()}${BACKUP_EXT}`;
}

function assertSqliteFile(bytes: Uint8Array): void {
  if (bytes.length < 16) {
    throw new Error('文件过小，不是有效的数据库备份');
  }
  const header = String.fromCharCode(...bytes.subarray(0, 16));
  if (!header.startsWith(SQLITE_MAGIC)) {
    throw new Error('不是有效的 SQLite 数据库备份');
  }
}

async function readFileAsBytes(fsPath: string): Promise<Uint8Array> {
  const exists = await ReactNativeBlobUtil.fs.exists(fsPath);
  if (!exists) {
    throw new Error(`数据库文件不存在: ${fsPath}`);
  }
  const base64 = await ReactNativeBlobUtil.fs.readFile(fsPath, 'base64');
  const binary = globalThis.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Exports the full app database to a shareable `.nmbackup` file.
 * @returns `'saved'` when shared, `'cancelled'` when user dismisses picker.
 */
export async function exportDatabaseBackup(
  runtime: MobileNovelMasterRuntime,
): Promise<'saved' | 'cancelled'> {
  if (isMobileAgentActive()) {
    throw new Error('Agent 运行中，请稍后再导出数据库');
  }

  await checkpointMobileDatabase(runtime.conn);
  const dbPath = await resolveMobileDatabaseFilePath();
  const fileName = backupFileName();
  const tmpPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${fileName}`;

  await ReactNativeBlobUtil.fs.cp(dbPath, tmpPath);

  try {
    const [result] = await saveDocuments({
      sourceUris: [toFileUri(tmpPath)],
      mimeType: 'application/octet-stream',
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

/**
 * Replaces the app database from a picked backup file.
 * Caller must invoke `onRebootstrap` after success (e.g. NovelMasterProvider.retry).
 */
export async function importDatabaseBackup(
  onRebootstrap: () => void,
): Promise<void> {
  if (isMobileAgentActive()) {
    throw new Error('Agent 运行中，请稍后再导入数据库');
  }

  const [file] = await pick({
    type: [types.allFiles],
    allowMultiSelection: false,
  });
  if (file == null) {
    return;
  }

  const [copyResult] = await keepLocalCopy({
    files: [{uri: file.uri, fileName: 'import.nmbackup'}],
    destination: 'cachesDirectory',
  });

  if (copyResult.status !== 'success') {
    throw new Error(copyResult.copyError ?? '无法读取所选文件');
  }

  const pickedPath = localUriToFsPath(copyResult.localUri);
  const bytes = await readFileAsBytes(pickedPath);
  assertSqliteFile(bytes);

  const dbPath = await resolveMobileDatabaseFilePath();
  const bakPath = `${dbPath}.nmbackup.bak`;

  const dbExists = await ReactNativeBlobUtil.fs.exists(dbPath);
  if (dbExists) {
    await ReactNativeBlobUtil.fs.cp(dbPath, bakPath);
  }

  try {
    await closeMobileConnection();
    await ReactNativeBlobUtil.fs.cp(pickedPath, dbPath);
    onRebootstrap();
  } catch (error) {
    const bakExists = await ReactNativeBlobUtil.fs.exists(bakPath);
    if (bakExists) {
      await ReactNativeBlobUtil.fs.cp(bakPath, dbPath).catch(() => undefined);
    }
    throw error;
  }
}
