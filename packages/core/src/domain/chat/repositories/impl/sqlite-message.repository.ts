/**
 * SQLite chat message repository.
 *
 * @module domain/chat/repositories/impl/sqlite-message.repository
 */

import type { TdbcConnection } from "../../../../infra/tdbc/connection.js";
import { SqlTemplateParser } from "../../../../infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "../../../../infra/tdbc/template-helper.js";
import type { Row } from "../../../../infra/tdbc/types.js";
import type { ChatMessage, MessageContent } from "../../model/message.js";
import type { MessageRepository } from "../message.port.js";

function parseContent(json: string): MessageContent {
  return JSON.parse(json) as MessageContent;
}

function rowToMessage(row: Row): ChatMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    seq: Number(row.seq),
    role: String(row.role),
    content: parseContent(String(row.content_json)),
    provider: row.provider == null ? null : String(row.provider),
    raw:
      row.raw_json == null
        ? null
        : (JSON.parse(String(row.raw_json)) as Record<string, unknown>),
    createdAtMs: Number(row.created_at_ms),
  };
}

/** TDBC-backed `chat_message` repository. */
export class SqliteMessageRepository implements MessageRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listBySession(sessionId: string): Promise<ChatMessage[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, session_id, seq, role, content_json, provider, raw_json, created_at_ms
       FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC`,
      { sessionId },
    );
    return rows.map(rowToMessage);
  }

  async findById(id: string): Promise<ChatMessage | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, session_id, seq, role, content_json, provider, raw_json, created_at_ms
       FROM chat_message WHERE id = #{id}`,
      { id },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToMessage(rows[0]!);
  }

  async nextSeq(sessionId: string): Promise<number> {
    const rows = await queryTemplate<{ max_seq: number | null }>(
      this.conn,
      this.parser,
      `SELECT MAX(seq) AS max_seq FROM chat_message WHERE session_id = #{sessionId}`,
      { sessionId },
    );
    const maxSeq = rows[0]?.max_seq;
    return maxSeq == null ? 1 : Number(maxSeq) + 1;
  }

  async insert(message: ChatMessage): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO chat_message
       (id, session_id, seq, role, content_json, provider, raw_json, created_at_ms)
       VALUES (#{id}, #{sessionId}, #{seq}, #{role}, #{contentJson}, #{provider}, #{rawJson}, #{createdAtMs})`,
      {
        id: message.id,
        sessionId: message.sessionId,
        seq: message.seq,
        role: message.role,
        contentJson: JSON.stringify(message.content),
        provider: message.provider,
        rawJson: message.raw == null ? null : JSON.stringify(message.raw),
        createdAtMs: message.createdAtMs,
      },
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM chat_message WHERE id = #{id}`,
      { id },
    );
    return result.changes > 0;
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM chat_message WHERE session_id = #{sessionId}`,
      { sessionId },
    );
  }
}
