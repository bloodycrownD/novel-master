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
import { usageCacheModelBackfillV1Migration } from "./usage-cache-model-backfill-v1.js";
import { retirePrefSessionFsVersionCheckV1Migration } from "./retire-pref-session-fs-version-check-v1.js";
import { workplaceDirRuleSmartFieldV1Migration } from "./workplace-dir-rule-smart-field-v1.js";

/**
 * 本版本最低支持 v1.4.28。以下 11 条 migration 的逻辑已并入 canonical DDL、
 * align、运行期维护或不再需要，源文件已删除，也不再在 runner 阵列里登记：
 * saved-model-identity-v1、provider-identity-v1、drop-chat-session-user-vfs-pending-v1、
 * rename-worktree-tables-to-workplace-v1、vfs-content-blob-zlib-v1、vfs-revision-ref-count-v1、
 * vfs-entry-id-redesign-v1、session-agent-config-v2、project-agent-config-cleanup-v1、
 * orphan-revision-gc-v1（运行期 deleteGlobalOrphans 持续维护）、table-constraints-v1b
 * （约束形态已是 canonical DDL，legacy 探针见 assertMinimumBaseline）。
 * 更早版本的库由 {@link assertMinimumBaseline}（novel-master-bootstrap）fail-fast 拦截。
 */

/** 有序 migration 列表。 */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  usageCacheModelBackfillV1Migration,
  retirePrefSessionFsVersionCheckV1Migration,
  workplaceDirRuleSmartFieldV1Migration,
];

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

    console.log(`[nm-boot] migration run: ${migration.id}`);
    await migration.up(tx);
    await markSchemaMigrationApplied(tx, migration.id, Date.now());
    applied.add(migration.id);
    console.log(`[nm-boot] migration applied: ${migration.id}`);
  }
}

export type { SchemaMigration } from "./schema-migration.types.js";
export {
  ensureSchemaMigrationsTable,
  isSchemaMigrationApplied,
  listAppliedSchemaMigrationIds,
  markSchemaMigrationApplied,
} from "./schema-migrations-table.js";
