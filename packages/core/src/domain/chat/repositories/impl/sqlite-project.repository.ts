/**
 * SQLite chat project repository.
 *
 * @module domain/chat/repositories/impl/sqlite-project.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { executeTemplate, queryTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { nullableText } from "@/common/coerce.js";
import type { ChatProject } from "../../model/project.js";
import type { ProjectRepository } from "../project.port.js";
import { BaseSqliteChatRepository } from "./base-sqlite-chat-repository.js";

const PROJECT_COLUMNS = "id, name, created_at_ms, updated_at_ms";

const PROJECT_INSERT_SQL = `INSERT INTO chat_project (${PROJECT_COLUMNS}) VALUES (${PROJECT_COLUMNS.split(", ").map(() => "?").join(", ")})`;

function rowToProject(row: Row): ChatProject {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** TDBC-backed `chat_project` repository. */
export class SqliteProjectRepository extends BaseSqliteChatRepository<ChatProject> implements ProjectRepository {
  constructor(conn: TdbcConnection) {
    super(conn, {
      table: "chat_project",
      columns: PROJECT_COLUMNS,
      insertSql: PROJECT_INSERT_SQL,
      entityFromRow: rowToProject,
      insertParams: (project) => [project.id, project.name, project.createdAtMs, project.updatedAtMs],
    });
  }

  async list(): Promise<ChatProject[]> {
    const sql = `SELECT ${PROJECT_COLUMNS} FROM chat_project ORDER BY created_at_ms`;
    const rows = await queryTemplate(this.conn, this.parser, sql, {});
    return rows.map(rowToProject);
  }

  /** nm-style: keep-public — ProjectRepository 端口方法；project.service 单点调用。 */
  async updateName(id: string, name: string, updatedAtMs: number): Promise<boolean> {
    const sql = `UPDATE chat_project SET name = #{name}, updated_at_ms = #{updatedAtMs} WHERE id = #{id}`;
    const result = await executeTemplate(this.conn, this.parser, sql, { id, name, updatedAtMs });
    return result.changes > 0;
  }

  async getAgentConfig(id: string): Promise<string | null> {
    const sql = "SELECT agent_config_json FROM chat_project WHERE id = #{id}";
    const rows = await queryTemplate(this.conn, this.parser, sql, { id });
    if (rows.length === 0) {
      return null;
    }
    return nullableText(rows[0]!.agent_config_json);
  }

  async updateAgentConfig(id: string, configJson: string | null, updatedAtMs: number): Promise<boolean> {
    const sql = `UPDATE chat_project SET agent_config_json = #{configJson}, updated_at_ms = #{updatedAtMs} WHERE id = #{id}`;
    const result = await executeTemplate(this.conn, this.parser, sql, { id, configJson, updatedAtMs });
    return result.changes > 0;
  }

}
