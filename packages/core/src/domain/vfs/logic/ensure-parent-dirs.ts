/**
 * Ensures parent directory rows exist for a file path.
 *
 * @module domain/vfs/logic/ensure-parent-dirs
 */

import { vfsNotADirectory } from "@/errors/vfs-errors.js";
import type { VfsEntryRepository } from "../repositories/vfs-entry.port.js";
import { isStorageRootParent, parentDir } from "./parent-dir.js";

/**
 * Creates missing directory rows from root down to the file's parent.
 *
 * @throws {import("../../errors/vfs-errors.js").VfsError} `NOT_A_DIRECTORY` when a parent is a file row
 */
export async function ensureParentDirectories(
  repo: VfsEntryRepository,
  filePath: string,
): Promise<void> {
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
    const existing = await repo.findByPath(dirPath);
    if (existing != null) {
      if (existing.entryKind === "file") {
        throw vfsNotADirectory(dirPath);
      }
      continue;
    }
    await repo.insertDirectory(dirPath);
  }
}
