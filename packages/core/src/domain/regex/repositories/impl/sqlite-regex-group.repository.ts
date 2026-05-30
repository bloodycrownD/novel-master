/**
 * SQLite `regex_group` repository.
 *
 * @module domain/regex/repositories/impl/sqlite-regex-group.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type { RegexGroup } from "../../model/regex-group.js";
import type { RegexGroupRepository } from "../regex-group.port.js";

function rowToGroup(row: Row): RegexGroup {
  return {
    groupId: String(row.group_id),
    displayName: row.display_name != null ? String(row.display_name) : null,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** TDBC-backed regex group repository. */
export class SqliteRegexGroupRepository implements RegexGroupRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async list(): Promise<RegexGroup[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT group_id, display_name, created_at_ms, updated_at_ms
       FROM regex_group ORDER BY group_id`,
      {},
    );
    return rows.map(rowToGroup);
  }

  async findById(groupId: string): Promise<RegexGroup | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT group_id, display_name, created_at_ms, updated_at_ms
       FROM regex_group WHERE group_id = #{groupId}`,
      { groupId },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToGroup(rows[0]!);
  }

  async insert(group: RegexGroup): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO regex_group (
        group_id, display_name, created_at_ms, updated_at_ms
      ) VALUES (
        #{groupId}, #{displayName}, #{createdAtMs}, #{updatedAtMs}
      )`,
      {
        groupId: group.groupId,
        displayName: group.displayName,
        createdAtMs: group.createdAtMs,
        updatedAtMs: group.updatedAtMs,
      },
    );
  }

  async update(group: RegexGroup): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE regex_group SET
        display_name = #{displayName},
        updated_at_ms = #{updatedAtMs}
       WHERE group_id = #{groupId}`,
      {
        groupId: group.groupId,
        displayName: group.displayName,
        updatedAtMs: group.updatedAtMs,
      },
    );
  }

  async delete(groupId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM regex_group WHERE group_id = #{groupId}`,
      { groupId },
    );
  }
}
