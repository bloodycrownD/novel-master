/**
 * 回滚前检测 checkpoint 指向的 revision 是否缺失。
 *
 * entry_id 化后 targetTree 仍是 `Map<logicalPath, version>`（UI 友好），但 revision
 * 探测按 entryId 走，所以先用 entryRepo 把 logicalPath 解析成 entryId 再批量查 meta。
 *
 * @module domain/message-checkpoint/logic/detect-missing-revisions
 */

import {
  scopeKey,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { revisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";

/**
 * 扫描待 reconcile 路径，找出目标树中 revision 行不存在的逻辑路径。
 *
 * @remarks 仅检查 `targetTree` 中有版本指针的路径；待删除路径（不在 targetTree）不参与检测。
 */
export async function findMissingRevisionPointers(
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository,
  scope: VfsScope,
  targetTree: ReadonlyMap<string, number>,
  pathsToReconcile: Iterable<string>,
): Promise<string[]> {
  const scopeKeyStr = scopeKey(scope);
  const pairs: Array<{
    logicalPath: string;
    entryId: number;
    version: number;
  }> = [];

  for (const logicalPath of pathsToReconcile) {
    const targetVersion = targetTree.get(logicalPath);
    if (targetVersion == null) {
      continue;
    }
    const entry = await entryRepo.findByPath(scopeKeyStr, logicalPath);
    if (entry == null) {
      // entry 不在 → revision 必然缺失，直接记为 missing。
      pairs.push({ logicalPath, entryId: -1, version: targetVersion });
      continue;
    }
    pairs.push({ logicalPath, entryId: entry.entryId, version: targetVersion });
  }

  if (pairs.length === 0) {
    return [];
  }

  // entryId=-1 的（entry 缺失）无需查 meta，直接算 missing。
  const missing: string[] = [];
  const queryable = pairs.filter((pair) => pair.entryId >= 0);
  const metas = await revisionRepo.findMetasByEntryVersions(
    queryable.map((pair) => ({ entryId: pair.entryId, version: pair.version })),
  );

  for (const pair of queryable) {
    const key = revisionPairKey(pair.entryId, pair.version);
    if (!metas.has(key)) {
      missing.push(pair.logicalPath);
    }
  }
  for (const pair of pairs) {
    if (pair.entryId < 0) {
      missing.push(pair.logicalPath);
    }
  }

  return missing;
}
