/**
 * Revision garbage collection for session-scoped paths.
 *
 * entry_id 化后可达集按 `(scopeKey, entryId)`；前缀打扫走 `deleteUnreferencedUnderScope`。
 *
 * 历史背景：曾依据 `isSchemaMigrationApplied(VFS_REVISION_REF_COUNT_V1_ID)` 在
 * 「ref_count 回填完成前」fallback 到 `deleteExceptReachable` 可达集路径。Step 21 后
 * 该 migration 退役（逻辑融入 canonical DDL），Step 22 最低支持 v1.4.08——所有受支持
 * 库均已走完 ref_count 回填，fallback 分支不再需要，直接走 ref_count 路径。
 *
 * @module domain/message-checkpoint/logic/revision-gc
 */

import {
  scopeKey,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import { deleteUnreferencedUnderScope } from "@/domain/vfs/logic/revision-ref-count.js";
import type { MessageCheckpointRepository } from "../repositories/message-checkpoint.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { revisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";

/** Builds a stable `entryId:version` key for revision GC fallback。 */
export function revisionReachableKey(entryId: number, version: number): string {
  // 保留供 seed-fork / 测试代码复用，不再在本模块内部使用。
  return revisionPairKey(entryId, version);
}

/**
 * 仅 revision 行打扫（scope 前缀 ref_count<=0 DELETE）。
 *
 * 历史上本函数会依据 `vfs-revision-ref-count-v1` 是否登记而 fallback 到可达集路径；
 * Step 21 后该 migration 退役、Step 22 最低支持 v1.4.08，ref_count 回填路径恒为常态，
 * 本函数仅保留原签名以兼容调用方，`entryRepo` / `checkpoints` / `conn` 参数不再使用。
 *
 * blob GC 须经 {@link runDeferredBlobGc} 另行调度，本函数不再同步 collect/gc。
 *
 * @returns Count of deleted revision rows.
 */
export async function sweepSessionRevisions(
  revisionRepo: VfsRevisionRepository,
  _entryRepo: VfsEntryRepository,
  _checkpoints: MessageCheckpointRepository,
  projectId: string,
  sessionId: string,
  _conn: TdbcConnection,
): Promise<number> {
  const scope: VfsScope = {
    kind: "session",
    projectId,
    sessionId,
  };
  const scopeKeyStr = scopeKey(scope);
  return deleteUnreferencedUnderScope(revisionRepo, scopeKeyStr, "/");
}
