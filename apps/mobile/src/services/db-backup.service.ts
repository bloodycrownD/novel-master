/**
 * 全量 SQLite 数据库导出/导入（文件级拷贝 + 服务商表隔离）。
 *
 * 大备份（数十～上百 MB）禁止整包读入 JS / base64 往返，导入统一走路径级 cp。
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
  dumpProviderTableSnapshot,
  open,
  restoreProviderTableSnapshot,
  scrubProviderTablesInDatabase,
  type TdbcConnection,
} from '@novel-master/core';
import {registerRnDriver} from '@novel-master/tdbc-driver-rn/native';
import {
  checkpointMobileDatabase,
  closeMobileConnection,
  getMobileConnection,
} from '../db/connection';
import {resolveMobileDatabaseFilePath} from '../db/db-file-path';
import {isMobileAgentActive} from '../runtime/agent-activity';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {MOBILE_TDBC_URL} from '../vfs/constants';

const SQLITE_MAGIC = 'SQLite format 3';
const BACKUP_EXT = '.nmbackup';
const EXPORT_ATTACH_ALIAS = 'export_db';
/** 分块落盘，避免 100MB+ Uint8Array → 单次 base64 撑爆 Hermes 堆。 */
const WRITE_CHUNK_BYTES = 256 * 1024;

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

/**
 * 仅校验路径存在且体积足够；魔数交给替换后 open（失败则 bak 回滚）。
 * 注意：`fs.readFile(path, enc, 16)` 的第三参会被忽略，会整包读入，大备份必 OOM。
 */
async function assertSqliteBackupAtPath(srcPath: string): Promise<void> {
  const exists = await ReactNativeBlobUtil.fs.exists(srcPath);
  if (!exists) {
    throw new Error(`数据库文件不存在: ${srcPath}`);
  }
  const info = await ReactNativeBlobUtil.fs.stat(srcPath);
  if (Number(info.size) < 16) {
    throw new Error('文件过小，不是有效的数据库备份');
  }
}

/** 分块 ascii 写入，避免整包 `String.fromCharCode` / `btoa`。 */
async function writeBytesToFileChunked(
  destPath: string,
  bytes: Uint8Array,
): Promise<void> {
  const stream = await ReactNativeBlobUtil.fs.writeStream(
    destPath,
    'ascii',
    false,
  );
  try {
    for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK_BYTES) {
      const end = Math.min(offset + WRITE_CHUNK_BYTES, bytes.length);
      const slice = bytes.subarray(offset, end);
      await stream.write(Array.from(slice));
    }
  } finally {
    await stream.close();
  }
}

/**
 * 短连接打开 live DB，仅用于导入后恢复本机服务商三表（不跑 bootstrap）。
 */
async function openDbForProviderRestore(): Promise<TdbcConnection> {
  registerRnDriver();
  return open(MOBILE_TDBC_URL, {driver: 'rn'});
}

/**
 * 将数据库导出到指定路径（checkpoint → 拷贝 → 清除服务商表），无分享对话框。
 * 调用方负责 Agent 守卫与目标路径管理。
 */
export async function exportDatabaseBackupToPath(
  runtime: MobileNovelMasterRuntime,
  destPath: string,
): Promise<void> {
  await checkpointMobileDatabase(runtime.conn);
  const dbPath = await resolveMobileDatabaseFilePath();
  await ReactNativeBlobUtil.fs.cp(dbPath, destPath);
  await scrubProviderTablesInDatabase(
    runtime.conn,
    destPath,
    EXPORT_ATTACH_ALIAS,
  );
}

/**
 * 从本地快照文件导入数据库（dump → close → cp 替换 → restore），无选择器与 rebootstrap。
 * 调用方须在成功后执行 rebootstrap。
 */
export async function importDatabaseBackupFromPath(
  srcPath: string,
): Promise<void> {
  await assertSqliteBackupAtPath(srcPath);

  const dbPath = await resolveMobileDatabaseFilePath();
  const bakPath = `${dbPath}.nmbackup.bak`;

  const liveConn = await getMobileConnection();
  const providerSnapshot = await dumpProviderTableSnapshot(liveConn);

  const dbExists = await ReactNativeBlobUtil.fs.exists(dbPath);
  if (dbExists) {
    await ReactNativeBlobUtil.fs.cp(dbPath, bakPath);
  }

  try {
    await closeMobileConnection();
    await ReactNativeBlobUtil.fs.cp(srcPath, dbPath);

    const restoreConn = await openDbForProviderRestore();
    try {
      await restoreProviderTableSnapshot(restoreConn, providerSnapshot);
    } finally {
      await restoreConn.close();
    }
  } catch (error) {
    const bakExists = await ReactNativeBlobUtil.fs.exists(bakPath);
    if (bakExists) {
      await ReactNativeBlobUtil.fs.cp(bakPath, dbPath).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * 从内存中的备份字节导入：先分块落盘再走路径级 cp（禁止整包 base64 writeFile）。
 * 调用方须在成功后执行 rebootstrap。
 */
export async function importDatabaseBackupFromBytes(
  bytes: Uint8Array,
): Promise<void> {
  assertSqliteFile(bytes);

  const tmpPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/import-bytes-${Date.now()}${BACKUP_EXT}`;
  try {
    await writeBytesToFileChunked(tmpPath, bytes);
    await importDatabaseBackupFromPath(tmpPath);
  } finally {
    await ReactNativeBlobUtil.fs.unlink(tmpPath).catch(() => undefined);
  }
}

/**
 * 导出全量应用数据库为可分享的 `.nmbackup` 文件（副本不含服务商表）。
 * @returns `'saved'` 用户完成分享；`'cancelled'` 用户取消选择器。
 */
export async function exportDatabaseBackup(
  runtime: MobileNovelMasterRuntime,
): Promise<'saved' | 'cancelled'> {
  if (isMobileAgentActive()) {
    throw new Error('Agent 运行中，请稍后再导出数据库');
  }

  const fileName = backupFileName();
  const tmpPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${fileName}`;

  await exportDatabaseBackupToPath(runtime, tmpPath);

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
 * 用所选备份文件替换应用数据库；本机服务商三表在替换后写回。
 * 大文件仅 keepLocalCopy + 路径级 cp，不读入 JS 堆。
 * 调用方须在成功后执行 `onRebootstrap`（例如 NovelMasterProvider.retry）。
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
  await importDatabaseBackupFromPath(pickedPath);
  onRebootstrap();
}
