/**
 * Single SQLite connection for mobile (VFS + SKSP share one DB).
 */
import {
  bootstrapNovelMaster,
  open,
  type TdbcConnection,
} from '@novel-master/core';
import {registerOpSqliteDriver} from '@novel-master/tdbc-driver-op-sqlite/native';
import {registerSkspAndroidDriver} from '@novel-master/sksp-android';
import {registerTokenizerRnDriver} from '@novel-master/tokenizer-driver-rn/native';
import {MOBILE_TDBC_URL} from '../vfs/constants';
import {
  clearMobileDatabaseFilePathCache,
  probeAndCacheMobileDatabaseFilePath,
} from './db-file-path';

export {
  getMobileDatabaseFilePath,
  probeAndCacheMobileDatabaseFilePath,
} from './db-file-path';

let conn: TdbcConnection | undefined;
let initPromise: Promise<TdbcConnection> | undefined;

/**
 * 打印错误及其 cause 链（最多 5 层）：驱动层的 TdbcError 会把原始错误
 * （JSI 异常、路径不可写、disk I/O error 等）包在 cause 里，UI 只显示主文案。
 */
function logCauseChain(label: string, err: unknown): void {
  console.error(`[nm-boot] ${label} 失败:`, err);
  let cause: unknown = err instanceof Error ? err.cause : undefined;
  let depth = 0;
  while (cause && depth < 5) {
    console.error(`[nm-boot] ${label} cause[${depth}]:`, cause);
    cause = cause instanceof Error ? cause.cause : undefined;
    depth++;
  }
}

/** Opens (once) the app DB with core bootstrap and SKSP Android driver. */
export async function getMobileConnection(): Promise<TdbcConnection> {
  if (conn) {
    return conn;
  }
  if (!initPromise) {
    initPromise = (async () => {
      registerOpSqliteDriver();
      registerSkspAndroidDriver();
      registerTokenizerRnDriver();
      let c: TdbcConnection;
      try {
        c = await open(MOBILE_TDBC_URL, {driver: 'op-sqlite'});
      } catch (openErr: unknown) {
        logCauseChain('open', openErr);
        throw openErr;
      }
      try {
        await bootstrapNovelMaster(c);
      } catch (bootErr: unknown) {
        logCauseChain('bootstrap', bootErr);
        // 此时 conn 还没赋值，closeMobileConnection() 里的 conn?.close()
        // 关不到这条连接；不在这里手动 close，局部变量 c 持有的已打开连接
        // 会随 throw 一起丢弃，文件句柄和 WAL 锁随之泄漏——Android 上重试
        // 重新 open 同一个库时，新旧连接可能互相锁死。close 本身失败不掩盖
        // 原始的 bootstrap 错误，所以吞掉它的异常。
        await c.close().catch(() => {});
        throw bootErr;
      }
      await probeAndCacheMobileDatabaseFilePath();
      conn = c;
      return c;
    })();
  }
  return initPromise;
}

/** Closes the shared connection and clears init state. */
export async function closeMobileConnection(): Promise<void> {
  await conn?.close();
  conn = undefined;
  initPromise = undefined;
  clearMobileDatabaseFilePathCache();
}

/** WAL checkpoint before file-level copy (export backup). */
export async function checkpointMobileDatabase(
  connection: TdbcConnection,
): Promise<void> {
  await connection.execute('PRAGMA wal_checkpoint(FULL)');
}
