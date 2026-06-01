/**
 * VFS mutations for the file manager (create / delete / rename).
 */
import type {VfsListEntry, VfsService} from '@novel-master/core';
import {VfsError} from '@novel-master/core';

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

/** Rename by read → write → delete (files only). */
export async function renameVfsFile(
  vfs: VfsService,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const existing = await vfs.read(oldPath);
  await vfs.write(newPath, existing.content, {versionCheck: false});
  await vfs.delete(oldPath);
}

function normalizeDirPath(path: string): string {
  if (path.endsWith('/') && path !== '/') {
    return path.slice(0, -1);
  }
  return path;
}

/** Remap a path under oldDir to the same relative location under newDir. */
export function remapPathUnderDir(
  path: string,
  oldDir: string,
  newDir: string,
): string {
  const normalizedOld = normalizeDirPath(oldDir);
  const normalizedNew = normalizeDirPath(newDir);
  if (path === normalizedOld) {
    return normalizedNew;
  }
  const prefix = `${normalizedOld}/`;
  if (!path.startsWith(prefix)) {
    return path;
  }
  return `${normalizedNew}${path.slice(normalizedOld.length)}`;
}

async function mkdirIgnoreExists(vfs: VfsService, path: string): Promise<void> {
  try {
    await vfs.mkdir(path);
  } catch (error) {
    if (error instanceof VfsError && error.code === 'ALREADY_EXISTS') {
      return;
    }
    throw error;
  }
}

/**
 * Rename a directory by moving directory rows and files under its prefix.
 */
export async function renameVfsDirectory(
  vfs: VfsService,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const oldDir = normalizeDirPath(oldPath);
  const newDir = normalizeDirPath(newPath);
  const entries = await vfs.list(oldDir, {recursive: true});
  const dirs = entries
    .filter(e => e.kind === 'directory')
    .sort((a, b) => a.path.length - b.path.length);
  const files = entries.filter(e => e.kind === 'file');

  for (const dir of dirs) {
    await mkdirIgnoreExists(vfs, remapPathUnderDir(dir.path, oldDir, newDir));
  }

  for (const file of files) {
    await renameVfsFile(
      vfs,
      file.path,
      remapPathUnderDir(file.path, oldDir, newDir),
    );
  }

  const hadOldDirRow = dirs.some(d => d.path === oldDir);
  if (hadOldDirRow) {
    await vfs.delete(oldDir, {recursive: false});
  }
}

export type {VfsListEntry};
