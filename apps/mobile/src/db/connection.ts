/**
 * Single SQLite connection for mobile (VFS + SKSP share one DB).
 */
import {bootstrapNovelMaster, open, type TdbcConnection} from '@novel-master/core';
import {registerRnDriver} from '@novel-master/tdbc-driver-rn/native';
import {registerSkspAndroidDriver} from '@novel-master/sksp-android';
import {open as openQuickSqlite} from 'react-native-quick-sqlite';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {MOBILE_TDBC_URL, MOBILE_VFS_DB_NAME} from '../vfs/constants';

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
      const c = await open(MOBILE_TDBC_URL, {driver: 'rn'});
      await bootstrapNovelMaster(c);
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
}

/**
 * Resolves the on-disk path for the mobile VFS SQLite file.
 * Prefers quick-sqlite `dbPath` when exposed; otherwise Android DatabasesDir.
 */
export function getMobileDatabaseFilePath(): string {
  const handle = openQuickSqlite({
    name: MOBILE_VFS_DB_NAME,
    location: 'default',
  });
  const maybePath = (handle as {dbPath?: string}).dbPath;
  handle.close();
  if (typeof maybePath === 'string' && maybePath.length > 0) {
    return maybePath;
  }
  return `${ReactNativeBlobUtil.fs.dirs.DatabasesDir}/${MOBILE_VFS_DB_NAME}`;
}

/** WAL checkpoint before file-level copy (export backup). */
export async function checkpointMobileDatabase(
  connection: TdbcConnection,
): Promise<void> {
  await connection.execute('PRAGMA wal_checkpoint(FULL)');
}
