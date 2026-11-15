/**
 * VFS path copy via {@link VfsService} composition (files and recursive directory trees).
 *
 * @module domain/vfs/logic/vfs-copy
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { VfsService } from "../ports/vfs-service.port.js";
import { mkdirIgnoreExists, normalizeDirPath, remapPathUnderDir } from "./vfs-move.js";

export type CopyVfsPathOptions = {
  readonly recursive?: boolean;
};

/**
 * Copy a file or directory tree (source is never deleted).
 *
 * @remarks
 * Directory copy requires `options.recursive: true` (default false).
 * File vs directory detection matches {@link moveVfsPath}.
 */
export async function copyVfsPath(vfs: VfsService, from: string, to: string, options?: CopyVfsPathOptions): Promise<Result<void, AppError>> {
  const recursive = options?.recursive ?? false;

  const existing = await vfs.read(from);
  if (existing.ok) {
    const written = await vfs.write(to, existing.value.content);
    return written.map(() => undefined);
  }
  if (existing.error.key !== "VFS_NOT_FOUND" && existing.error.key !== "VFS_IS_DIRECTORY") {
    return Result.err(existing.error);
  }

  const oldDir = normalizeDirPath(from);
  const listed = await vfs.list(oldDir, { recursive: true });
  if (!listed.ok) return Result.err(listed.error);
  const entries = listed.value;
  const hasDirRow = entries.some((e) => e.kind === "directory" && e.path === oldDir);
  if (entries.length === 0 && !hasDirRow) {
    return Result.err(new AppError("VFS_NOT_FOUND", { detail: `Path not found: ${from}`, path: from }));
  }

  if (!recursive) {
    return Result.err(new AppError("VFS_IS_DIRECTORY", { detail: `Directory copy requires recursive: true: ${from}`, path: from }));
  }

  const newDir = normalizeDirPath(to);
  const dirs = entries.filter((e) => e.kind === "directory").sort((a, b) => a.path.length - b.path.length);
  const files = entries.filter((e) => e.kind === "file");

  const madeRoot = await mkdirIgnoreExists(vfs, newDir);
  if (!madeRoot.ok) return Result.err(madeRoot.error);
  for (const dir of dirs) {
    const made = await mkdirIgnoreExists(vfs, remapPathUnderDir(dir.path, oldDir, newDir));
    if (!made.ok) return Result.err(made.error);
  }

  for (const file of files) {
    const content = await vfs.read(file.path);
    if (!content.ok) return Result.err(content.error);
    const written = await vfs.write(remapPathUnderDir(file.path, oldDir, newDir), content.value.content);
    if (!written.ok) return Result.err(written.error);
  }
  return Result.ok(undefined);
}
