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
 * 对已有表逐项 pragma 检测并 ADD 缺失列；表不存在则跳过（新库由 DDL 创建）。
 *
 * `afterAdd` 仅在该次 ADD 列之后执行，避免每次 bootstrap 重复全表写。
 *
 * nm-style: keep-public — bootstrap 主编排（novel-master-bootstrap.ts）跨文件唯一调用，属 bootstrap 阶段入口。
 *
 * @param tx - 事务连接
 */
export async function alignSchemaColumns(tx: TdbcConnection): Promise<void> {
  for (const alignment of SCHEMA_COLUMN_ALIGNMENTS) {
    const rows = await tx.query<{ name: string }>(`SELECT name FROM pragma_table_info('${alignment.table}')`);
    const columnNames = new Set(rows.map((row) => row.name));
    if (columnNames.size === 0 || columnNames.has(alignment.column)) {
      continue;
    }
    await tx.execute(alignment.addColumnSql);
    if (alignment.afterAdd) {
      await alignment.afterAdd(tx);
    }
  }
}
