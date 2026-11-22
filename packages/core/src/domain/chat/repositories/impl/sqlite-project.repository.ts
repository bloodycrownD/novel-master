/**
 * SQLite chat project repository.
 *
 * @module domain/chat/repositories/impl/sqlite-project.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { Coerce } from "@/common/coerce.js";
import type { ChatProject } from "../../model/project.js";
import type { ProjectRepository } from "../project.port.js";
import { BaseSqliteChatRepository } from "./base-sqlite-chat-repository.js";
import { ChatProjectSql, ChatProjectSqlFragments } from "@/infra/sql-template/generated/chat_project.mapper.generated.js";

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
      columns: ChatProjectSqlFragments.selectColumns,
      insertSql: ChatProjectSql.insert,
      entityFromRow: rowToProject,
      insertParams: (project) => [project.id, project.name, project.createdAtMs, project.updatedAtMs],
    });
  }

  async list(): Promise<ChatProject[]> {
    const rows = await TdbcTemplate.query(this.conn, this.parser, ChatProjectSql.list, {});
    return rows.map(rowToProject);
  }

  /** nm-style: keep-public — ProjectRepository 端口方法；project.service 单点调用。 */
  async updateName(id: string, name: string, updatedAtMs: number): Promise<boolean> {
    const result = await TdbcTemplate.execute(this.conn, this.parser, ChatProjectSql.updateName, { id, name, updatedAtMs });
    return result.changes > 0;
  }

  async getAgentConfig(id: string): Promise<string | null> {
    const rows = await TdbcTemplate.query(this.conn, this.parser, ChatProjectSql.getAgentConfig, { id });
    if (rows.length === 0) {
      return null;
    }
    return Coerce.nullableText(rows[0]!.agent_config_json);
  }

  async updateAgentConfig(id: string, configJson: string | null, updatedAtMs: number): Promise<boolean> {
    const result = await TdbcTemplate.execute(this.conn, this.parser, ChatProjectSql.updateAgentConfig, { id, configJson, updatedAtMs });
    return result.changes > 0;
  }

}
