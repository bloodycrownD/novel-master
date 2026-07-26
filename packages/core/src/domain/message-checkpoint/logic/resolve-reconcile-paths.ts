/**
 * 回滚 reconcile 前筛选「必须写盘 / 必须删除」路径。
 *
 * @module domain/message-checkpoint/logic/resolve-reconcile-paths
 */

import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { revisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";
import {
  toPhysicalPath,
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
  const liveHeads = await listSessionFileHeads(entryRepo, projectId, sessionId);
  const liveHeadByPath = new Map(
    liveHeads.map((head) => [head.logicalPath, head.headVersion]),
  );

  const reconcilePairs: Array<{
    logicalPath: string;
    physical: string;
    version: number;
  }> = [];
  for (const [logicalPath, version] of targetTree) {
    reconcilePairs.push({
      logicalPath,
      physical: toPhysicalPath(scope, logicalPath),
      version,
    });
  }

  const revisionMetaByKey = await revisionRepo.findMetasByPathVersions(
    reconcilePairs.map((pair) => ({
      path: pair.physical,
      version: pair.version,
    })),
  );
  const liveHashByPath = await entryRepo.findContentHashesByPaths([
    ...new Set(reconcilePairs.map((pair) => pair.physical)),
  ]);

  const pathsNeedWrite = new Set<string>();
  for (const pair of reconcilePairs) {
    const liveHead = liveHeadByPath.get(pair.logicalPath);
    if (liveHead === pair.version) {
      continue;
    }
    const meta = revisionMetaByKey.get(
      revisionPairKey(pair.physical, pair.version),
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
    const liveHash = liveHashByPath.get(pair.physical) ?? null;
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
