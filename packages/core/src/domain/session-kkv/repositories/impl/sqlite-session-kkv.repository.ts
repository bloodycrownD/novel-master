/**
 * SQLite Session KKV 仓储（SqlTemplateParser）。
 *
 * @module domain/session-kkv/repositories/impl/sqlite-session-kkv.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type { SessionKkvEntry } from "../../model/session-kkv-entry.js";
import type { SessionKkvRepository } from "../session-kkv.port.js";

function rowToEntry(row: Row): SessionKkvEntry {
  return {
    sessionId: String(row.session_id),
    domain: String(row.domain),
    key: String(row.key),
    value: String(row.value),
  };
}

/**
 * 基于 TDBC 的 `session_kkv_entry` 仓储。
 */
export class SqliteSessionKkvRepository implements SessionKkvRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async get(
    sessionId: string,
    domain: string,
    key: string,
  ): Promise<SessionKkvEntry | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT session_id, domain, key, value FROM session_kkv_entry
       WHERE session_id = #{sessionId} AND domain = #{domain} AND key = #{key}`,
      { sessionId, domain, key },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToEntry(rows[0]!);
  }

  async set(
    sessionId: string,
    domain: string,
    key: string,
    value: string,
  ): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO session_kkv_entry (session_id, domain, key, value)
       VALUES (#{sessionId}, #{domain}, #{key}, #{value})
       ON CONFLICT(session_id, domain, key) DO UPDATE SET value = excluded.value`,
      { sessionId, domain, key, value },
    );
  }

  async delete(
    sessionId: string,
    domain: string,
    key: string,
  ): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_kkv_entry
       WHERE session_id = #{sessionId} AND domain = #{domain} AND key = #{key}`,
      { sessionId, domain, key },
    );
    return result.changes > 0;
  }

  async clearSession(sessionId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_kkv_entry WHERE session_id = #{sessionId}`,
      { sessionId },
    );
  }

  async listKeys(sessionId: string, domain: string): Promise<string[]> {
    const rows = await queryTemplate<{ key: string }>(
      this.conn,
      this.parser,
      `SELECT key FROM session_kkv_entry
       WHERE session_id = #{sessionId} AND domain = #{domain}
       ORDER BY key`,
      { sessionId, domain },
    );
    return rows.map((row) => String(row.key));
  }
}
