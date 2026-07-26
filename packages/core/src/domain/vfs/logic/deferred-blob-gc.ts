/**
 * 延期 blob GC 唯一入口（collectAllReferencedHashes + ContentStore.gc）。
 *
 * @module domain/vfs/logic/deferred-blob-gc
 */

import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/**
 * 全库 blob 回收（T-GC2 合同：entry ∪ revision 引用集，不得缩成 session 局部）。
 *
 * @returns 删除的无引用 blob 数量
 */
export async function runDeferredBlobGc(conn: TdbcConnection): Promise<number> {
  const contentStore = new SqliteVfsContentStore(conn);
  const referenced = await contentStore.collectAllReferencedHashes();
  return contentStore.gc(referenced);
}
