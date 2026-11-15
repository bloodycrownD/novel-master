/**
 * Ensures parent directory rows exist for a file path.
 *
 * @module domain/vfs/logic/ensure-parent-dirs
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { VfsEntryRepository } from "../repositories/vfs-entry.port.js";
import { isStorageRootParent, parentDir } from "./parent-dir.js";

/** ensureParentDirectories 的失败载荷：`VFS_NOT_A_DIRECTORY` + 仓储 / 路径归一化透传。 */
type VfsParentDirectoryError = AppError;

/**
 * Creates missing directory rows from root down to the file's parent.
 *
 * @returns Result.err `VFS_NOT_A_DIRECTORY` when a parent is a file row
 */
export async function ensureParentDirectories(repo: VfsEntryRepository, scopeKey: string, filePath: string): Promise<Result<void, VfsParentDirectoryError>> {
  const chain: string[] = [];
  let current = parentDir(filePath);
  while (current.ok && current.value !== "/") {
    const isRoot = isStorageRootParent(current.value);
    if (!isRoot.ok) return Result.err(isRoot.error);
    if (!isRoot.value) {
      chain.push(current.value);
    }
    current = parentDir(current.value);
  }
  if (!current.ok) return Result.err(current.error);
  chain.reverse();

  for (const dirPath of chain) {
    const existing = await repo.findByPath(scopeKey, dirPath);
    if (!existing.ok) return Result.err(existing.error);
    if (existing.value != null) {
      if (existing.value.entryKind === "file") {
        return Result.err(new AppError("VFS_NOT_A_DIRECTORY", { detail: `Not a directory: ${dirPath}`, path: dirPath }));
      }
      continue;
    }
    const inserted = await repo.insertDirectory(scopeKey, dirPath);
    if (!inserted.ok) return Result.err(inserted.error);
  }
  return Result.ok(undefined);
}
