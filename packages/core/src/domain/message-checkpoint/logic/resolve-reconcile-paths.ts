/**
 * 回滚 reconcile 前筛选「必须写盘 / 必须删除」路径。
 *
 * entry_id 化后 revision meta 按 entryId 批量查；logicalPath↔entryId 由 live heads
 * 扫描（已带 entryId）解析，缺时退化为 entryRepo.findByPath。targetTree 仍是
 * `Map<logicalPath, version>`，reconcile 输出仍是逻辑路径集（vfs 操作吃逻辑路径）。
 *
 * @module domain/message-checkpoint/logic/resolve-reconcile-paths
 */

import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { revisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";
import {
  scopeKey,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";

/** reconcile 需处理的路径集合。 */
export type ReconcilePathSets = {
  readonly pathsNeedWrite: ReadonlySet<string>;
  readonly pathsNeedDelete: ReadonlySet<string>;
};

/**
 * 从 target 树与 live 状态筛出真正需写盘/删除的逻辑路径。
 *
 * 同 version 或同 content_hash 不进 pathsNeedWrite（对齐 restore 短路语义）。
 */
export async function resolveReconcilePathSets(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scope: Extract<VfsScope, { kind: "session" }>,
  targetTree: ReadonlyMap<string, number>,
  hasDirectTargetTree: boolean,
): Promise<ReconcilePathSets> {
  const { projectId, sessionId } = scope;
  const scopeKeyStr = scopeKey(scope);
  const liveHeads = await listSessionFileHeads(entryRepo, projectId, sessionId);
  const liveHeadByPath = new Map(
    liveHeads.map((head) => [head.logicalPath, head.headVersion]),
  );
  const entryIdByPath = new Map<string, number>();
  for (const head of liveHeads) {
    entryIdByPath.set(head.logicalPath, head.entryId);
  }

  const reconcilePairs: Array<{
    logicalPath: string;
    entryId: number;
    version: number;
  }> = [];
  for (const [logicalPath, version] of targetTree) {
    let entryId = entryIdByPath.get(logicalPath);
    if (entryId == null) {
      // 非-live 路径（可能已删）：退化为 entryRepo 探测拿 entryId。
      const entry = await entryRepo.findByPath(scopeKeyStr, logicalPath);
      entryId = entry?.entryId;
    }
    if (entryId == null) {
      // entry 完全不在：revision 必缺失，标记成 -1 让后续 meta 查询把它判为需写盘。
      entryId = -1;
    }
    reconcilePairs.push({ logicalPath, entryId, version });
  }

  const queryable = reconcilePairs.filter((pair) => pair.entryId >= 0);
  const revisionMetaByKey = await revisionRepo.findMetasByEntryVersions(
    queryable.map((pair) => ({ entryId: pair.entryId, version: pair.version })),
  );
  const liveHashByPath = await entryRepo.findContentHashesByPaths(
    scopeKeyStr,
    [...new Set(reconcilePairs.map((pair) => pair.logicalPath))],
  );

  const pathsNeedWrite = new Set<string>();
  for (const pair of reconcilePairs) {
    const liveHead = liveHeadByPath.get(pair.logicalPath);
    if (liveHead === pair.version) {
      continue;
    }
    if (pair.entryId < 0) {
      pathsNeedWrite.add(pair.logicalPath);
      continue;
    }
    const meta = revisionMetaByKey.get(
      revisionPairKey(pair.entryId, pair.version),
    );
    if (meta == null) {
      pathsNeedWrite.add(pair.logicalPath);
      continue;
    }
    if (meta.status === "deleted") {
      if (liveHead != null) {
        pathsNeedWrite.add(pair.logicalPath);
      }
      continue;
    }
    const liveHash = liveHashByPath.get(pair.logicalPath) ?? null;
    if (
      meta.contentHash != null &&
      meta.contentHash.length > 0 &&
      liveHash != null &&
      liveHash === meta.contentHash
    ) {
      continue;
    }
    pathsNeedWrite.add(pair.logicalPath);
  }

  const pathsNeedDelete = new Set<string>();
  if (hasDirectTargetTree) {
    for (const { logicalPath } of liveHeads) {
      if (!targetTree.has(logicalPath)) {
        pathsNeedDelete.add(logicalPath);
      }
    }
  }

  return { pathsNeedWrite, pathsNeedDelete };
}
