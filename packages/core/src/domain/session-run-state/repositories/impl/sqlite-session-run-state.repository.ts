/**
 * SQLite Session Run State 仓储（SqlTemplateParser）。
 *
 * @module domain/session-run-state/repositories/impl/sqlite-session-run-state.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type {
  SessionRunState,
  SessionRunStatus,
} from "../../model/session-run-state.js";
import type { SessionRunStateRepository } from "../session-run-state.port.js";

function nullableText(value: unknown): string | null {
  return value == null ? null : String(value);
}

function rowToState(row: Row): SessionRunState {
  return {
    sessionId: String(row.session_id),
    projectId: String(row.project_id),
    runId: String(row.run_id),
    status: String(row.status) as SessionRunStatus,
    startedAtMs: Number(row.started_at_ms),
    textChars: Number(row.text_chars),
    thinkingChars: Number(row.thinking_chars),
    partialText: nullableText(row.partial_text),
    partialThinking: nullableText(row.partial_thinking),
    pendingChildrenJson: nullableText(row.pending_children_json),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/**
 * 基于 TDBC 的 `session_run_state` 仓储。
 *
 * 所有写路径均为单语句 UPSERT/DELETE（天然原子），调用方无需包事务；
 * 需要与其它表同事务清理时（删除联动）也可安全地在事务连接上调用。
 */
export class SqliteSessionRunStateRepository
  implements SessionRunStateRepository
{
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async get(sessionId: string): Promise<SessionRunState | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT session_id, project_id, run_id, status, started_at_ms,
              text_chars, thinking_chars, partial_text, partial_thinking,
              pending_children_json, updated_at_ms
       FROM session_run_state WHERE session_id = #{sessionId}`,
      { sessionId }
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToState(rows[0]!);
  }

  async upsert(state: SessionRunState): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO session_run_state (
         session_id, project_id, run_id, status, started_at_ms,
         text_chars, thinking_chars, partial_text, partial_thinking,
         pending_children_json, updated_at_ms
       ) VALUES (
         #{sessionId}, #{projectId}, #{runId}, #{status}, #{startedAtMs},
         #{textChars}, #{thinkingChars}, #{partialText}, #{partialThinking},
         #{pendingChildrenJson}, #{updatedAtMs}
       )
       ON CONFLICT(session_id) DO UPDATE SET
         project_id = excluded.project_id,
         run_id = excluded.run_id,
         status = excluded.status,
         started_at_ms = excluded.started_at_ms,
         text_chars = excluded.text_chars,
         thinking_chars = excluded.thinking_chars,
         partial_text = excluded.partial_text,
         partial_thinking = excluded.partial_thinking,
         pending_children_json = excluded.pending_children_json,
         updated_at_ms = excluded.updated_at_ms`,
      { ...state }
    );
  }

  async listByStatuses(
    statuses: readonly SessionRunStatus[]
  ): Promise<SessionRunState[]> {
    const unique = [...new Set(statuses)];
    if (unique.length === 0) {
      return [];
    }
    const bindings: Record<string, string> = {};
    const inClause = unique
      .map((status, index) => {
        bindings[`status${index}`] = status;
        return `#{status${index}}`;
      })
      .join(", ");
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT session_id, project_id, run_id, status, started_at_ms,
              text_chars, thinking_chars, partial_text, partial_thinking,
              pending_children_json, updated_at_ms
       FROM session_run_state WHERE status IN (${inClause})
       ORDER BY session_id`,
      bindings
    );
    return rows.map(rowToState);
  }

  async deleteBySession(sessionId: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_run_state WHERE session_id = #{sessionId}`,
      { sessionId }
    );
    return result.changes > 0;
  }

  async deleteByProject(projectId: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_run_state WHERE project_id = #{projectId}`,
      { projectId }
    );
    return result.changes > 0;
  }
}
