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

  const liveHeads = await entryRepo.listFileHeadsUnderPrefix(prefix);
  for (const head of liveHeads) {
    reachable.add(revisionReachableKey(head.path, head.headVersion));
  }

  const pointers = await checkpoints.listFilePointersForSession(sessionId);
  for (const pointer of pointers) {
    const physical = toPhysicalPath(scope, pointer.logicalPath);
    reachable.add(revisionReachableKey(physical, pointer.revisionVersion));
  }

  const deleted = await revisionRepo.deleteExceptReachable(prefix, reachable);

  const referenced = await contentStore.collectAllReferencedHashes();
  await contentStore.gc(referenced);

  return deleted;
}
