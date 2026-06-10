/**
 * Restores a logical path to a specific revision (forward restore).
 *
 * @module domain/message-checkpoint/logic/restore-path
 */

import { mkdirIgnoreExistingDirectory } from "@/domain/vfs/logic/vfs-move.js";
import { parentDir } from "@/domain/vfs/logic/parent-dir.js";
import {
  toPhysicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { sessionFsRestoreRevisionMissing } from "@/errors/session-fs-errors.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import type { VfsRestorePort } from "@/domain/vfs/ports/vfs-restore.port.js";

/**
 * Creates parent directories from root down (idempotent mkdir).
 */
export async function ensureDirectoryChain(
  vfs: VfsRestorePort,
  logicalPath: string,
): Promise<void> {
  const normalized = normalizePath(logicalPath);
  const dirs: string[] = [];
  let current = parentDir(normalized);
  while (current !== "/") {
    dirs.unshift(current);
    current = parentDir(current);
  }
  for (const dir of dirs) {
    await mkdirIgnoreExistingDirectory(vfs, dir);
  }
}

/**
 * Restores one logical path to the content/status of a stored revision.
 */
export async function restorePathToRevision(
  vfs: VfsRestorePort,
  revisionRepo: VfsRevisionRepository,
  scope: VfsScope,
  logicalPath: string,
  version: number,
): Promise<void> {
  const physical = toPhysicalPath(scope, logicalPath);
  const rev = await revisionRepo.findByPathAndVersion(physical, version);
  if (rev == null) {
    throw sessionFsRestoreRevisionMissing(logicalPath, version);
  }

  if (rev.status === "deleted") {
    try {
      await vfs.delete(logicalPath);
    } catch (error) {
      if (!isVfsError(error, "NOT_FOUND")) {
        throw error;
      }
    }
    return;
  }

  await ensureDirectoryChain(vfs, logicalPath);
  await vfs.write(logicalPath, rev.content ?? "", { versionCheck: false });
}
