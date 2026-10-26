// legacy-port: VfsService / VfsRestorePort — phase 2 端口实现改抛 AppError 后删除 isVfsError 分支。
/**
 * VFS path move/rename via {@link VfsService} composition (files and directory trees).
 *
 * @module domain/vfs/logic/vfs-move
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import type { VfsRestorePort } from "../ports/vfs-restore.port.js";
import type { VfsService } from "../ports/vfs-service.port.js";
import { vfsPortError, type VfsPortError } from "./vfs-port-error.js";

/** mkdirIgnoreExistingDirectory 的失败载荷。 */
type VfsNotADirectoryError = AppError<"VFS_NOT_A_DIRECTORY">;

/** assertMoveTargetAvailable 的失败载荷。 */
type VfsAlreadyExistsError = AppError<"VFS_ALREADY_EXISTS">;

/** moveVfsPath 的失败载荷（端口异常统一映射）。 */
type VfsMoveError = VfsPortError;

/** Strip trailing slash except for root `/`. */
export function normalizeDirPath(path: string): string {
  if (path.endsWith("/") && path !== "/") {
    return path.slice(0, -1);
  }
  return path;
}

/** Remap a path under oldDir to the same relative location under newDir. */
export function remapPathUnderDir(path: string, oldDir: string, newDir: string): string {
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
 * mkdir that treats an existing directory as success; fails when path is a file.
 *
 * @remarks
 * On ALREADY_EXISTS, probes with read: file content → NOT_A_DIRECTORY;
 * IS_DIRECTORY → idempotent success.
 */
export async function mkdirIgnoreExistingDirectory(vfs: VfsRestorePort, path: string): Promise<Result<void, VfsNotADirectoryError>> {
  try {
    await vfs.mkdir(path);
    return Result.ok(undefined);
  } catch (error) {
    if (!isVfsError(error, "ALREADY_EXISTS")) {
      throw error;
    }
  }
  try {
    await vfs.read(path);
    return Result.err(new AppError("VFS_NOT_A_DIRECTORY", `Not a directory: ${path}`, { path }));
  } catch (readError) {
    if (isVfsError(readError, "IS_DIRECTORY")) {
      return Result.ok(undefined);
    }
    throw readError;
  }
}

/** mkdir that treats ALREADY_EXISTS as success (idempotent directory chain). */
export async function mkdirIgnoreExists(vfs: VfsService, path: string): Promise<void> {
  try {
    await vfs.mkdir(path);
  } catch (error) {
    if (error instanceof AppError ? error.key === "VFS_ALREADY_EXISTS" : isVfsError(error, "ALREADY_EXISTS")) {
      return;
    }
    throw error;
  }
}

/**
 * Move or rename a file or directory tree.
 *
 * @remarks
 * File vs directory: successful `read(from)` → file move; `read` IS_DIRECTORY →
 * directory move (directory row exists, empty dirs included); `read` NOT_FOUND →
 * recursive `list` with entries (directory row absent but children exist) →
 * directory move; else NOT_FOUND.
 */
export async function moveVfsPath(vfs: VfsService, from: string, to: string): Promise<Result<void, VfsMoveError>> {
  const normalizedFrom = normalizeDirPath(from);
  const normalizedTo = normalizeDirPath(to);
  // WHY: fail before write/delete so a rename conflict cannot overwrite the target.
  if (normalizedFrom !== normalizedTo) {
    const alreadyExists = (): Result<void, VfsAlreadyExistsError> => Result.err(new AppError("VFS_ALREADY_EXISTS", `Path already exists: ${to}`, { path: to }));
    try {
      await vfs.read(to);
      return alreadyExists();
    } catch (error) {
      if (isVfsError(error, "IS_DIRECTORY")) {
        return alreadyExists();
      }
      if (!isVfsError(error, "NOT_FOUND")) {
        throw error;
      }
    }
    try {
      const targetEntries = await vfs.list(normalizedTo, { recursive: false });
      const hasDirRow = targetEntries.some((e) => e.kind === "directory" && normalizeDirPath(e.path) === normalizedTo);
      if (targetEntries.length > 0 || hasDirRow) return alreadyExists();
    } catch (error) {
      if (!isVfsError(error, "NOT_FOUND")) {
        throw error;
      }
    }
  }

  const rename = async (run: () => Promise<void>): Promise<Result<void, VfsMoveError>> => {
    try {
      await run();
      return Result.ok(undefined);
    } catch (error) {
      if (isVfsError(error)) {
        return Result.err(vfsPortError(error));
      }
      throw error;
    }
  };

  let isFile = false;
  let sawDirectoryRow = false;
  try {
    await vfs.read(from);
    isFile = true;
  } catch (error) {
    if (!isVfsError(error)) {
      throw error;
    }
    // IS_DIRECTORY：from 有 directory 行（空目录也是真实目录），直接判为目录移动，
    // 不依赖子项列表——list 只返回子项、不含目录自身行，空目录下列表恒空。
    if (error.code === "IS_DIRECTORY") {
      sawDirectoryRow = true;
    } else if (error.code !== "NOT_FOUND") {
      throw error;
    }
  }

  if (isFile) {
    // entry_id 化后走 rename 原语（单事务 UPDATE entry.path），不写 revision/checkpoint。
    return rename(() => vfs.renamePath(from, to));
  }

  if (sawDirectoryRow) {
    // 空目录（有 directory 行、零子项）同样允许 rename：renamePrefixInScope 的
    // SQL 本就允许「仅前缀根自身存在」（见其「允许空目录」注释）。
    return rename(() => vfs.renamePrefix(from, to));
  }

  // read 报 NOT_FOUND：只剩「无 directory 行但有子项」一种目录形态，靠 list 兜底。
  // 幽灵路径（无行、无子项）时 list 自身抛 NOT_FOUND 或返回空列表，维持 NOT_FOUND。
  let entries: Awaited<ReturnType<VfsService["list"]>>;
  try {
    entries = await vfs.list(normalizeDirPath(from), { recursive: true });
  } catch (error) {
    if (isVfsError(error)) {
      return Result.err(vfsPortError(error));
    }
    throw error;
  }
  if (entries.length === 0) {
    return Result.err(new AppError("VFS_NOT_FOUND", `Path not found: ${from}`, { path: from }));
  }
  return rename(() => vfs.renamePrefix(from, to));
}
