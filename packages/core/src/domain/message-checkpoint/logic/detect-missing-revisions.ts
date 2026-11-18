/**
 * 回滚前检测 checkpoint 指向的 revision 是否缺失。
 *
 * entry_id 化后 targetTree 仍是 `Map<logicalPath, version>`（UI 友好），但 revision
 * 探测按 entryId 走，所以先用 entryRepo 把 logicalPath 解析成 entryId 再批量查 meta。
 *
 * @module domain/message-checkpoint/logic/detect-missing-revisions
 */

import { LogicalPath, type VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { RevisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { CheckpointRepoDeps } from "../model/checkpoint-repo-deps.js";

/** {@link findMissingRevisionPointers} 依赖（共享底座里只取 entry / revision 两项）。 */
export type FindMissingRevisionDeps = Pick<CheckpointRepoDeps, "entryRepo" | "revisionRepo">;

/** {@link findMissingRevisionPointers} 的定位参数。 */
export type FindMissingRevisionParams = {
  readonly scope: VfsScope;
  readonly targetTree: ReadonlyMap<string, number>;
  readonly pathsToReconcile: Iterable<string>;
  readonly checkpointEntryIdByPath?: ReadonlyMap<string, number>;
};

/**
 * 扫描待 reconcile 路径，找出目标树中 revision 行不存在的逻辑路径。
 *
 * @remarks 仅检查 `targetTree` 中有版本指针的路径；待删除路径（不在 targetTree）不参与检测。
 * @param params.checkpointEntryIdByPath checkpoint 记录的旧 entryId（path → entryId）：
 *        entry 行已被物理删除但 checkpoint 有指针的路径按旧 entryId 查 revision，
 *        行在即视为可恢复（复活），不算 missing。
 */
export async function findMissingRevisionPointers(deps: FindMissingRevisionDeps, params: FindMissingRevisionParams): Promise<Result<string[], AppError>> {
  const { revisionRepo, entryRepo } = deps;
  const { scope, targetTree, pathsToReconcile, checkpointEntryIdByPath } = params;
  const scopeKeyStr = LogicalPath.scopeKey(scope);
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
    if (!entry.ok) return Result.err(entry.error);
    const cpEntryId = checkpointEntryIdByPath?.get(logicalPath) ?? null;
    if (entry.value != null && cpEntryId != null && entry.value.entryId !== cpEntryId) {
      // live entry 与 checkpoint 指针不同源（删除后同路径重建）：两边版本
      // 空间各自独立，按 checkpoint 旧 entryId 组对寻址 revision（对齐
      // resolve-reconcile-paths / restore 的 diverged 语义），避免按 live
      // 新 entry 误报 missing 或漏检旧 entry 的真缺失。
      pairs.push({ logicalPath, entryId: cpEntryId, version: targetVersion });
      continue;
    }
    if (entry.value == null) {
      // entry 行已物理删除：有 checkpoint 旧 entryId 时按它寻址 revision
      //（entryId >= 0 进下方 meta 批查，查到即非 missing）；无指针上下文
      // 才维持 entryId=-1 直接算 missing。
      pairs.push({
        logicalPath,
        entryId: cpEntryId ?? -1,
        version: targetVersion,
      });
      continue;
    }
    pairs.push({ logicalPath, entryId: entry.value.entryId, version: targetVersion });
  }

  if (pairs.length === 0) {
    return Result.ok([]);
  }

  // entryId=-1 的（entry 缺失）无需查 meta，直接算 missing。
  const missing: string[] = [];
  const queryable = pairs.filter((pair) => pair.entryId >= 0);
  const metas = await revisionRepo.findMetasByEntryVersions(queryable.map((pair) => ({ entryId: pair.entryId, version: pair.version })));

  for (const pair of queryable) {
    const key = RevisionPairKey.build(pair.entryId, pair.version);
    if (!metas.has(key)) {
      missing.push(pair.logicalPath);
    }
  }
  for (const pair of pairs) {
    if (pair.entryId < 0) {
      missing.push(pair.logicalPath);
    }
  }

  return Result.ok(missing);
}
