/**
 * Revision garbage collection for session-scoped paths.
 *
 * @module domain/message-checkpoint/logic/revision-gc
 */

import {
  scopePhysicalPrefix,
  toPhysicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsContentStore } from "@/domain/vfs/content-store/vfs-content-store.port.js";
import type { MessageCheckpointRepository } from "../repositories/message-checkpoint.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";

/** Builds a stable `path:version` key for revision GC. */
export function revisionReachableKey(path: string, version: number): string {
  return `${path}:${version}`;
}

/**
 * Deletes vfs_revision rows under the session prefix that are not referenced
 * by live file heads or any remaining checkpoint pointer.
 *
 * 删完本 session 不可达 revision 后，末尾经 ContentStore 跑一次**全库** blob gc
 * （blob GC 唯一入口；禁止调用方旁路再手拼 gc）。
 *
 * @returns Count of deleted revision rows.
 */
export async function sweepSessionRevisions(
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository,
  checkpoints: MessageCheckpointRepository,
  projectId: string,
  sessionId: string,
  contentStore: VfsContentStore,
): Promise<number> {
  const scope: VfsScope = {
    kind: "session",
    projectId,
    sessionId,
  };
  const prefix = scopePhysicalPrefix(scope);
  const reachable = new Set<string>();

  const tReach0 = Date.now();
  const liveHeads = await entryRepo.listFileHeadsUnderPrefix(prefix);
  for (const head of liveHeads) {
    reachable.add(revisionReachableKey(head.path, head.headVersion));
  }

  const pointers = await checkpoints.listDistinctCheckpointPointersForSession(sessionId);
  for (const pointer of pointers) {
    const physical = toPhysicalPath(scope, pointer.logicalPath);
    reachable.add(revisionReachableKey(physical, pointer.revisionVersion));
  }
  const reachMs = Date.now() - tReach0;

  const tDel0 = Date.now();
  const deleted = await revisionRepo.deleteExceptReachable(prefix, reachable);
  const deleteMs = Date.now() - tDel0;

  const tCollect0 = Date.now();
  const referenced = await contentStore.collectAllReferencedHashes();
  const collectMs = Date.now() - tCollect0;
  const tGc0 = Date.now();
  await contentStore.gc(referenced);
  const gcMs = Date.now() - tGc0;
  console.log("[nm-rollback] sweepSessionRevisions", {
    sessionId,
    liveHeads: liveHeads.length,
    checkpointPointersDistinct: pointers.length,
    reachable: reachable.size,
    deletedRevisions: deleted,
    referencedHashes: referenced.size,
    reachMs,
    deleteMs,
    collectMs,
    gcMs,
    totalMs: reachMs + deleteMs + collectMs + gcMs,
  });

  return deleted;
}
