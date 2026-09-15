/**
 * 回滚 restore 前的父目录链重建（幂等 mkdir）。
 *
 * @module domain/message-checkpoint/logic/ensure-directory-chain
 */

import { mkdirIgnoreExistingDirectory } from "@/domain/vfs/logic/vfs-move.js";
import { parentDir } from "@/domain/vfs/logic/parent-dir.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { VfsRestorePort } from "@/domain/vfs/ports/vfs-restore.port.js";

/**
 * Creates parent directories from root down (idempotent mkdir).
 */
export async function ensureDirectoryChain(
  vfs: VfsRestorePort,
  logicalPath: string
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
