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
import { savedModelIdentityV1Migration } from "./saved-model-identity-v1.js";
import { providerIdentityV1Migration } from "./provider-identity-v1.js";
import { dropChatSessionUserVfsPendingV1Migration } from "./drop-chat-session-user-vfs-pending-v1.js";
import { renameWorktreeTablesToWorkplaceV1Migration } from "./rename-worktree-tables-to-workplace-v1.js";
import { vfsContentBlobZlibV1Migration } from "./vfs-content-blob-zlib-v1.js";
import { vfsRevisionRefCountV1Migration } from "./vfs-revision-ref-count-v1.js";
import { vfsEntryIdRedesignV1Migration } from "./vfs-entry-id-redesign-v1.js";

/** 有序 migration 列表。 */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  savedModelIdentityV1Migration,
  providerIdentityV1Migration,
  dropChatSessionUserVfsPendingV1Migration,
  renameWorktreeTablesToWorkplaceV1Migration,
  vfsContentBlobZlibV1Migration,
  vfsRevisionRefCountV1Migration,
  vfsEntryIdRedesignV1Migration,
];

/**
 * 按 id 顺序执行尚未 apply 的 migration。
 * 须在 bootstrap 事务内、DDL 之后、alignSchemaColumns 之前调用。
 */
export async function runPendingSchemaMigrations(
  tx: TdbcConnection,
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
export { VFS_CONTENT_BLOB_ZLIB_V1_ID } from "./vfs-content-blob-zlib-v1.js";
export { VFS_REVISION_REF_COUNT_V1_ID } from "./vfs-revision-ref-count-v1.js";
export { VFS_ENTRY_ID_REDESIGN_V1_ID } from "./vfs-entry-id-redesign-v1.js";
export { vfsEntryIdRedesignV1Up } from "./vfs-entry-id-redesign-v1.js";
