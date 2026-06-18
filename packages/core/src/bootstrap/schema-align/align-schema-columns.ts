/**
 * 对已有 SQLite 表逐项检测并补齐缺失列（声明式 legacy 列对齐）。
 *
 * 与已删除的历史 migrate 不同：仅 ADD COLUMN，不 DROP、不 KKV 搬迁、不做 wire 迁移。
 *
 * @module bootstrap/schema-align/align-schema-columns
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SCHEMA_COLUMN_ALIGNMENTS } from "./schema-column-alignments.js";

/**
 * 查询表已有列名集合。
 *
 * 表不存在时 `pragma_table_info` 无行，返回空 Set。
 *
 * @param tx - 事务连接
 * @param table - 表名
 */
async function tableColumnNames(
  tx: TdbcConnection,
  table: string,
): Promise<Set<string>> {
  const rows = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`,
  );
  return new Set(rows.map((row) => row.name));
}

/**
 * 对已有表逐项 pragma 检测并 ADD 缺失列；表不存在则跳过（新库由 DDL 创建）。
 *
 * `afterAdd` 仅在该次 ADD 列之后执行，避免每次 bootstrap 重复全表写。
 *
 * @param tx - 事务连接
 */
export async function alignSchemaColumns(tx: TdbcConnection): Promise<void> {
  for (const alignment of SCHEMA_COLUMN_ALIGNMENTS) {
    const columnNames = await tableColumnNames(tx, alignment.table);
    if (columnNames.size === 0) {
      continue;
    }
    if (columnNames.has(alignment.column)) {
      continue;
    }
    await tx.execute(alignment.addColumnSql);
    if (alignment.afterAdd) {
      await alignment.afterAdd(tx);
    }
  }
}
