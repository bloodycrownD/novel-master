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
 * 仅 revision 行打扫（scope 前缀 ref_count<=0 DELETE + 全局孤儿兜底）。
 *
 * 历史上本函数会依据 `vfs-revision-ref-count-v1` 是否登记而 fallback 到可达集路径；
 * Step 21 后该 migration 退役、Step 22 最低支持 v1.4.08，ref_count 回填路径恒为常态，
 * 本函数仅保留原签名以兼容调用方，`entryRepo` / `checkpoints` / `conn` 参数不再使用。
 *
 * 两步打扫：
 * 1. path-scoped `deleteUnreferencedUnderScope`——靠 JOIN vfs_entry 圈定当前 session
 *    scope 下 ref_count<=0 的 revision；
 * 2. 全局 `deleteGlobalOrphans`——清掉「entry 已删、ref_count<=0」的 JOIN 孤儿
 *    （findings 发现 14：删文件后旧版 active revision 的 entry 已删，path-scoped
 *    扫描 JOIN 不到，靠这步兜底）。两步在同一 connection 上顺序执行。
 *
 * blob GC 须经 {@link runDeferredBlobGc} 另行调度，本函数不再同步 collect/gc
 * （revision DELETE 触发器已能连带回收归零 blob）。
 *
 * @returns Count of deleted revision rows (scoped + global orphans).
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
  const scoped = await deleteUnreferencedUnderScope(
    revisionRepo,
    scopeKeyStr,
    "/",
  );
  // path-scoped 清扫靠 JOIN vfs_entry 圈定范围，扫不到「删文件后 entry 已删」的
  // revision 孤儿；这里追加一次全局清扫兜底（同一 connection 上顺序执行）。
  const globalOrphans = await revisionRepo.deleteGlobalOrphans();
  return scoped + globalOrphans;
}
