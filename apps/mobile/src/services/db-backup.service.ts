/**
 * 全量 SQLite 数据库导出/导入（文件级拷贝 + 服务商表隔离）。
 *
 * 大备份（数十～上百 MB）禁止整包读入 JS / base64 往返，导入统一走路径级 cp。
 *
 * @module services/db-backup.service
 */
import {Platform} from 'react-native';
import {types} from '@react-native-documents/picker';
import {
  dumpProviderTableSnapshot,
  open,
  restoreProviderTableSnapshot,
  scrubProviderTablesInDatabase,
  type TdbcConnection,
} from '@novel-master/core';
import {
  checkpointMobileDatabase,
  closeMobileConnection,
  getMobileConnection,
  registerMobileOpSqliteDriver,
} from '../db/connection';
import {resolveMobileDatabaseFilePath} from '../db/db-file-path';
import {isMobileAgentActive} from '../runtime/agent-activity';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {MOBILE_TDBC_URL} from '../vfs/constants';
import {
  acquireMobileDbMaintenanceBusy,
  releaseMobileDbMaintenanceBusy,
} from './db-maintenance-busy';
import {exportBytesViaDocumentPicker, pickToLocalPath} from './document-io';
import {blobFs, bytesToAsciiString} from './rn-file-io';

const SQLITE_MAGIC = 'SQLite format 3';
const BACKUP_EXT = '.nmbackup';
const EXPORT_ATTACH_ALIAS = 'export_db';
/** 分块落盘，避免 100MB+ Uint8Array → 单次 base64 撑爆 Hermes 堆。 */
const WRITE_CHUNK_BYTES = 256 * 1024;

function backupFileName(): string {
  return 'nmbackup.db';
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
  const fs = blobFs();
  const exists = await fs.exists(srcPath);
  if (!exists) {
    throw new Error(`数据库文件不存在: ${srcPath}`);
  }
  const info = await fs.stat(srcPath);
  if (Number(info.size) < 16) {
    throw new Error('文件过小，不是有效的数据库备份');
  }
}

/** 分块 ascii 写入，避免整包 `String.fromCharCode` / `btoa`。 */
async function writeBytesToFileChunked(
  destPath: string,
  bytes: Uint8Array,
): Promise<void> {
  const stream = await blobFs().writeStream(destPath, 'ascii', false);
  try {
    for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK_BYTES) {
      const end = Math.min(offset + WRITE_CHUNK_BYTES, bytes.length);
      const slice = bytes.subarray(offset, end);
      await stream.write(bytesToAsciiString(slice));
    }
  } finally {
    await stream.close();
  }
}

/**
 * 短连接打开 live DB，仅用于导入后恢复本机服务商三表（不跑 bootstrap）。
 */
async function openDbForProviderRestore(): Promise<TdbcConnection> {
  // 必须走 db/connection 的单点注册：驱动注册表是 last-wins，直接调
  // 无参的 registerOpSqliteDriver() 会把带后台探测的版本覆盖掉。
  registerMobileOpSqliteDriver();
  return open(MOBILE_TDBC_URL, {driver: 'op-sqlite'});
}

/**
 * 将数据库导出到指定路径（checkpoint → 拷贝 → 清除服务商表），无分享对话框。
 * 调用方负责 Agent 守卫与目标路径管理。
 *
 * busy 互斥在此底层置位（计数/令牌配对）：云同步等直调路径不经上层包装
 * 也能被覆盖，期间归一/压缩后台循环让路。
 */
export async function exportDatabaseBackupToPath(
  runtime: MobileNovelMasterRuntime,
  destPath: string,
): Promise<void> {
  acquireMobileDbMaintenanceBusy();
  try {
    await checkpointMobileDatabase(runtime.conn);
    const dbPath = await resolveMobileDatabaseFilePath();
    await blobFs().cp(dbPath, destPath);
    await scrubProviderTablesInDatabase(
      runtime.conn,
      destPath,
      EXPORT_ATTACH_ALIAS,
    );
  } finally {
    releaseMobileDbMaintenanceBusy();
  }
}

