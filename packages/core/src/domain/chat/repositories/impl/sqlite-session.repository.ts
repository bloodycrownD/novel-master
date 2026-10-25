/**
 * SQLite chat session repository.
 *
 * @module domain/chat/repositories/impl/sqlite-session.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { executeTemplate, queryTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { nullableText } from "@/common/coerce.js";
import type { ChatSession } from "../../model/session.js";
import type { SessionRepository } from "../session.port.js";
import { BaseSqliteChatRepository } from "./base-sqlite-chat-repository.js";

const SESSION_COLUMNS = "id, project_id, title, parent_session_id, created_at_ms, updated_at_ms";

const SESSION_INSERT_SQL = `INSERT INTO chat_session (${SESSION_COLUMNS}) VALUES (${SESSION_COLUMNS.split(", ").map(() => "?").join(", ")})`;

function rowToSession(row: Row): ChatSession {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: nullableText(row.title),
    parentSessionId: nullableText(row.parent_session_id),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** TDBC-backed `chat_session` repository. */
export class SqliteSessionRepository extends BaseSqliteChatRepository<ChatSession> implements SessionRepository {
  constructor(conn: TdbcConnection) {
    super(conn, {
      table: "chat_session",
      columns: SESSION_COLUMNS,
      insertSql: SESSION_INSERT_SQL,
      entityFromRow: rowToSession,
      insertParams: (session) => [session.id, session.projectId, session.title, session.parentSessionId, session.createdAtMs, session.updatedAtMs],
    });
  }

  async listByProject(projectId: string): Promise<ChatSession[]> {
    const sql = `SELECT ${SESSION_COLUMNS} FROM chat_session WHERE project_id = #{projectId} AND parent_session_id IS NULL ORDER BY created_at_ms`;
    const rows = await queryTemplate(this.conn, this.parser, sql, { projectId });
    return rows.map(rowToSession);
  }

  async listByParentSession(parentSessionId: string): Promise<ChatSession[]> {
    const sql = `SELECT ${SESSION_COLUMNS} FROM chat_session WHERE parent_session_id = #{parentSessionId} ORDER BY created_at_ms`;
    const rows = await queryTemplate(this.conn, this.parser, sql, { parentSessionId });
    return rows.map(rowToSession);
  }

  /** nm-style: keep-public — SessionRepository 端口方法；session.service 单点调用。 */
  async updateTitle(id: string, title: string, updatedAtMs: number): Promise<boolean> {
    const sql = "UPDATE chat_session SET title = #{title}, updated_at_ms = #{updatedAtMs} WHERE id = #{id}";
    const result = await executeTemplate(this.conn, this.parser, sql, { id, title, updatedAtMs });
    return result.changes > 0;
  }

  async deleteByProject(projectId: string): Promise<void> {
    const sql = "DELETE FROM chat_session WHERE project_id = #{projectId}";
    await executeTemplate(this.conn, this.parser, sql, { projectId });
  }

  async getComposerDraftJson(id: string): Promise<string | null> {
    const sql = "SELECT composer_draft_json FROM chat_session WHERE id = #{id}";
    const rows = await queryTemplate(this.conn, this.parser, sql, { id });
    if (rows.length === 0) {
      return null;
    }
    return nullableText(rows[0]!.composer_draft_json);
  }

  async setComposerDraftJson(id: string, draftJson: string | null): Promise<boolean> {
    const sql = "UPDATE chat_session SET composer_draft_json = #{draftJson} WHERE id = #{id}";
    const result = await executeTemplate(this.conn, this.parser, sql, { id, draftJson });
    return result.changes > 0;
  }

  async getSessionAgentConfig(id: string): Promise<string | null> {
    const sql = "SELECT agent_config_json FROM chat_session WHERE id = #{id}";
    const rows = await queryTemplate(this.conn, this.parser, sql, { id });
    if (rows.length === 0) {
      return null;
    }
    return nullableText(rows[0]!.agent_config_json);
  }

  async setSessionAgentConfig(id: string, agentConfigJson: string | null, updatedAtMs: number): Promise<boolean> {
    // 绑定切换是会话活动（区别于高频草稿写），同步更新 updated_at_ms。
    const sql = "UPDATE chat_session SET agent_config_json = #{agentConfigJson}, updated_at_ms = #{updatedAtMs} WHERE id = #{id}";
    const result = await executeTemplate(this.conn, this.parser, sql, { id, agentConfigJson, updatedAtMs });
    return result.changes > 0;
  }
}
