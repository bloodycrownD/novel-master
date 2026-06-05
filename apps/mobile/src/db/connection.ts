/**
 * Single SQLite connection for mobile (VFS + SKSP share one DB).
 */
import {bootstrapNovelMaster, open, type TdbcConnection} from '@novel-master/core';
import {registerRnDriver} from '@novel-master/tdbc-driver-rn/native';
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
      registerRnDriver();
      registerSkspAndroidDriver();
      registerTokenizerRnDriver();
      const c = await open(MOBILE_TDBC_URL, {driver: 'rn'});
      await bootstrapNovelMaster(c);
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
