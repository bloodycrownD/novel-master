/**
 * Ensures parent directory rows exist for a file path.
 *
 * @module domain/vfs/logic/ensure-parent-dirs
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { VfsEntryRepository } from "../repositories/vfs-entry.port.js";
import { isStorageRootParent, parentDir } from "./parent-dir.js";

/** ensureParentDirectories 的失败载荷。 */
type VfsParentDirectoryError = AppError<"VFS_NOT_A_DIRECTORY">;

/**
 * Creates missing directory rows from root down to the file's parent.
 *
 * @returns Result.err `VFS_NOT_A_DIRECTORY` when a parent is a file row
 */
export async function ensureParentDirectories(repo: VfsEntryRepository, scopeKey: string, filePath: string): Promise<Result<void, VfsParentDirectoryError>> {
  const chain: string[] = [];
  let current = parentDir(filePath);
  while (current !== "/") {
    if (!isStorageRootParent(current)) {
      chain.push(current);
    }
    current = parentDir(current);
  }
  chain.reverse();

  for (const dirPath of chain) {
    const existing = await repo.findByPath(scopeKey, dirPath);
    if (existing != null) {
      if (existing.entryKind === "file") {
        return Result.err(new AppError("VFS_NOT_A_DIRECTORY", `Not a directory: ${dirPath}`, { path: dirPath }));
      }
      continue;
    }
    await repo.insertDirectory(scopeKey, dirPath);
  }
  return Result.ok(undefined);
}
