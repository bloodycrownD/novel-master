/**
 * VFS mutations for the file manager (create / delete / rename).
 */
import type {VfsService} from '@novel-master/core';

/** Hidden placeholder so empty directories appear in listings. */
const DIR_PLACEHOLDER = '.keep';

/** Create a new file (empty by default). */
export async function createVfsFile(
  vfs: VfsService,
  path: string,
  content = '',
): Promise<void> {
  await vfs.write(path, content, {versionCheck: false});
}

/**
 * Create a directory by writing a placeholder file inside it.
 * VFS stores files only; parent dirs are inferred from paths.
 */
export async function createVfsDirectory(
  vfs: VfsService,
  dirPath: string,
): Promise<void> {
  const normalized = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
  await createVfsFile(vfs, `${normalized}/${DIR_PLACEHOLDER}`, '');
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

/**
 * Rename a directory by moving every file under its prefix (deepest paths first).
 * VFS stores files only; directory nodes are inferred from paths.
 */
export async function renameVfsDirectory(
  vfs: VfsService,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const oldDir = normalizeDirPath(oldPath);
  const newDir = normalizeDirPath(newPath);
  const files = await vfs.list(oldDir, {recursive: true});
  const sorted = [...files].sort(
    (a, b) => b.split('/').length - a.split('/').length,
  );
  for (const filePath of sorted) {
    const target = remapPathUnderDir(filePath, oldDir, newDir);
    await renameVfsFile(vfs, filePath, target);
  }
}
