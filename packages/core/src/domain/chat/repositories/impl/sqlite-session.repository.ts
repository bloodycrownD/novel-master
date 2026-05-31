/**
 * SQLite chat session repository.
 *
 * @module domain/chat/repositories/impl/sqlite-session.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type { ChatSession } from "../../model/session.js";
import type { SessionRepository } from "../session.port.js";

function rowToSession(row: Row): ChatSession {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: row.title == null ? null : String(row.title),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** TDBC-backed `chat_session` repository. */
export class SqliteSessionRepository implements SessionRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listByProject(projectId: string): Promise<ChatSession[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, project_id, title, created_at_ms, updated_at_ms
       FROM chat_session WHERE project_id = #{projectId} ORDER BY created_at_ms`,
      { projectId },
    );
    return rows.map(rowToSession);
  }

  async findById(id: string): Promise<ChatSession | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, project_id, title, created_at_ms, updated_at_ms
       FROM chat_session WHERE id = #{id}`,
      { id },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToSession(rows[0]!);
  }

  async insert(session: ChatSession): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms)
       VALUES (#{id}, #{projectId}, #{title}, #{createdAtMs}, #{updatedAtMs})`,
      {
        id: session.id,
        projectId: session.projectId,
        title: session.title,
        createdAtMs: session.createdAtMs,
        updatedAtMs: session.updatedAtMs,
      },
    );
  }

  async updateTitle(
    id: string,
    title: string,
    updatedAtMs: number,
  ): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE chat_session SET title = #{title}, updated_at_ms = #{updatedAtMs}
       WHERE id = #{id}`,
      { id, title, updatedAtMs },
    );
    return result.changes > 0;
  }

  async delete(id: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM chat_session WHERE id = #{id}`,
      { id },
    );
    return result.changes > 0;
  }

  async deleteByProject(projectId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM chat_session WHERE project_id = #{projectId}`,
      { projectId },
    );
  }
}
