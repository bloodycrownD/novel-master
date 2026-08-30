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
import { orphanRevisionGcV1Migration } from "./orphan-revision-gc-v1.js";
import { tableConstraintsV1Migration } from "./table-constraints-v1b.js";
import { usageCacheModelBackfillV1Migration } from "./usage-cache-model-backfill-v1.js";

/**
 * 本版本最低支持 v1.4.27。以下 9 条 migration 的逻辑已并入 canonical DDL、
 * align 或不再需要，源文件已删除，也不再在 runner 阵列里登记：
 * saved-model-identity-v1、provider-identity-v1、drop-chat-session-user-vfs-pending-v1、
 * rename-worktree-tables-to-workplace-v1、vfs-content-blob-zlib-v1、vfs-revision-ref-count-v1、
 * vfs-entry-id-redesign-v1、session-agent-config-v2、project-agent-config-cleanup-v1。
 * 更早版本的库由 {@link assertMinimumBaseline}（novel-master-bootstrap）fail-fast 拦截。
 */

/** 有序 migration 列表。 */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  // orphan-revision-gc-v1 必须排在 table-constraints-v1 之前（SPEC P1-5 顺序约束）。
  orphanRevisionGcV1Migration,
  tableConstraintsV1Migration,
  usageCacheModelBackfillV1Migration,
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
