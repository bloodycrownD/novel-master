/**
 * VFS mutations for desktop file manager (ported from mobile).
 */
import { type VfsListEntry, type VfsService } from "@novel-master/core/vfs";
import { type AppError } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import { moveVfsPath, remapPathUnderDir } from "@novel-master/core/vfs";

export async function createVfsFile(vfs: VfsService, path: string, content = ""): Promise<void> {
  await vfs.write(path, content);
}

export async function createVfsDirectory(vfs: VfsService, dirPath: string): Promise<void> {
  const normalized = dirPath.endsWith("/") ? dirPath.slice(0, -1) : dirPath;
  await vfs.mkdir(normalized);
}

export async function deleteVfsEntry(vfs: VfsService, path: string, options?: { recursive?: boolean }): Promise<void> {
  await vfs.delete(path, { recursive: options?.recursive ?? true });
}

export async function renameVfsFile(vfs: VfsService, oldPath: string, newPath: string): Promise<Result<void, AppError>> {
  const moved = await moveVfsPath(vfs, oldPath, newPath);
  // 失败沿 Result 返回，由唯一调用方 handleVfsRename 转码（ipcErr + formatIpcError）。
  if (!moved.ok) return Result.err(moved.error);
  return Result.ok(undefined);
}

export async function renameVfsDirectory(vfs: VfsService, oldPath: string, newPath: string): Promise<Result<void, AppError>> {
  const moved = await moveVfsPath(vfs, oldPath, newPath);
  // 失败沿 Result 返回，由唯一调用方 handleVfsRename 转码（ipcErr + formatIpcError）。
  if (!moved.ok) return Result.err(moved.error);
  return Result.ok(undefined);
}

export { remapPathUnderDir };
export type { VfsListEntry };