/**
 * 从本地快照文件导入数据库（dump → close → cp 替换 → restore），无选择器与 rebootstrap。
 * 调用方须在成功后执行 rebootstrap。
 *
 * busy 互斥在此底层置位（计数/令牌配对）：「关连接 + 覆盖库文件」的
 * 最危险窗口与恢复三表全程覆盖，云同步直调路径同样被保护。
 */
export async function importDatabaseBackupFromPath(
  srcPath: string,
): Promise<void> {
  acquireMobileDbMaintenanceBusy();
  try {
    await assertSqliteBackupAtPath(srcPath);

    const dbPath = await resolveMobileDatabaseFilePath();
    const bakPath = `${dbPath}.nmbackup.bak`;

    const liveConn = await getMobileConnection();
    const providerSnapshot = await dumpProviderTableSnapshot(liveConn);

    const fs = blobFs();
    const dbExists = await fs.exists(dbPath);
    if (dbExists) {
      await fs.cp(dbPath, bakPath);
    }

    try {
      await closeMobileConnection();
      await fs.cp(srcPath, dbPath);

      const restoreConn = await openDbForProviderRestore();
      try {
        await restoreProviderTableSnapshot(restoreConn, providerSnapshot);
      } finally {
        await restoreConn.close();
      }
    } catch (error) {
      const bakExists = await fs.exists(bakPath);
      if (bakExists) {
        await fs.cp(bakPath, dbPath).catch(() => undefined);
      }
      throw error;
    }
  } finally {
    releaseMobileDbMaintenanceBusy();
  }
}

/**
 * 从内存中的备份字节导入：先分块落盘再走路径级 cp（禁止整包 base64 writeFile）。
 * 调用方须在成功后执行 rebootstrap。
 *
 * busy 互斥由内部 `importDatabaseBackupFromPath` 的底层 acquire/release
 * 覆盖（含落盘窗口），本函数无需再叠加。
 */
export async function importDatabaseBackupFromBytes(
  bytes: Uint8Array,
): Promise<void> {
  assertSqliteFile(bytes);

  const fs = blobFs();
  const tmpPath = `${fs.dirs.CacheDir}/import-bytes-${Date.now()}${BACKUP_EXT}`;
  try {
    await writeBytesToFileChunked(tmpPath, bytes);
    await importDatabaseBackupFromPath(tmpPath);
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
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

  // 外层 acquire（计数配对，不是幂等空操作）：把选择器弹出窗口也纳入
  // 互斥——底层 exportDatabaseBackupToPath 内部另有一层自平衡的
  // acquire/release，嵌套计数不会互相提前清位。
  acquireMobileDbMaintenanceBusy();
  try {
    return await exportBytesViaDocumentPicker({
      fileName: backupFileName(),
      mimeType: 'application/octet-stream',
      copy: Platform.OS === 'ios',
      write: destPath => exportDatabaseBackupToPath(runtime, destPath),
    });
  } finally {
    releaseMobileDbMaintenanceBusy();
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

  // 外层 acquire（计数配对）：把选择器窗口到 rebootstrap 完成的完整
  // 链路纳入互斥——底层 importDatabaseBackupFromPath 内部的
  // acquire/release 只覆盖到它自己返回，库文件已替换、连接仍处重建窗口
  // 的尾段由这层兜住。release 放 finally 且 onRebootstrap 在 try 内最后
  // 一步执行，故清位必然发生在 rebootstrap 完成之后。
  acquireMobileDbMaintenanceBusy();
  try {
    const picked = await pickToLocalPath({
      mimeTypes: [types.allFiles],
      localFileName: 'import.nmbackup',
    });
    if (picked == null) {
      return;
    }

    await importDatabaseBackupFromPath(picked.fsPath);
    onRebootstrap();
  } finally {
    releaseMobileDbMaintenanceBusy();
  }
}
