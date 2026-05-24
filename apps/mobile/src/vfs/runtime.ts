/**
 * Singleton VFS runtime: RN SQLite driver + core bootstrap on app start.
 */
import {
  bootstrapVfs,
  createVfsService,
  open,
  type TdbcConnection,
  type VfsService,
} from '@novel-master/core';
import {registerRnDriver} from '@novel-master/tdbc-driver-rn';
import {MOBILE_TDBC_URL} from './constants';
import {DeviceSqliteAdapter} from './device-sqlite-adapter';

let conn: TdbcConnection | undefined;
let vfs: VfsService | undefined;
let initPromise: Promise<VfsService> | undefined;

/** Returns the shared {@link VfsService}, initializing once per process. */
export async function getVfs(): Promise<VfsService> {
  if (vfs) {
    return vfs;
  }
  if (!initPromise) {
    initPromise = (async () => {
      registerRnDriver(new DeviceSqliteAdapter());
      const c = await open(MOBILE_TDBC_URL, {driver: 'rn'});
      await bootstrapVfs(c);
      conn = c;
      vfs = createVfsService(c);
      return vfs;
    })();
  }
  return initPromise;
}

/** Closes the connection and clears the singleton (optional on unmount). */
export async function closeVfs(): Promise<void> {
  await conn?.close();
  conn = undefined;
  vfs = undefined;
  initPromise = undefined;
}
