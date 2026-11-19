/**
 * 回滚 restore 前的父目录链重建（幂等 mkdir）。
 *
 * @module domain/message-checkpoint/logic/ensure-directory-chain
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { VfsMove } from "@/domain/vfs/logic/vfs-move.js";
import { ParentDir } from "@/domain/vfs/logic/parent-dir.js";
import { PathNormalizer } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { VfsRestorePort } from "@/domain/vfs/ports/vfs-restore.port.js";

/**
 * 父目录链重建失败载荷：入口路径非法、父目录被同名文件占用，以及上游
 * `ParentDir.resolve` / `mkdirIgnoreExistingDirectory` 透传的其余路径类码。
 *
 * 非法路径原按旧实现在入口抛错；四期改为走返回值通道（错误通道迁移四期门：
 * throw x.error 清零），`RestorePathError` 已同步放宽，消费方经 `Result.err`
 * 透传，错误码数值与文案零变化。
 */
type EnsureDirectoryChainError = AppError;

export const DirectoryChain = {
  /**
   * Creates parent directories from root down (idempotent mkdir).
   *
   * 从根往下逐级重建 `logicalPath` 的父目录链（幂等 mkdir，已存在的目录静默
   * 跳过），供回滚 restore 写盘前确保父目录在位——被删文件复活时其父目录
   * 可能已被一并删除。
   */
  async ensure(vfs: VfsRestorePort, logicalPath: string): Promise<Result<void, EnsureDirectoryChainError>> {
    const normalized = PathNormalizer.normalize(logicalPath);
    if (!normalized.ok) return Result.err(normalized.error);
    const dirs: string[] = [];
    let current = ParentDir.resolve(normalized.value);
    while (current.ok && current.value !== "/") {
      dirs.unshift(current.value);
      current = ParentDir.resolve(current.value);
    }
    if (!current.ok) return Result.err(current.error);
    for (const dir of dirs) {
      const mkdir = await VfsMove.mkdirIgnoreExistingDirectory(vfs, dir);
      if (!mkdir.ok) {
        return Result.err(mkdir.error);
      }
    }
    return Result.ok(undefined);
  },
} as const;
