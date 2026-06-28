/**
 * 回滚前检测 checkpoint 指向的 revision 是否缺失。
 *
 * @module domain/message-checkpoint/logic/detect-missing-revisions
 */

import {
  toPhysicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";

/**
 * 扫描待 reconcile 路径，找出目标树中 revision 行不存在的逻辑路径。
 *
 * @remarks 仅检查 `targetTree` 中有版本指针的路径；待删除路径（不在 targetTree）不参与检测。
 */
export async function findMissingRevisionPointers(
  revisionRepo: VfsRevisionRepository,
  scope: VfsScope,
  targetTree: ReadonlyMap<string, number>,
  pathsToReconcile: Iterable<string>,
): Promise<string[]> {
  const missing: string[] = [];

  for (const logicalPath of pathsToReconcile) {
    const targetVersion = targetTree.get(logicalPath);
    if (targetVersion == null) {
      continue;
    }
    const physical = toPhysicalPath(scope, logicalPath);
    const rev = await revisionRepo.findByPathAndVersion(physical, targetVersion);
    if (rev == null) {
      missing.push(logicalPath);
    }
  }

  return missing;
}
