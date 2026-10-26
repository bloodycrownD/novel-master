/**
 * 回滚 restore 前的父目录链重建（幂等 mkdir）。
 *
 * @module domain/message-checkpoint/logic/ensure-directory-chain
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { mkdirIgnoreExistingDirectory } from "@/domain/vfs/logic/vfs-move.js";
import { parentDir } from "@/domain/vfs/logic/parent-dir.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { VfsRestorePort } from "@/domain/vfs/ports/vfs-restore.port.js";

/** 父目录链重建失败：路径被同名文件占用。 */
type EnsureDirectoryChainError = AppError<"VFS_NOT_A_DIRECTORY">;

/**
 * Creates parent directories from root down (idempotent mkdir).
 *
 * 从根往下逐级重建 `logicalPath` 的父目录链（幂等 mkdir，已存在的目录静默
 * 跳过），供回滚 restore 写盘前确保父目录在位——被删文件复活时其父目录
 * 可能已被一并删除。
 */
export async function ensureDirectoryChain(vfs: VfsRestorePort, logicalPath: string): Promise<Result<void, EnsureDirectoryChainError>> {
  const normalized = normalizePath(logicalPath);
  const dirs: string[] = [];
  let current = parentDir(normalized);
  while (current !== "/") {
    dirs.unshift(current);
    current = parentDir(current);
  }
  for (const dir of dirs) {
    const mkdir = await mkdirIgnoreExistingDirectory(vfs, dir);
    if (!mkdir.ok) {
      return Result.err(mkdir.error);
    }
  }
  return Result.ok(undefined);
}
