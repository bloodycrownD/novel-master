/**
 * SQLite chat project repository.
 *
 * @module domain/chat/repositories/impl/sqlite-project.repository
 */

import type { TdbcConnection } from "../../../../infra/tdbc/connection.js";
import { SqlTemplateParser } from "../../../../infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "../../../../infra/tdbc/template-helper.js";
import type { Row } from "../../../../infra/tdbc/types.js";
import type { ChatProject } from "../../model/project.js";
import type { ProjectRepository } from "../project.port.js";

function rowToProject(row: Row): ChatProject {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** TDBC-backed `chat_project` repository. */
export class SqliteProjectRepository implements ProjectRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async list(): Promise<ChatProject[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, name, created_at_ms, updated_at_ms FROM chat_project ORDER BY created_at_ms`,
      {},
    );
    return rows.map(rowToProject);
  }

  async findById(id: string): Promise<ChatProject | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, name, created_at_ms, updated_at_ms FROM chat_project WHERE id = #{id}`,
      { id },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToProject(rows[0]!);
  }

  async insert(project: ChatProject): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO chat_project (id, name, created_at_ms, updated_at_ms)
       VALUES (#{id}, #{name}, #{createdAtMs}, #{updatedAtMs})`,
      {
        id: project.id,
        name: project.name,
        createdAtMs: project.createdAtMs,
        updatedAtMs: project.updatedAtMs,
      },
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM chat_project WHERE id = #{id}`,
      { id },
    );
    return result.changes > 0;
  }
}
