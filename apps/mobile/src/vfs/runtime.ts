/**
 * Singleton VFS runtime: RN SQLite driver + core bootstrap on app start.
 */
import {createVfsService, type VfsService} from '@novel-master/core';
import {closeMobileConnection, getMobileConnection} from '../db/connection';

let vfs: VfsService | undefined;

/** Returns the shared {@link VfsService}, initializing once per process. */
export async function getVfs(): Promise<VfsService> {
  if (vfs) {
    return vfs;
  }
  const c = await getMobileConnection();
  vfs = createVfsService(c);
  return vfs;
}

/** Closes the connection and clears the singleton (optional on unmount). */
export async function closeVfs(): Promise<void> {
  vfs = undefined;
  await closeMobileConnection();
}
