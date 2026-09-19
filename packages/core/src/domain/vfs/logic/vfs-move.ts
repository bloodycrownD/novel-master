/**
 * VFS path move/rename via {@link VfsService} composition (files and directory trees).
 *
 * @module domain/vfs/logic/vfs-move
 */

import {
  VfsError,
  isVfsError,
  vfsAlreadyExists,
  vfsNotADirectory,
  vfsNotFound,
} from "@/errors/vfs-errors.js";
import type { VfsRestorePort } from "../ports/vfs-restore.port.js";
import type { VfsService } from "../ports/vfs-service.port.js";

/** Strip trailing slash except for root `/`. */
export function normalizeDirPath(path: string): string {
  if (path.endsWith("/") && path !== "/") {
    return path.slice(0, -1);
  }
  return path;
}

/** Remap a path under oldDir to the same relative location under newDir. */
export function remapPathUnderDir(
  path: string,
  oldDir: string,
  newDir: string
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
 * mkdir that treats an existing directory as success; fails when path is a file.
 *
 * @remarks
 * On ALREADY_EXISTS, probes with read: file content → NOT_A_DIRECTORY;
 * IS_DIRECTORY → idempotent success.
 */
export async function mkdirIgnoreExistingDirectory(
  vfs: VfsRestorePort,
  path: string
): Promise<void> {
  try {
    await vfs.mkdir(path);
    return;
  } catch (error) {
    if (!(error instanceof VfsError && error.code === "ALREADY_EXISTS")) {
      throw error;
    }
  }
  try {
    await vfs.read(path);
    throw vfsNotADirectory(path);
  } catch (readError) {
    if (isVfsError(readError, "IS_DIRECTORY")) {
      return;
    }
    if (isVfsError(readError, "NOT_A_DIRECTORY")) {
      throw readError;
    }
    throw readError;
  }
}

/** mkdir that treats ALREADY_EXISTS as success (idempotent directory chain). */
export async function mkdirIgnoreExists(
  vfs: VfsService,
  path: string
): Promise<void> {
  try {
    await vfs.mkdir(path);
  } catch (error) {
    if (error instanceof VfsError && error.code === "ALREADY_EXISTS") {
      return;
    }
    throw error;
  }
}

/**
 * Rejects move/rename when the normalized target path is already occupied.
 *
 * @remarks Self-rename (from === to) is a no-op. Does not mutate VFS on conflict.
 */
export async function assertMoveTargetAvailable(
  vfs: VfsService,
  from: string,
  to: string
): Promise<void> {
  const normalizedFrom = normalizeDirPath(from);
  const normalizedTo = normalizeDirPath(to);
  if (normalizedFrom === normalizedTo) {
    return;
  }

  try {
    await vfs.read(to);
    throw vfsAlreadyExists(to);
  } catch (error) {
    if (isVfsError(error, "ALREADY_EXISTS")) {
      throw error;
    }
    if (isVfsError(error, "IS_DIRECTORY")) {
      throw vfsAlreadyExists(to);
    }
    if (!isVfsError(error, "NOT_FOUND")) {
      throw error;
    }
  }

  try {
    const entries = await vfs.list(normalizedTo, { recursive: false });
    const hasDirRow = entries.some(
      (e) => e.kind === "directory" && normalizeDirPath(e.path) === normalizedTo
    );
    if (entries.length > 0 || hasDirRow) {
      throw vfsAlreadyExists(to);
    }
  } catch (error) {
    if (isVfsError(error, "ALREADY_EXISTS")) {
      throw error;
    }
    if (isVfsError(error, "NOT_FOUND")) {
      return;
    }
    throw error;
  }
}

async function moveVfsFile(
  vfs: VfsService,
  from: string,
  to: string
): Promise<void> {
  // entry_id 化后走 rename 原语（单事务 UPDATE entry.path），不写 revision/checkpoint。
  await vfs.renamePath(from, to);
}

async function moveVfsDirectory(
  vfs: VfsService,
  from: string,
  to: string
): Promise<void> {
  // entry_id 化后走 renamePrefix 原语（单事务 REPLACE path 前缀），revision/checkpoint 零操作。
  await vfs.renamePrefix(from, to);
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
export async function moveVfsPath(
  vfs: VfsService,
  from: string,
  to: string
): Promise<void> {
  // WHY: fail before write/delete so a rename conflict cannot overwrite the target.
  await assertMoveTargetAvailable(vfs, from, to);

  const normalizedFrom = normalizeDirPath(from);
  const normalizedTo = normalizeDirPath(to);
  if (normalizedFrom === normalizedTo) {
    return;
  }

  let isFile = false;
  let sawDirectoryRow = false;
  try {
    await vfs.read(from);
    isFile = true;
  } catch (error) {
    if (!(error instanceof VfsError)) {
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
    await moveVfsFile(vfs, from, to);
    return;
  }

  if (sawDirectoryRow) {
    // 空目录（有 directory 行、零子项）同样允许 rename：renamePrefixInScope 的
    // SQL 本就允许「仅前缀根自身存在」（见其「允许空目录」注释）。
    await moveVfsDirectory(vfs, from, to);
    return;
  }

  // read 报 NOT_FOUND：只剩「无 directory 行但有子项」一种目录形态，靠 list 兜底。
  // 幽灵路径（无行、无子项）时 list 自身抛 NOT_FOUND 或返回空列表，维持 NOT_FOUND。
  const oldDir = normalizeDirPath(from);
  const entries = await vfs.list(oldDir, { recursive: true });
  if (entries.length === 0) {
    throw vfsNotFound(from);
  }

  await moveVfsDirectory(vfs, from, to);
}
