/**
 * Schema migration 注册表与 runner。
 *
 * @module bootstrap/schema-migrations
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SchemaMigration } from "./schema-migration.types.js";
import {
  ensureSchemaMigrationsTable,
  listAppliedSchemaMigrationIds,
  markSchemaMigrationApplied,
} from "./schema-migrations-table.js";

/**
 * 本版本最低支持 v1.5.23。以下 18 条 migration 的逻辑已并入 canonical DDL、
 * align、运行期维护或不再需要，源文件已删除，也不再在 runner 阵列里登记：
 * saved-model-identity-v1、provider-identity-v1、drop-chat-session-user-vfs-pending-v1、
 * rename-worktree-tables-to-workplace-v1、vfs-content-blob-zlib-v1、vfs-revision-ref-count-v1、
 * vfs-entry-id-redesign-v1、session-agent-config-v2、project-agent-config-cleanup-v1、
 * orphan-revision-gc-v1（运行期 deleteGlobalOrphans 持续维护）、table-constraints-v1b
 * （约束形态已是 canonical DDL，legacy 探针见 assertMinimumBaseline）、
 * usage-cache-model-backfill-v1（第四轮退役：数据回填迁移，v1.5.4 首发引入，
 * 所有 ≥v1.5.5 的库均已登记应用记录，进入 BASELINE_MIGRATION_IDS 判据；
 * 数据迁移无 schema 形态可探，老库识别依赖既有 legacy 探针）。
 *
 * 第五轮退役（2026-10-05，最低支持随之升至 v1.5.23）：以下 6 条引入 tag 全部
 * ≤ v1.5.22，所有 ≥v1.5.23 的库都已登记应用记录，退役零损失——
 * retire-pref-session-fs-version-check-v1（v1.5.12 首发，一次性清理存量偏好死键）、
 * workplace-dir-rule-smart-field-v1（v1.5.17 首发，sort_field CHECK 扩 'smart'，
 * 约束形态已逐字固化在 canonical DDL）、
 * rename-smart-sort-rule-example-v1（v1.5.17 首发，smart_sort_rule 的 example 列改名）、
 * add-smart-sort-capture-kind-v1（v1.5.17 首发，smart_sort_rule 加 capture_kind 列，
 * 列形态已在 canonical DDL）、add-mcp-file-path-snapshot-v1（v1.5.20 首发，
 * message_checkpoint_file 加 path 快照列，已在 canonical DDL）、
 * dedup-file-cache-storage-v1（v1.5.22 首发，清空 file_cache 存量行的数据迁移，
 * 按惯例只进基线清单、无 schema 形态可探）。
 *
 * 更早版本的库由 {@link assertMinimumBaseline}（novel-master-bootstrap）fail-fast 拦截。
 */

/**
 * 有序 migration 列表。第五轮清空后暂为空——新 migration 重新入列即可。
 *
 * 注：退役只针对本目录的 schema migration 注册表；
 * `infra/db-maintenance/` 下的后台维护任务各有独立生命周期条款，不随本轮变动。
 */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [];

/**
 * 执行 pending schema migration。
 *
 * 须在 bootstrap 事务内、DDL 之后、alignSchemaColumns 之前调用。
 */
export async function runPendingSchemaMigrations(
  tx: TdbcConnection
): Promise<void> {
  await ensureSchemaMigrationsTable(tx);
  const applied = await listAppliedSchemaMigrationIds(tx);

  const seen = new Set<string>();
  for (const migration of SCHEMA_MIGRATIONS) {
    if (seen.has(migration.id)) {
      throw new Error(`重复的 schema migration id: ${migration.id}`);
    }
    seen.add(migration.id);

    if (applied.has(migration.id)) {
      continue;
    }

    console.error(`[nm-boot] migration run: ${migration.id}`);
    await migration.up(tx);
    await markSchemaMigrationApplied(tx, migration.id, Date.now());
    applied.add(migration.id);
    console.error(`[nm-boot] migration applied: ${migration.id}`);
  }
}

export type { SchemaMigration } from "./schema-migration.types.js";
export {
  ensureSchemaMigrationsTable,
  isSchemaMigrationApplied,
  listAppliedSchemaMigrationIds,
  markSchemaMigrationApplied,
} from "./schema-migrations-table.js";
