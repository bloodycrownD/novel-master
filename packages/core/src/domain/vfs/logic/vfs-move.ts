/**
 * VFS path move/rename via {@link VfsService} composition (files and directory trees).
 *
 * @module domain/vfs/logic/vfs-move
 */

import { AppError, AppErrorOps } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { Path } from "@/common/path.js";
import type { VfsRestorePort } from "../ports/vfs-restore.port.js";
import type { VfsService } from "../ports/vfs-service.port.js";

/** mkdirIgnoreExistingDirectory 的失败载荷：`VFS_NOT_A_DIRECTORY` + 端口透传。 */
type VfsNotADirectoryError = AppError;

/** move 目标已存在的统一冲突错误（写前失败，防 rename 冲突覆盖目标）。 */
const alreadyExistsError = (to: string): Result<void, AppError> => Result.err(new AppError("VFS_ALREADY_EXISTS", { detail: `Path already exists: ${to}`, path: to }));

export const VfsMove = {
  /**
   * mkdir that treats an existing directory as success; fails when path is a file.
   *
   * @remarks
   * On ALREADY_EXISTS, probes with read: file content → NOT_A_DIRECTORY;
   * IS_DIRECTORY → idempotent success.
   */
  async mkdirIgnoreExistingDirectory(vfs: VfsRestorePort, path: string): Promise<Result<void, VfsNotADirectoryError>> {
    const made = await vfs.mkdir(path);
    if (made.ok) {
      return Result.ok(undefined);
    }
    if (!AppErrorOps.is(made.error, "VFS_ALREADY_EXISTS")) {
      return Result.err(made.error);
    }
    const read = await vfs.read(path);
    if (read.ok) {
      return Result.err(new AppError("VFS_NOT_A_DIRECTORY", { detail: `Not a directory: ${path}`, path }));
    }
    if (read.error.key === "VFS_IS_DIRECTORY") {
      return Result.ok(undefined);
    }
    return Result.err(read.error);
  },

  /** mkdir that treats ALREADY_EXISTS as success (idempotent directory chain). */
  async mkdirIgnoreExists(vfs: VfsService, path: string): Promise<Result<void, AppError>> {
    const made = await vfs.mkdir(path);
    if (made.ok || AppErrorOps.is(made.error, "VFS_ALREADY_EXISTS")) {
      return Result.ok(undefined);
    }
    return Result.err(made.error);
  },

  /**
   * Move or rename a file or directory tree.
   *
   * @remarks
   * File vs directory: successful `read(from)` → file move; `read` IS_DIRECTORY →
   * directory move (directory row exists, empty dirs included); `read` NOT_FOUND →
   * recursive `list` with entries (directory row absent but children exist) →
   * directory move; else NOT_FOUND.
   */
  async move(vfs: VfsService, from: string, to: string): Promise<Result<void, AppError>> {
    const normalizedFrom = Path.stripTrailingSlash(from);
    const normalizedTo = Path.stripTrailingSlash(to);
    // WHY: fail before write/delete so a rename conflict cannot overwrite the target.
    if (normalizedFrom !== normalizedTo) {
      const targetRead = await vfs.read(to);
      if (targetRead.ok || targetRead.error.key === "VFS_IS_DIRECTORY") {
        return alreadyExistsError(to);
      }
      if (targetRead.error.key !== "VFS_NOT_FOUND") {
        return Result.err(targetRead.error);
      }
      const targetList = await vfs.list(normalizedTo, { recursive: false });
      if (targetList.ok) {
        const hasDirRow = targetList.value.some((e) => e.kind === "directory" && Path.stripTrailingSlash(e.path) === normalizedTo);
        if (targetList.value.length > 0 || hasDirRow) return alreadyExistsError(to);
      } else if (targetList.error.key !== "VFS_NOT_FOUND") {
        return Result.err(targetList.error);
      }
    }

    let isFile = false;
    let sawDirectoryRow = false;
    const fromRead = await vfs.read(from);
    if (fromRead.ok) {
      isFile = true;
    } else {
      // IS_DIRECTORY：from 有 directory 行（空目录也是真实目录），直接判为目录移动，
      // 不依赖子项列表——list 只返回子项、不含目录自身行，空目录下列表恒空。
      if (fromRead.error.key === "VFS_IS_DIRECTORY") {
        sawDirectoryRow = true;
      } else if (fromRead.error.key !== "VFS_NOT_FOUND") {
        return Result.err(fromRead.error);
      }
    }

    if (isFile) {
      // entry_id 化后走 rename 原语（单事务 UPDATE entry.path），不写 revision/checkpoint。
      const renamed = await vfs.renamePath(from, to);
      if (!renamed.ok) return Result.err(renamed.error);
      return Result.ok(undefined);
    }

    if (sawDirectoryRow) {
      // 空目录（有 directory 行、零子项）同样允许 rename：renamePrefixInScope 的
      // SQL 本就允许「仅前缀根自身存在」（见其「允许空目录」注释）。
      const renamed = await vfs.renamePrefix(from, to);
      if (!renamed.ok) return Result.err(renamed.error);
      return Result.ok(undefined);
    }

    // read 报 NOT_FOUND：只剩「无 directory 行但有子项」一种目录形态，靠 list 兜底。
    // 幽灵路径（无行、无子项）时 list 自身报 NOT_FOUND 或返回空列表，维持 NOT_FOUND。
    const entries = await vfs.list(Path.stripTrailingSlash(from), { recursive: true });
    if (!entries.ok) return Result.err(entries.error);
    if (entries.value.length === 0) {
      return Result.err(new AppError("VFS_NOT_FOUND", { detail: `Path not found: ${from}`, path: from }));
    }
    const renamed = await vfs.renamePrefix(from, to);
    if (!renamed.ok) return Result.err(renamed.error);
    return Result.ok(undefined);
  },
} as const;
