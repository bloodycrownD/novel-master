/**
 * SQLite KKV repository using SqlTemplateParser.
 *
 * @module domain/kkv/repositories/impl/sqlite-kkv.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type { KkvEntry } from "../../model/kkv-entry.js";
import type { KkvRepository } from "../kkv.port.js";

function rowToEntry(row: Row): KkvEntry {
  return {
    module: String(row.module),
    key: String(row.key),
    value: String(row.value),
  };
}

/**
 * TDBC-backed `kkv_entry` repository.
 */
export class SqliteKkvRepository implements KkvRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listKeys(module: string): Promise<string[]> {
    const rows = await queryTemplate<{ key: string }>(
      this.conn,
      this.parser,
      `SELECT key FROM kkv_entry WHERE module = #{module} ORDER BY key`,
      { module },
    );
    return rows.map((row) => String(row.key));
  }

  async get(module: string, key: string): Promise<KkvEntry | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT module, key, value FROM kkv_entry
       WHERE module = #{module} AND key = #{key}`,
      { module, key },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToEntry(rows[0]!);
  }

  async set(module: string, key: string, value: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO kkv_entry (module, key, value) VALUES (#{module}, #{key}, #{value})
       ON CONFLICT(module, key) DO UPDATE SET value = excluded.value`,
      { module, key, value },
    );
  }

  async delete(module: string, key: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM kkv_entry WHERE module = #{module} AND key = #{key}`,
      { module, key },
    );
    return result.changes > 0;
  }
}
