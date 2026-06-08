/**
 * VFS path move/rename via {@link VfsService} composition (files and directory trees).
 *
 * @module domain/vfs/logic/vfs-move
 */

import {
  VfsError,
  isVfsError,
  vfsNotADirectory,
  vfsNotFound,
} from "@/errors/vfs-errors.js";
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
 * mkdir that treats an existing directory as success; fails when path is a file.
 *
 * @remarks
 * On ALREADY_EXISTS, probes with read: file content → NOT_A_DIRECTORY;
 * IS_DIRECTORY → idempotent success.
 */
export async function mkdirIgnoreExistingDirectory(
  vfs: VfsService,
  path: string,
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
  path: string,
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

async function moveVfsFile(
  vfs: VfsService,
  from: string,
  to: string,
): Promise<void> {
  const existing = await vfs.read(from);
  await vfs.write(to, existing.content, { versionCheck: false });
  await vfs.delete(from);
}

async function moveVfsDirectory(
  vfs: VfsService,
  from: string,
  to: string,
): Promise<void> {
  const oldDir = normalizeDirPath(from);
  const newDir = normalizeDirPath(to);
  const entries = await vfs.list(oldDir, { recursive: true });
  const dirs = entries
    .filter((e) => e.kind === "directory")
    .sort((a, b) => a.path.length - b.path.length);
  const files = entries.filter((e) => e.kind === "file");

  // list() omits the source root row; ensure destination root exists first.
  await mkdirIgnoreExists(vfs, newDir);
  for (const dir of dirs) {
    await mkdirIgnoreExists(vfs, remapPathUnderDir(dir.path, oldDir, newDir));
  }

  for (const file of files) {
    await moveVfsFile(
      vfs,
      file.path,
      remapPathUnderDir(file.path, oldDir, newDir),
    );
  }

  const hadOldDirRow = dirs.some((d) => d.path === oldDir);
  if (hadOldDirRow) {
    await vfs.delete(oldDir, { recursive: false });
  }
}

/**
 * Move or rename a file or directory tree.
 *
 * @remarks
 * File vs directory: successful `read(from)` → file move; otherwise recursive
 * `list` with entries or a directory row at `from` → directory move; else NOT_FOUND.
 */
export async function moveVfsPath(
  vfs: VfsService,
  from: string,
  to: string,
): Promise<void> {
  let isFile = false;
  try {
    await vfs.read(from);
    isFile = true;
  } catch (error) {
    if (!(error instanceof VfsError)) {
      throw error;
    }
    // IS_DIRECTORY or NOT_FOUND: fall through to directory detection via list.
    if (error.code !== "NOT_FOUND" && error.code !== "IS_DIRECTORY") {
      throw error;
    }
  }

  if (isFile) {
    await moveVfsFile(vfs, from, to);
    return;
  }

  const oldDir = normalizeDirPath(from);
  const entries = await vfs.list(oldDir, { recursive: true });
  const hasDirRow = entries.some(
    (e) => e.kind === "directory" && e.path === oldDir,
  );
  if (entries.length === 0 && !hasDirRow) {
    throw vfsNotFound(from);
  }

  await moveVfsDirectory(vfs, from, to);
}
