/**
 * `schema_migrations` 登记表：ensure / 查询 / 写入。
 *
 * @module bootstrap/schema-migrations/schema-migrations-table
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { SchemaMigrationsSql } from "@/infra/sql-template/generated/schema_migrations.mapper.generated.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";

const TABLE = "schema_migrations";
const parser = new SqlTemplateParser();

/**
 * `schema_migrations` 登记表操作族。
 */
export const SchemaMigrationsTable = {
  /** 确保 migration 登记表存在（不在 NOVEL_MASTER_SCHEMA_STATEMENTS 内）。 */
  async ensure(tx: TdbcConnection): Promise<void> {
    await tx.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (
  id TEXT PRIMARY KEY,
  applied_at_ms INTEGER NOT NULL
)`);
  },

  /** 一次读出全部已 apply 的 migration id（供 runner 避免 N+1）。 */
  async listAppliedIds(tx: TdbcConnection): Promise<Set<string>> {
    const rows = await TdbcTemplate.query<{ id: string }>(tx, parser, SchemaMigrationsSql.listAppliedIds, {});
    return new Set(rows.map((row) => String(row.id)));
  },

  /**
   * 登记 migration 已 apply（调用方须在同一事务内保证幂等）。
   *
   * nm-style: keep-public — 登记表写入口；TABLE/parser 是本模块私有建表状态，内联会让 runner 复刻表名与解析器。
   */
  async markApplied(tx: TdbcConnection, id: string, appliedAtMs: number): Promise<void> {
    await TdbcTemplate.execute(tx, parser, SchemaMigrationsSql.markApplied, { id, appliedAtMs });
  },
} as const;
