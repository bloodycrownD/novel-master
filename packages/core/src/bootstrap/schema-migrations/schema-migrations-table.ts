/**
 * `schema_migrations` 登记表：ensure / 查询 / 写入。
 *
 * @module bootstrap/schema-migrations/schema-migrations-table
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";

const TABLE = "schema_migrations";
const parser = new SqlTemplateParser();

/** 确保 migration 登记表存在（不在 NOVEL_MASTER_SCHEMA_STATEMENTS 内）。 */
export async function ensureSchemaMigrationsTable(
  tx: TdbcConnection,
): Promise<void> {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
  id TEXT PRIMARY KEY,
  applied_at_ms INTEGER NOT NULL
)`,
  );
}

/** 是否已 apply 指定 migration id。 */
export async function isSchemaMigrationApplied(
  tx: TdbcConnection,
  id: string,
): Promise<boolean> {
  const rows = await queryTemplate<{ id: string }>(
    tx,
    parser,
    `SELECT id FROM ${TABLE} WHERE id = #{id}`,
    { id },
  );
  return rows.length > 0;
}

/** 登记 migration 已 apply（调用方须在同一事务内保证幂等）。 */
export async function markSchemaMigrationApplied(
  tx: TdbcConnection,
  id: string,
  appliedAtMs: number,
): Promise<void> {
  await executeTemplate(
    tx,
    parser,
    `INSERT INTO ${TABLE} (id, applied_at_ms) VALUES (#{id}, #{appliedAtMs})`,
    { id, appliedAtMs },
  );
}
