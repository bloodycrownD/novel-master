/**
 * orphan-revision-gc-v1：一次性全局清扫「删文件后遗留的 JOIN 孤儿」revision。
 *
 * 背景（findings 发现 14）：vfs.delete 删文件时 entry 行被删，但旧版 active revision
 * 的行还在（ref_count 被减到 0）。revision GC 的 deleteUnreferencedUnderScope 靠
 * `JOIN vfs_entry` 用 (scope_key, path) 圈定扫描范围——entry 已删的 revision JOIN 不到，
 * 成为扫不到的孤儿，其 blob 也跟着无法回收，数据库只增不减。
 *
 * 修复：一次性 DELETE 掉所有 `ref_count<=0` 且 entry_id 不再存在于 vfs_entry 的
 * revision 行。revision DELETE 触发器会把 blob ref_count 减到 0 时连带删 blob，
 * 所以连 blob 孤儿一起回收。findings 原建议的 LEFT JOIN 方案不可行——path 作用域
 * 扫描依赖 entry 存在，所以改走全局清扫兜底。
 *
 * 幂等：DELETE 本身天然幂等（无孤儿时 changes=0），再加 schema_migrations 表按 id
 * 去重（runner 自带），双重保险。运行期由 sweepSessionRevisions → deleteGlobalOrphans
 * 持续维护，migration 只负责回扫历史存量。
 *
 * 导出说明：`ORPHAN_REVISION_GC_V1_ID` 仅在本文件的 migration 对象里使用，无运行时探测
 * 需求（不像 `VFS_ENTRY_ID_REDESIGN_V1_ID` 要在 runner 里比对），故不从 index.ts re-export；
 * 需要时直接从本文件 import。`up` 只 migration 自己用，不对外暴露命名导出。
 *
 * @module bootstrap/schema-migrations/orphan-revision-gc-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const ORPHAN_REVISION_GC_V1_ID = "orphan-revision-gc-v1";

/**
 * 全局清扫孤儿 revision 的 DELETE SQL（migration up 与运行期 deleteGlobalOrphans 共享）。
 *
 * 语义：删掉 ref_count<=0 且 entry_id 已不在 vfs_entry 的 revision 孤儿。revision DELETE
 * 触发器会连带维护 vfs_content_blob.ref_count，归零的 blob 会被触发器自动删除，所以这一条
 * SQL 同时回收 revision 和 blob 两类孤儿。两条调用路径（migration 回扫存量 + repository
 * 运行期维护）必须逐字一致，否则会出现 migration 清掉、运行期又残留（或反之）的不一致。
 */
export const ORPHAN_REVISION_GC_SQL = `
    DELETE FROM vfs_revision
    WHERE ref_count <= 0
      AND entry_id NOT IN (SELECT entry_id FROM vfs_entry)`.trim();

/**
 * 全局清扫：删掉 ref_count<=0 且 entry_id 已不在 vfs_entry 的 revision 孤儿。
 *
 * revision DELETE 触发器会连带维护 vfs_content_blob.ref_count，归零的 blob 会被
 * 触发器自动删除，所以这一条 SQL 同时回收 revision 和 blob 两类孤儿。
 */
async function up(tx: TdbcConnection): Promise<void> {
  const result = await tx.execute(ORPHAN_REVISION_GC_SQL);
  const deleted = Number(result.changes);
  if (deleted > 0) {
    console.log(
      `[nm-boot] orphan-revision-gc-v1: 清扫 ${deleted} 条 JOIN 孤儿 revision（entry 已删、ref_count<=0）`
    );
  }
}

/** orphan revision GC v1 migration（一次性回扫历史存量）。 */
export const orphanRevisionGcV1Migration: SchemaMigration = {
  id: ORPHAN_REVISION_GC_V1_ID,
  up,
};
