/**
 * SQLite Session Run State 仓储（SqlTemplateParser）。
 *
 * @module domain/session-run-state/repositories/impl/sqlite-session-run-state.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { SessionRunStateSql } from "@/infra/sql-template/generated/session_run_state.mapper.generated.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { Coerce } from "@/common/coerce.js";
import type { SessionRunState, SessionRunStatus } from "../../model/session-run-state.js";
import type { SessionRunStateRepository } from "../session-run-state.port.js";

function rowToState(row: Row): SessionRunState {
  return {
    sessionId: String(row.session_id),
    projectId: String(row.project_id),
    runId: String(row.run_id),
    status: String(row.status) as SessionRunStatus,
    startedAtMs: Number(row.started_at_ms),
    textChars: Number(row.text_chars),
    thinkingChars: Number(row.thinking_chars),
    completionTokens: Number(row.completion_tokens ?? 0),
    // token_source 列收窄：仅认 usage/heuristic，脏值/缺省回退 heuristic。
    tokenSource: row.token_source === "usage" ? "usage" : "heuristic",
    partialText: Coerce.nullableText(row.partial_text),
    partialThinking: Coerce.nullableText(row.partial_thinking),
    pendingChildrenJson: Coerce.nullableText(row.pending_children_json),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/**
 * 基于 TDBC 的 `session_run_state` 仓储。
 *
 * 所有写路径均为单语句 UPSERT/DELETE（天然原子），调用方无需包事务；
 * 需要与其它表同事务清理时（删除联动）也可安全地在事务连接上调用。
 */
export class SqliteSessionRunStateRepository implements SessionRunStateRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async get(sessionId: string): Promise<SessionRunState | null> {
    const rows = await TdbcTemplate.query(this.conn, this.parser, SessionRunStateSql.get, { sessionId });
    if (rows.length === 0) {
      return null;
    }
    return rowToState(rows[0]!);
  }

  async upsert(state: SessionRunState): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, SessionRunStateSql.upsert, { ...state });
  }

  async listByStatuses(statuses: readonly SessionRunStatus[]): Promise<SessionRunState[]> {
    const unique = [...new Set(statuses)];
    if (unique.length === 0) {
      return [];
    }
    const rows = await TdbcTemplate.query(this.conn, this.parser, SessionRunStateSql.listByStatuses, { statuses: unique });
    return rows.map(rowToState);
  }

  async deleteBySession(sessionId: string): Promise<boolean> {
    const result = await TdbcTemplate.execute(this.conn, this.parser, SessionRunStateSql.deleteBySession, { sessionId });
    return result.changes > 0;
  }

  async deleteByProject(projectId: string): Promise<boolean> {
    const result = await TdbcTemplate.execute(this.conn, this.parser, SessionRunStateSql.deleteByProject, { projectId });
    return result.changes > 0;
  }
}
