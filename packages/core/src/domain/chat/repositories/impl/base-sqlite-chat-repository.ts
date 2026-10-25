/**
 * SQLite chat 仓储的公共按 id 读 / 写 / 删骨架。
 *
 * 三张 `chat_*` 表的 `findById` / `insert` / `delete` 语义逐字相同，只有表名、
 * 列投影、INSERT 语句与行/参数映射不同。子类通过构造参数传入差异部分，公共
 * 方法只在这里定义一份（`check-methods` 的同名跨类歧义也因此消失）。
 *
 * @module domain/chat/repositories/impl/base-sqlite-chat-repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { executeTemplate, queryTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";

/** 子类差异部分：表名、读列投影、INSERT 语句与两组行/参数映射。 */
type SqliteChatRepositoryOptions<TEntity> = {
  table: string;
  columns: string;
  insertSql: string;
  entityFromRow: (row: Row) => TEntity;
  insertParams: (entity: TEntity) => readonly unknown[];
};

/** `chat_*` 表共用的按 id 读 / 写 / 删。 */
export abstract class BaseSqliteChatRepository<TEntity> {
  protected readonly parser = new SqlTemplateParser();
  private readonly table: string;
  private readonly columns: string;
  private readonly insertSql: string;
  private readonly entityFromRow: (row: Row) => TEntity;
  private readonly insertParams: (entity: TEntity) => readonly unknown[];

  constructor(protected readonly conn: TdbcConnection, options: SqliteChatRepositoryOptions<TEntity>) {
    this.table = options.table;
    this.columns = options.columns;
    this.insertSql = options.insertSql;
    this.entityFromRow = options.entityFromRow;
    this.insertParams = options.insertParams;
  }

  async findById(id: string): Promise<TEntity | null> {
    const rows = await queryTemplate(this.conn, this.parser, `SELECT ${this.columns} FROM ${this.table} WHERE id = #{id}`, { id });
    return rows.length === 0 ? null : this.entityFromRow(rows[0]!);
  }

  async insert(entity: TEntity): Promise<void> {
    await this.conn.execute(this.insertSql, this.insertParams(entity));
  }

  async delete(id: string): Promise<boolean> {
    const result = await executeTemplate(this.conn, this.parser, `DELETE FROM ${this.table} WHERE id = #{id}`, { id });
    return result.changes > 0;
  }
}
