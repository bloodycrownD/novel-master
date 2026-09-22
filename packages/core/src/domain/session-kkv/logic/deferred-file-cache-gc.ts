/**
 * file_cache 缓存 blob 延期 GC（storage-cache-dedup-and-cleanup feature A）。
 *
 * @module domain/session-kkv/logic/deferred-file-cache-gc
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { executeTemplate } from "@/infra/tdbc/logic/template-helper.js";

/**
 * 回收无引用的 `session_file_cache_blob` 行。
 *
 * 引用集 = `session_file_cache_entry` **全表**（所有会话的引用行），
 * 不得缩成单会话——clearDomain/delete 只删本会话引用行，其他会话可能
 * 仍共享同一 blob，按单会话算引用集会误删在用内容。
 *
 * 调度纪律对齐 {@link runDeferredBlobGc}：必须在删除 entry 引用行的
 * 事务**提交后**调度（session/project service 的 delete 链路），事务内
 * 调用会与未提交的引用行删除互相看不见。
 *
 * NOT IN 子查询里显式过滤 NULL content_hash，避免 NOT IN 遇 NULL 的
 * 语义陷阱（NULL 会让整个 NOT IN 结果为空）——防御照
 * SqliteVfsContentStore.gc() 先例（entry.content_hash 本有 NOT NULL
 * 约束，此处防御为风格对齐）。
 *
 * @returns 删除的孤儿 blob 行数
 */
export async function runDeferredFileCacheGc(
  conn: TdbcConnection
): Promise<number> {
  const parser = new SqlTemplateParser();
  const result = await executeTemplate(
    conn,
    parser,
    `DELETE FROM session_file_cache_blob WHERE content_hash NOT IN (
      SELECT content_hash FROM session_file_cache_entry WHERE content_hash IS NOT NULL
    )`,
    {}
  );
  return result.changes;
}
