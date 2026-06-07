/**
 * Restores a logical path to a specific revision (forward restore).
 *
 * @module domain/message-checkpoint/logic/restore-path
 */

import { parentDir } from "@/domain/vfs/logic/parent-dir.js";
import {
  toPhysicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";

/**
 * Creates parent directories from root down (idempotent mkdir).
 */
export async function ensureDirectoryChain(
  vfs: VfsService,
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
    await vfs.mkdir(dir);
  }
}

/**
 * Restores one logical path to the content/status of a stored revision.
 */
export async function restorePathToRevision(
  vfs: VfsService,
  revisionRepo: VfsRevisionRepository,
  scope: VfsScope,
  logicalPath: string,
  version: number,
): Promise<void> {
  const physical = toPhysicalPath(scope, logicalPath);
  const rev = await revisionRepo.findByPathAndVersion(physical, version);
  if (rev == null) {
    throw new Error(
      `Missing revision for ${logicalPath} v${version} (physical ${physical})`,
    );
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
