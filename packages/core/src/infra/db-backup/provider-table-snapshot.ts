/**
 * 服务商三表的 dump / scrub / restore 实现。
 *
 * @module infra/db-backup/provider-table-snapshot
 */

import type { TdbcConnection } from "../tdbc/ports/connection.port.js";
import type { Row } from "../tdbc/types.js";
import {
  DB_BACKUP_PROVIDER_TABLES,
  type ProviderBackupTableName,
  type ProviderTableSnapshot,
} from "./provider-tables.js";

/** restore 时插入顺序：先父表再子表，与 FK 一致。 */
const RESTORE_TABLE_ORDER: readonly ProviderBackupTableName[] = [
  "llm_provider",
  "llm_saved_model",
  "sksp_secrets",
];

/** scrub 时删除顺序：先子表再父表，避免 FK 约束。 */
const SCRUB_TABLE_ORDER: readonly ProviderBackupTableName[] = [
  "llm_saved_model",
  "llm_provider",
  "sksp_secrets",
];

/**
 * 从当前连接主库读取三张服务商表的全量行。
 */
export async function dumpProviderTableSnapshot(
  conn: TdbcConnection,
): Promise<ProviderTableSnapshot> {
  const snapshot: Record<ProviderBackupTableName, Row[]> = {
    sksp_secrets: [],
    llm_provider: [],
    llm_saved_model: [],
  };
  for (const table of DB_BACKUP_PROVIDER_TABLES) {
    snapshot[table] = await conn.query(`SELECT * FROM ${table}`);
  }
  return snapshot;
}

/**
 * 在当前连接主库上删除三张服务商表的全部行。
 */
export async function scrubProviderTables(conn: TdbcConnection): Promise<void> {
  await scrubProviderTablesWithPrefix(conn);
}

/**
 * ATTACH 指定路径的数据库后清除其中三张服务商表，再 DETACH。
 *
 * @param conn - 持有主库的连接（live DB）
 * @param attachPath - 待清除副本的绝对路径，通过 `?` 绑定以防注入
 * @param alias - ATTACH 别名（字面量写入 SQL，由调用方控制）
 */
export async function scrubProviderTablesInDatabase(
  conn: TdbcConnection,
  attachPath: string,
  alias: string,
): Promise<void> {
  await conn.execute(`ATTACH DATABASE ? AS ${alias}`, [attachPath]);
  try {
    await scrubProviderTablesWithPrefix(conn, alias);
  } finally {
    await conn.execute(`DETACH DATABASE ${alias}`);
  }
}

/**
 * 先清空主库三表，再按 FK 顺序将快照写回（单事务）。
 */
export async function restoreProviderTableSnapshot(
  conn: TdbcConnection,
  snapshot: ProviderTableSnapshot,
): Promise<void> {
  await conn.transaction(async (tx) => {
    await scrubProviderTablesWithPrefix(tx);
    for (const table of RESTORE_TABLE_ORDER) {
      await insertTableRows(tx, table, snapshot[table]);
    }
  });
}

/**
 * 按删除顺序清空指定前缀（或主库）下的三张表。
 */
async function scrubProviderTablesWithPrefix(
  conn: TdbcConnection,
  alias?: string,
): Promise<void> {
  const prefix = alias ? `${alias}.` : "";
  for (const table of SCRUB_TABLE_ORDER) {
    await conn.execute(`DELETE FROM ${prefix}${table}`);
  }
}

/**
 * 将快照行动态 INSERT 到目标表（列名取自首行，空表跳过）。
 */
async function insertTableRows(
  conn: TdbcConnection,
  table: ProviderBackupTableName,
  rows: readonly Row[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const columns = Object.keys(rows[0]!);
  const columnList = columns.join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${columnList}) VALUES (${placeholders})`;
  const parametersList = rows.map((row) =>
    columns.map((column) => row[column] ?? null),
  );
  await conn.batch(sql, parametersList);
}
