/**
 * Single SQLite connection for mobile (VFS + SKSP share one DB).
 */
import {bootstrapNovelMaster, open, type TdbcConnection} from '@novel-master/core';
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
      const c = await open(MOBILE_TDBC_URL, {driver: 'op-sqlite'});
      try {
        await bootstrapNovelMaster(c);
      } catch (bootErr) {
        // 打出 cause 链：migration 失败时原始错误可能被驱动层的包装错误盖住
        // （真机事故教训：ROLLBACK 失败曾掩盖 disk I/O error）。
        console.error('[nm-boot] bootstrap 失败:', bootErr);
        let cause = bootErr?.cause;
        let depth = 0;
        while (cause && depth < 5) {
          console.error(`[nm-boot] cause[${depth}]:`, cause);
          cause = cause?.cause;
          depth++;
        }
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
