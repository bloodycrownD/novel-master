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
import { revisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";

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
  const pairs: Array<{
    logicalPath: string;
    physical: string;
    version: number;
  }> = [];

  for (const logicalPath of pathsToReconcile) {
    const targetVersion = targetTree.get(logicalPath);
    if (targetVersion == null) {
      continue;
    }
    pairs.push({
      logicalPath,
      physical: toPhysicalPath(scope, logicalPath),
      version: targetVersion,
    });
  }

  if (pairs.length === 0) {
    return [];
  }

  const metas = await revisionRepo.findMetasByPathVersions(
    pairs.map((pair) => ({ path: pair.physical, version: pair.version })),
  );

  const missing: string[] = [];
  for (const pair of pairs) {
    const key = revisionPairKey(pair.physical, pair.version);
    if (!metas.has(key)) {
      missing.push(pair.logicalPath);
    }
  }

  return missing;
}
