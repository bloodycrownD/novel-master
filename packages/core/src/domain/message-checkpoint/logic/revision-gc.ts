/**
 * Revision garbage collection for session-scoped paths.
 *
 * entry_id 化后可达集按 `(scopeKey, entryId)`；前缀打扫走 `RevisionRefCount.deleteUnreferencedUnderScope`。
 *
 * 历史背景：曾依据 `isSchemaMigrationApplied(VFS_REVISION_REF_COUNT_V1_ID)` 在
 * 「ref_count 回填完成前」fallback 到 `deleteExceptReachable` 可达集路径。Step 21 后
 * 该 migration 退役（逻辑融入 canonical DDL），Step 22 曾最低支持 v1.4.08（现为 v1.4.27）——所有受支持
 * 库均已走完 ref_count 回填，fallback 分支不再需要，直接走 ref_count 路径。
 *
 * @module domain/message-checkpoint/logic/revision-gc
 */

import { LogicalPath, type VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { RevisionRefCount } from "@/domain/vfs/logic/revision-ref-count.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";

export const RevisionGc = {
  /**
   * 仅 revision 行打扫（scope 前缀 ref_count<=0 DELETE + 全局孤儿兜底）。
   *
   * 历史上本函数会依据 `vfs-revision-ref-count-v1` 是否登记而 fallback 到可达集路径；
   * Step 21 后该 migration 退役、Step 22 曾最低支持 v1.4.08（现为 v1.4.27），ref_count 回填路径恒为常态。
   * 同期遗留的三个弃参（entryRepo / checkpoints / conn）已在 tuple 收口时删除——
   * 函数体从未使用它们，调用方也不再为接口让位传真对象。
   *
   * 两步打扫：
   * 1. path-scoped `RevisionRefCount.deleteUnreferencedUnderScope`——靠 JOIN vfs_entry 圈定当前 session
   *    scope 下 ref_count<=0 的 revision；
   * 2. 全局 `deleteGlobalOrphans`——清掉「entry 已删、ref_count<=0」的 JOIN 孤儿
   *    （findings 发现 14：删文件后旧版 active revision 的 entry 已删，path-scoped
   *    扫描 JOIN 不到，靠这步兜底）。两步在同一 connection 上顺序执行。
   *
   * rollback-large-jank Step 4：`options.includeGlobalOrphans = false` 时只做
   * 第 1 步 scoped 打扫（回滚事务内调用——回滚正确性只依赖本会话 scope 的
   * 打扫），全局孤儿兜底改由事务提交后 fire-and-forget 调度
   * （`deferred-revision-orphan-gc.ts` 的 `DeferredRevisionOrphanGc.schedule`）
   * ——全表 DELETE 与本会话无关，不再挡在回滚事务与 UI 链之间。缺省
   * `includeGlobalOrphans: true`，其余调用方（删除链 / user-vfs-turn /
   * 会话删除）行为不变。
   *
   * blob GC 须经 {@link DeferredBlobGc.run} 另行调度，本函数不再同步 collect/gc
   * （revision DELETE 触发器已能连带回收归零 blob）。
   *
   * @returns Count of deleted revision rows (scoped + global orphans).
   */
  async sweepSession(revisionRepo: VfsRevisionRepository, projectId: string, sessionId: string, options?: { includeGlobalOrphans?: boolean }): Promise<number> {
    const scope: VfsScope = {
      kind: "session",
      projectId,
      sessionId,
    };
    const scopeKeyStr = LogicalPath.scopeKey(scope);
    const scoped = await RevisionRefCount.deleteUnreferencedUnderScope(revisionRepo, scopeKeyStr, "/");
    if (options?.includeGlobalOrphans === false) {
      // scoped-only：全局孤儿兜底由调用方在事务提交后 deferred 调度。
      return scoped;
    }
    // path-scoped 清扫靠 JOIN vfs_entry 圈定范围，扫不到「删文件后 entry 已删」的
    // revision 孤儿；这里追加一次全局清扫兜底（同一 connection 上顺序执行）。
    const globalOrphans = await revisionRepo.deleteGlobalOrphans();
    return scoped + globalOrphans;
  },
} as const;
