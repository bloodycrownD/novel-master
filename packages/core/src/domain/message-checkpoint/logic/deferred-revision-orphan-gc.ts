/**
 * 全局孤儿 revision 的 deferred 清扫（rollback-large-jank Step 4）。
 *
 * `deleteGlobalOrphans` 是一条与任何会话都无关的全表 DELETE（孤儿 =
 * ref_count<=0 且 entry 已不在 vfs_entry）。此前它内联在回滚事务里
 * （truncate-tail → sweepSessionRevisions 第 2 步），大会话上这条全表
 * 扫描挡在 `rollbackToMessage` resolve 与 UI 链（reloadMessages/toast/
 * 快照）之间——本模块把它移到事务提交后 fire-and-forget 调度。
 *
 * 与 `runDeferredFileCacheGc` 的既有用法（删除事务后内联 await）有意
 * 偏离：删除场景挡住 delete() resolve 无妨，回滚场景照抄会把卡顿从
 * 事务内挪到事务后，回滚交互链照样被挡——所以这里不 await、调度即
 * 返回，清扫与后续操作由驱动层的 AsyncMutex 串行化（op-sqlite 连接
 * 的 execute/query/batch/transaction 全部经 `AsyncMutex.run` 排队，
 * fire-and-forget 的 DELETE 与后续事务不会并发踩踏）。
 *
 * 「守卫」为模块级 in-flight 去重：清扫进行中不重入，后到的调度直接
 * 丢弃——孤儿清扫是收敛式语义（漏一轮下一轮补上即可），孤儿行在
 * 窗口内短暂残留只影响存储、不影响正确性。
 *
 * @module domain/message-checkpoint/logic/deferred-revision-orphan-gc
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";

/** 模块级 in-flight 守卫：清扫进行中不重入。 */
let orphanGcInFlight = false;

/**
 * 执行一次全局孤儿 revision 清扫（仅 {@link scheduleDeferredRevisionOrphanGc}
 * 的清扫体使用）。
 *
 * @returns 删除的孤儿 revision 行数。
 */
async function runDeferredRevisionOrphanGc(
  conn: TdbcConnection
): Promise<number> {
  const revisions = new SqliteVfsRevisionRepository(conn);
  return revisions.deleteGlobalOrphans();
}

/**
 * 事务提交后 fire-and-forget 调度全局孤儿清扫（回滚链挂点）。
 *
 * 不 await、不抛错（失败吞掉并打日志，收敛式语义下一轮回滚会再补）；
 * 清扫进行中重复调度直接丢弃（in-flight 去重）。
 *
 * 清扫体经宏任务（setImmediate）脱离调用方：守卫同步置位，DELETE 在
 * 当前微任务队列（含 `rollbackToMessage` 的 resolve 与调用方 await 的
 * 恢复、以及紧随其后的 UI 链）全部排空后才发出——回滚结果与 reload/
 * toast/快照先行，全表 DELETE 最后；并发安全由驱动层 AsyncMutex 串行
 * 化保证（不会与后续事务并发踩踏）。
 */
export function scheduleDeferredRevisionOrphanGc(conn: TdbcConnection): void {
  if (orphanGcInFlight) {
    return;
  }
  orphanGcInFlight = true;
  setImmediate(() => {
    void runDeferredRevisionOrphanGc(conn)
      .then((deleted) => {
        orphanGcInFlight = false;
        if (deleted > 0) {
          // 收敛式 GC 的轻量痕迹日志：仅在实际清到孤儿时输出。
          console.log(
            `[nm-revision-gc] deferred orphan sweep deleted ${deleted} revision row(s)`
          );
        }
      })
      .catch((error: unknown) => {
        orphanGcInFlight = false;
        console.warn(
          "[nm-revision-gc] deferred orphan sweep failed:",
          error instanceof Error ? error.message : error
        );
      });
  });
}
