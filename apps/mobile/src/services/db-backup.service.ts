/**
 * 全量 SQLite 数据库导出/导入（文件级拷贝 + 服务商表隔离）。
 *
 * 大备份（数十～上百 MB）禁止整包读入 JS / base64 往返，导入统一走路径级 cp。
 *
 * 调用链契约（两端一致）：**换库 → 重建 runtime → 用新 runtime 记账 → 再放互斥令牌**。
 * 导入函数只负责库面动作，并如实回报「库文件是否已被替换」
 * （{@link DbImportOutcome.databaseReplaced}）；调用方据此决定是否重建 runtime，
 * 记账必须排在重建之后，互斥令牌必须排在记账之后。
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
 * 导入结果：如实回报「活动库文件是否已被替换」与「服务商三表是否已在本机恢复」。
 *
 * 成功路径走返回值；抛错路径（覆盖已成功、收尾失败）走
 * {@link DatabaseReplacedError}——函数抛错时返回值送不到调用方，
 * 「已换代」信号必须由异常类型承载。
 */
export type DbImportOutcome = {
  /** 活动库文件是否已被替换（true ⇒ 调用方持有的 runtime/conn 一律作废，必须先重建再用）。 */
  databaseReplaced: boolean;
  /** 服务商三表是否已在本机恢复成功（false ⇒ 数据库已换但三表丢失，需 UI 提示）。 */
  providerTablesRestored: boolean;
};

/**
 * 库文件已换代、其后收尾步骤失败：信号随异常送达（成功路径走
 * {@link DbImportOutcome} 返回值）。此时**不得回滚**——库已经是新快照，
 * 回滚会把用户拉回来的数据丢掉。
 */
export class DatabaseReplacedError extends Error {
  readonly databaseReplaced = true as const;

  constructor(
    message: string,
    readonly providerTablesRestored: boolean,
  ) {
    super(message);
    this.name = 'DatabaseReplacedError';
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
 * 调用方须在 `databaseReplaced === true` 时先重建 runtime，再记账、最后放互斥令牌。
 *
 * busy 互斥在此底层置位（计数/令牌配对）：「关连接 + 覆盖库文件」的
 * 最危险窗口与恢复三表全程覆盖，云同步直调路径同样被保护。
 *
 * 错误处理口径（与 desktop 同款）：
 * - 备份步裸 await，失败即抛（全新安装 dbPath 不存在时跳过，此时无可回滚）。
 * - 回滚只覆盖「覆盖动作本身失败」这一段；覆盖已成功后抛
 *   {@link DatabaseReplacedError}，**不回滚**。
 * - 回滚失败**不得静默**：与原错误合并成一条可读信息，并保留 bak 副本
 *   （mobile 从不删 bak，用户还能手工救回）。
 */
export async function importDatabaseBackupFromPath(
  srcPath: string,
): Promise<DbImportOutcome> {
  acquireMobileDbMaintenanceBusy();
  try {
    await assertSqliteBackupAtPath(srcPath);

    const dbPath = await resolveMobileDatabaseFilePath();
    const bakPath = `${dbPath}.nmbackup.bak`;

    const liveConn = await getMobileConnection();
    const providerSnapshot = await dumpProviderTableSnapshot(liveConn);

    const fs = blobFs();
    const dbExists = await fs.exists(dbPath);
    let bakCreated = false;
    let databaseReplaced = false;
    if (dbExists) {
      await fs.cp(dbPath, bakPath);
      bakCreated = true;
    }

    try {
      await closeMobileConnection();
      await fs.cp(srcPath, dbPath);
      databaseReplaced = true;

      const restoreConn = await openDbForProviderRestore();
      try {
        await restoreProviderTableSnapshot(restoreConn, providerSnapshot);
      } finally {
        await restoreConn.close();
      }
    } catch (error) {
      if (databaseReplaced) {
        // 库已是新快照：不回滚，只把「已换代 + 三表未恢复」如实报上去。
        throw new DatabaseReplacedError(
          `数据库已导入，但本机服务商配置恢复失败：${errorDetail(error)}`,
          false,
        );
      }

      // 覆盖动作本身失败：库仍是旧库（或根本没换），回滚到备份。
      let rollbackError: unknown;
      if (bakCreated && (await fs.exists(bakPath))) {
        try {
          await fs.cp(bakPath, dbPath);
        } catch (e) {
          rollbackError = e;
        }
      }
      if (rollbackError != null) {
        throw new Error(
          `数据库导入失败且回滚失败，回滚副本保留在 ${bakPath}：${errorDetail(
            rollbackError,
          )}（原始错误：${errorDetail(error)}）`,
          {cause: [error, rollbackError]},
        );
      }
      throw error;
    }
  } finally {
    releaseMobileDbMaintenanceBusy();
  }
  return {databaseReplaced: true, providerTablesRestored: true};
}

/**
 * 从内存中的备份字节导入：先分块落盘再走路径级 cp（禁止整包 base64 writeFile）。
 * 调用方须在 `databaseReplaced === true` 时先重建 runtime，再记账、最后放互斥令牌。
 *
 * busy 互斥由内部 `importDatabaseBackupFromPath` 的底层 acquire/release
 * 覆盖（含落盘窗口），本函数无需再叠加。
 */
export async function importDatabaseBackupFromBytes(
  bytes: Uint8Array,
): Promise<DbImportOutcome> {
  assertSqliteFile(bytes);

  const fs = blobFs();
  const tmpPath = `${fs.dirs.CacheDir}/import-bytes-${Date.now()}${BACKUP_EXT}`;
  try {
    await writeBytesToFileChunked(tmpPath, bytes);
    // 委托 FromPath：DbImportOutcome 必须原样透传（含 DatabaseReplacedError 的
    // 类型），漏了这一层委托就拿不到「已换代」信号。
    return await importDatabaseBackupFromPath(tmpPath);
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
