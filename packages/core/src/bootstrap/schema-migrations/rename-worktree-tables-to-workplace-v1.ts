/**
 * rename-worktree-tables-to-workplace-v1：`worktree_*` → `workplace_*`。
 *
 * bootstrap 顺序为先 DDL（CREATE IF NOT EXISTS workplace_*）再 migration，
 * 故 legacy 库常见「空新表 + 旧表有数据」撞车，须 DROP 空新表后再 RENAME。
 *
 * @module bootstrap/schema-migrations/rename-worktree-tables-to-workplace-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import {
  WORKPLACE_DIR_RULE_TABLE,
  WORKPLACE_DIR_SCOPE_INDEX,
  WORKPLACE_FILE_RULE_TABLE,
  WORKPLACE_FILE_SCOPE_INDEX,
} from "../workplace/workplace-schema.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const RENAME_WORKTREE_TABLES_TO_WORKPLACE_V1_ID =
  "rename-worktree-tables-to-workplace-v1";

const LEGACY_DIR_RULE_TABLE = "worktree_dir_rule";
const LEGACY_FILE_RULE_TABLE = "worktree_file_rule";
const LEGACY_DIR_SCOPE_INDEX = "idx_worktree_dir_scope";
const LEGACY_FILE_SCOPE_INDEX = "idx_worktree_file_scope";

async function tableExists(
  tx: TdbcConnection,
  table: string,
): Promise<boolean> {
  const rows = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`,
  );
  return rows.length > 0;
}

async function tableRowCount(
  tx: TdbcConnection,
  table: string,
): Promise<number> {
  const rows = await tx.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${table}`,
  );
  return Number(rows[0]!.count);
}

/**
 * RENAME 后 SQLite 保留旧索引名；统一为 canonical 索引名。
 */
async function ensureCanonicalIndexes(tx: TdbcConnection): Promise<void> {
  await tx.execute(`DROP INDEX IF EXISTS ${LEGACY_DIR_SCOPE_INDEX}`);
  await tx.execute(`DROP INDEX IF EXISTS ${LEGACY_FILE_SCOPE_INDEX}`);
  await tx.execute(
    `CREATE INDEX IF NOT EXISTS ${WORKPLACE_DIR_SCOPE_INDEX} ON ${WORKPLACE_DIR_RULE_TABLE}(scope_key)`,
  );
  await tx.execute(
    `CREATE INDEX IF NOT EXISTS ${WORKPLACE_FILE_SCOPE_INDEX} ON ${WORKPLACE_FILE_RULE_TABLE}(scope_key)`,
  );
}

async function renameLegacyPair(
  tx: TdbcConnection,
  legacyTable: string,
  canonicalTable: string,
): Promise<void> {
  await tx.execute(
    `ALTER TABLE ${legacyTable} RENAME TO ${canonicalTable}`,
  );
}

async function dropEmptyCanonicalThenRename(
  tx: TdbcConnection,
  legacyTable: string,
  canonicalTable: string,
): Promise<void> {
  await tx.execute(`DROP TABLE ${canonicalTable}`);
  await renameLegacyPair(tx, legacyTable, canonicalTable);
}

async function migrateTablePair(
  tx: TdbcConnection,
  legacyTable: string,
  canonicalTable: string,
): Promise<"renamed" | "noop" | "dropped-empty-new"> {
  const hasLegacy = await tableExists(tx, legacyTable);
  const hasCanonical = await tableExists(tx, canonicalTable);

  if (hasLegacy && !hasCanonical) {
    await renameLegacyPair(tx, legacyTable, canonicalTable);
    return "renamed";
  }

  if (!hasLegacy && hasCanonical) {
    return "noop";
  }

  if (!hasLegacy && !hasCanonical) {
    return "noop";
  }

  // 双表并存（典型：DDL 已 CREATE 空 workplace_*，legacy 仍有 worktree_*）
  const legacyCount = await tableRowCount(tx, legacyTable);
  const canonicalCount = await tableRowCount(tx, canonicalTable);

  if (canonicalCount === 0) {
    await dropEmptyCanonicalThenRename(tx, legacyTable, canonicalTable);
    return "dropped-empty-new";
  }

  if (legacyCount === 0) {
    await tx.execute(`DROP TABLE ${legacyTable}`);
    return "noop";
  }

  throw new Error(
    `schema migration ${RENAME_WORKTREE_TABLES_TO_WORKPLACE_V1_ID}: ` +
      `双表均有数据，无法自动合并（${legacyTable}=${legacyCount}, ` +
      `${canonicalTable}=${canonicalCount}）`,
  );
}

async function up(tx: TdbcConnection): Promise<void> {
  await migrateTablePair(tx, LEGACY_DIR_RULE_TABLE, WORKPLACE_DIR_RULE_TABLE);
  await migrateTablePair(tx, LEGACY_FILE_RULE_TABLE, WORKPLACE_FILE_RULE_TABLE);
  await ensureCanonicalIndexes(tx);
}

/** worktree_* → workplace_*（含撞空新表路径）。 */
export const renameWorktreeTablesToWorkplaceV1Migration: SchemaMigration = {
  id: RENAME_WORKTREE_TABLES_TO_WORKPLACE_V1_ID,
  up,
};

export { up as renameWorktreeTablesToWorkplaceV1Up };
