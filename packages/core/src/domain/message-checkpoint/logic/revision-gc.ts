/**
 * Revision garbage collection for session-scoped paths.
 *
 * entry_id 化后可达集按 `(scopeKey, entryId)`；`revisionReachableKey` 改 entryId。
 * 前缀打扫走 `deleteUnreferencedUnderScope`。
 *
 * @module domain/message-checkpoint/logic/revision-gc
 */

import {
  scopeKey,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import { deleteUnreferencedUnderScope } from "@/domain/vfs/logic/revision-ref-count.js";
import {
  isSchemaMigrationApplied,
  VFS_REVISION_REF_COUNT_V1_ID,
} from "@/bootstrap/schema-migrations/index.js";
import type { MessageCheckpointRepository } from "../repositories/message-checkpoint.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { revisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";

/** Builds a stable `entryId:version` key for revision GC fallback。 */
export function revisionReachableKey(entryId: number, version: number): string {
  return revisionPairKey(entryId, version);
}

/**
 * 仅 revision 行打扫（scope 前缀 ref_count<=0 DELETE 或 migration 前 fallback 可达集）。
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
  const scopeKeyStr = scopeKey(scope);
  const refCountReady = await isSchemaMigrationApplied(
    conn,
    VFS_REVISION_REF_COUNT_V1_ID,
  );

  const t0 = Date.now();
  let deleted: number;
  let mode: "ref_count" | "reachable_set";

  if (refCountReady) {
    mode = "ref_count";
    deleted = await deleteUnreferencedUnderScope(revisionRepo, scopeKeyStr, "/");
  } else {
    mode = "reachable_set";
    const reachable = new Set<string>();
    const liveHeads = await entryRepo.listFileHeadsUnderPrefix(scopeKeyStr, "/");
    for (const head of liveHeads) {
      reachable.add(revisionReachableKey(head.entryId, head.headVersion));
    }
    const pointers =
      await checkpoints.listDistinctCheckpointPointersForSession(sessionId);
    for (const pointer of pointers) {
      reachable.add(revisionReachableKey(pointer.entryId, pointer.revisionVersion));
    }
    deleted = await revisionRepo.deleteExceptReachable(scopeKeyStr, "/", reachable);
  }

  console.log("[nm-rollback] sweepSessionRevisions", {
    sessionId,
    mode,
    deletedRevisions: deleted,
    ms: Date.now() - t0,
  });

  return deleted;
}
