// legacy-port: VfsService — phase 2 端口实现改抛 AppError 后删除 isVfsError 分支。
/**
 * VFS path copy via {@link VfsService} composition (files and recursive directory trees).
 *
 * @module domain/vfs/logic/vfs-copy
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import type { VfsService } from "../ports/vfs-service.port.js";
import { mkdirIgnoreExists, normalizeDirPath, remapPathUnderDir } from "./vfs-move.js";
import { vfsPortError, type VfsPortError } from "./vfs-port-error.js";

export type CopyVfsPathOptions = {
  readonly recursive?: boolean;
};

/** copyVfsPath 的失败载荷。 */
type VfsCopyError = VfsPortError;

/**
 * Copy a file or directory tree (source is never deleted).
 *
 * @remarks
 * Directory copy requires `options.recursive: true` (default false).
 * File vs directory detection matches {@link moveVfsPath}.
 */
export async function copyVfsPath(vfs: VfsService, from: string, to: string, options?: CopyVfsPathOptions): Promise<Result<void, VfsCopyError>> {
  const recursive = options?.recursive ?? false;

  try {
    const existing = await vfs.read(from);
    await vfs.write(to, existing.content);
    return Result.ok(undefined);
  } catch (error) {
    if (!isVfsError(error)) {
      throw error;
    }
    if (error.code !== "NOT_FOUND" && error.code !== "IS_DIRECTORY") {
      return Result.err(vfsPortError(error));
    }
  }

  const oldDir = normalizeDirPath(from);
  try {
    const entries = await vfs.list(oldDir, { recursive: true });
    const hasDirRow = entries.some((e) => e.kind === "directory" && e.path === oldDir);
    if (entries.length === 0 && !hasDirRow) {
      return Result.err(new AppError("VFS_NOT_FOUND", `Path not found: ${from}`, { path: from }));
    }

    if (!recursive) {
      return Result.err(new AppError("VFS_IS_DIRECTORY", `Directory copy requires recursive: true: ${from}`, { path: from }));
    }

    const newDir = normalizeDirPath(to);
    const dirs = entries.filter((e) => e.kind === "directory").sort((a, b) => a.path.length - b.path.length);
    const files = entries.filter((e) => e.kind === "file");

    await mkdirIgnoreExists(vfs, newDir);
    for (const dir of dirs) {
      await mkdirIgnoreExists(vfs, remapPathUnderDir(dir.path, oldDir, newDir));
    }

    for (const file of files) {
      const content = await vfs.read(file.path);
      await vfs.write(remapPathUnderDir(file.path, oldDir, newDir), content.content);
    }
    return Result.ok(undefined);
  } catch (error) {
    if (isVfsError(error)) {
      return Result.err(vfsPortError(error));
    }
    throw error;
  }
}
