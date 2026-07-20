/**
 * Schema migration 注册表与 runner。
 *
 * @module bootstrap/schema-migrations
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SchemaMigration } from "./schema-migration.types.js";
import {
  ensureSchemaMigrationsTable,
  isSchemaMigrationApplied,
  markSchemaMigrationApplied,
} from "./schema-migrations-table.js";
import { savedModelIdentityV1Migration } from "./saved-model-identity-v1.js";
import { dropChatSessionUserVfsPendingV1Migration } from "./drop-chat-session-user-vfs-pending-v1.js";
import { renameWorktreeTablesToWorkplaceV1Migration } from "./rename-worktree-tables-to-workplace-v1.js";

/** 有序 migration 列表。 */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  savedModelIdentityV1Migration,
  dropChatSessionUserVfsPendingV1Migration,
  renameWorktreeTablesToWorkplaceV1Migration,
];

/**
 * 按 id 顺序执行尚未 apply 的 migration。
 * 须在 bootstrap 事务内、DDL 之后、alignSchemaColumns 之前调用。
 */
export async function runPendingSchemaMigrations(
  tx: TdbcConnection,
): Promise<void> {
  await ensureSchemaMigrationsTable(tx);

  const seen = new Set<string>();
  for (const migration of SCHEMA_MIGRATIONS) {
    if (seen.has(migration.id)) {
      throw new Error(`重复的 schema migration id: ${migration.id}`);
    }
    seen.add(migration.id);

    if (await isSchemaMigrationApplied(tx, migration.id)) {
      continue;
    }

    await migration.up(tx);
    await markSchemaMigrationApplied(tx, migration.id, Date.now());
  }
}

export type { SchemaMigration } from "./schema-migration.types.js";
export {
  ensureSchemaMigrationsTable,
  isSchemaMigrationApplied,
  markSchemaMigrationApplied,
} from "./schema-migrations-table.js";
