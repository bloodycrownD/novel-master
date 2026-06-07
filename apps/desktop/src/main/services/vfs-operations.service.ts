/**
 * VFS mutations for desktop file manager (ported from mobile).
 */
import type { VfsListEntry, VfsService } from "@novel-master/core";
import { moveVfsPath, remapPathUnderDir } from "@novel-master/core";

export async function createVfsFile(
  vfs: VfsService,
  path: string,
  content = "",
): Promise<void> {
  await vfs.write(path, content, { versionCheck: false });
}

export async function createVfsDirectory(
  vfs: VfsService,
  dirPath: string,
): Promise<void> {
  const normalized = dirPath.endsWith("/") ? dirPath.slice(0, -1) : dirPath;
  await vfs.mkdir(normalized);
}

export async function deleteVfsEntry(
  vfs: VfsService,
  path: string,
  options?: { recursive?: boolean },
): Promise<void> {
  await vfs.delete(path, { recursive: options?.recursive ?? true });
}

export async function renameVfsFile(
  vfs: VfsService,
  oldPath: string,
  newPath: string,
): Promise<void> {
  await moveVfsPath(vfs, oldPath, newPath);
}

export async function renameVfsDirectory(
  vfs: VfsService,
  oldPath: string,
  newPath: string,
): Promise<void> {
  await moveVfsPath(vfs, oldPath, newPath);
}

export { remapPathUnderDir };
export type { VfsListEntry };
