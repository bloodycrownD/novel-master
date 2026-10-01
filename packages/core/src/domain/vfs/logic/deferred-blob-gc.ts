/**
 * 延期 blob GC 唯一入口（ContentStore.gc 内部用 NOT IN 子查询算全库引用集）。
 *
 * @module domain/vfs/logic/deferred-blob-gc
 */

import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/**
 * 全库 blob 回收（T-GC2 合同：entry ∪ revision 引用集，不得缩成 session 局部）。
 *
 * @returns 回收的无引用 blob / pack member / 空 pack 行数合计（三张表删除行数之
 *   和——pack 形态落地后 blob 回收不再只删 `vfs_content_blob` 一张表，故口径与
 *   {@link SqliteVfsContentStore.gc} 对齐；不是字节数）
 */
export async function runDeferredBlobGc(conn: TdbcConnection): Promise<number> {
  const contentStore = new SqliteVfsContentStore(conn);
  return contentStore.gc();
}
