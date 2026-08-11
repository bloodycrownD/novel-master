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
import {
  VFS_ENTRY_ID_REDESIGN_V1_ID,
  vfsEntryIdRedesignV1Migration,
} from "./vfs-entry-id-redesign-v1.js";
import { sessionAgentConfigV2Migration } from "./session-agent-config-v2.js";

/**
 * 本版本最低支持 v1.4.08：下面 6 条 migration 的逻辑已并入 canonical DDL，
 * 不再在 runner 阵列里登记，但源文件保留以备冷回放排查：
 * saved-model-identity-v1、provider-identity-v1、drop-chat-session-user-vfs-pending-v1、
 * rename-worktree-tables-to-workplace-v1、vfs-content-blob-zlib-v1、vfs-revision-ref-count-v1。
 */

/** 有序 migration 列表。 */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  vfsEntryIdRedesignV1Migration,
  sessionAgentConfigV2Migration,
];

/**
 * 按 id 顺序执行尚未 apply 的 migration。
 * 须在 bootstrap 事务内、DDL 之后、alignSchemaColumns 之前调用。
 */
/**
 * 执行 pending schema migration。
 *
 * @returns 若 `vfs-entry-id-redesign-v1` 本次刚被 applied 则为 true
 */
export async function runPendingSchemaMigrations(
  tx: TdbcConnection,
): Promise<boolean> {
  await ensureSchemaMigrationsTable(tx);
  const applied = await listAppliedSchemaMigrationIds(tx);

  let entryIdMigrationApplied = false;
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
    if (migration.id === VFS_ENTRY_ID_REDESIGN_V1_ID) {
      entryIdMigrationApplied = true;
    }
  }

  return entryIdMigrationApplied;
}

export type { SchemaMigration } from "./schema-migration.types.js";
export {
  ensureSchemaMigrationsTable,
  isSchemaMigrationApplied,
  listAppliedSchemaMigrationIds,
  markSchemaMigrationApplied,
} from "./schema-migrations-table.js";
export {
  VFS_ENTRY_ID_REDESIGN_V1_ID,
  vfsEntryIdRedesignV1Up,
} from "./vfs-entry-id-redesign-v1.js";

// 以下两条 migration id 常量仅作运行时探测用（如 revision-gc.ts 判断 ref_count 是否就绪），
// 不再出现在 SCHEMA_MIGRATIONS 数组里，但常量 re-export 保留。
export { VFS_CONTENT_BLOB_ZLIB_V1_ID } from "./vfs-content-blob-zlib-v1.js";
export { VFS_REVISION_REF_COUNT_V1_ID } from "./vfs-revision-ref-count-v1.js";
export {
  SESSION_AGENT_CONFIG_V2_ID,
  sessionAgentConfigV2Up,
} from "./session-agent-config-v2.js";
