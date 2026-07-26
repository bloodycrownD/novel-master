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
import { deleteUnreferencedUnderPrefix } from "@/domain/vfs/logic/revision-ref-count.js";
import {
  isSchemaMigrationApplied,
  VFS_REVISION_REF_COUNT_V1_ID,
} from "@/bootstrap/schema-migrations/index.js";
import type { MessageCheckpointRepository } from "../repositories/message-checkpoint.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { revisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";

/** Builds a stable `path:version` key for revision GC fallback。 */
export function revisionReachableKey(path: string, version: number): string {
  return revisionPairKey(path, version);
}

/**
 * 仅 revision 行打扫（前缀 ref_count<=0 DELETE 或 migration 前 fallback 可达集）。
 *
 * blob GC 须经 {@link runDeferredBlobGc} 另行调度，本函数不再同步 collect/gc。
 *
 * @returns Count of deleted revision rows.
 */
export async function sweepSessionRevisions(
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository,
  checkpoints: MessageCheckpointRepository,
  projectId: string,
  sessionId: string,
  conn: TdbcConnection,
): Promise<number> {
  const scope: VfsScope = {
    kind: "session",
    projectId,
    sessionId,
  };
  const prefix = scopePhysicalPrefix(scope);
  const refCountReady = await isSchemaMigrationApplied(
    conn,
    VFS_REVISION_REF_COUNT_V1_ID,
  );

  const t0 = Date.now();
  let deleted: number;
  let mode: "ref_count" | "reachable_set";

  if (refCountReady) {
    mode = "ref_count";
    deleted = await deleteUnreferencedUnderPrefix(revisionRepo, prefix);
  } else {
    mode = "reachable_set";
    const reachable = new Set<string>();
    const liveHeads = await entryRepo.listFileHeadsUnderPrefix(prefix);
    for (const head of liveHeads) {
      reachable.add(revisionReachableKey(head.path, head.headVersion));
    }
    const pointers =
      await checkpoints.listDistinctCheckpointPointersForSession(sessionId);
    for (const pointer of pointers) {
      const physical = toPhysicalPath(scope, pointer.logicalPath);
      reachable.add(revisionReachableKey(physical, pointer.revisionVersion));
    }
    deleted = await revisionRepo.deleteExceptReachable(prefix, reachable);
  }

  console.log("[nm-rollback] sweepSessionRevisions", {
    sessionId,
    mode,
    deletedRevisions: deleted,
    ms: Date.now() - t0,
  });

  return deleted;
}
