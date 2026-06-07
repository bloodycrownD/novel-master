/**
 * VFS mutations for the file manager (create / delete / rename).
 */
import type {VfsListEntry, VfsService} from '@novel-master/core';
import {moveVfsPath, remapPathUnderDir} from '@novel-master/core';

/** Create a new file (empty by default). */
export async function createVfsFile(
  vfs: VfsService,
  path: string,
  content = '',
): Promise<void> {
  await vfs.write(path, content, {versionCheck: false});
}

/** Create an empty directory node. */
export async function createVfsDirectory(
  vfs: VfsService,
  dirPath: string,
): Promise<void> {
  const normalized = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
  await vfs.mkdir(normalized);
}

/** Delete a file or directory tree. */
export async function deleteVfsEntry(
  vfs: VfsService,
  path: string,
  options?: {recursive?: boolean},
): Promise<void> {
  await vfs.delete(path, {recursive: options?.recursive ?? true});
}

/** Rename a file or directory (delegates to Core move logic). */
export async function renameVfsFile(
  vfs: VfsService,
  oldPath: string,
  newPath: string,
): Promise<void> {
  await moveVfsPath(vfs, oldPath, newPath);
}

/** Rename a directory tree (delegates to Core move logic). */
export async function renameVfsDirectory(
  vfs: VfsService,
  oldPath: string,
  newPath: string,
): Promise<void> {
  await moveVfsPath(vfs, oldPath, newPath);
}

export {remapPathUnderDir};
export type {VfsListEntry};
