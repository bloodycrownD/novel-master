/**
 * SQLite chat message repository.
 *
 * @module domain/chat/repositories/impl/sqlite-message.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { parseMessageContent } from "../../content/parse-message-content.js";
import {
  escapeLikePattern,
  type MessageSearchQuery,
} from "../../content/message-content-match.js";
import {
  parseAttachmentsJson,
  serializeAttachmentsJson,
} from "../../model/message-attachment.schema.js";
import type { ChatMessage } from "../../model/message.js";
import type { MessageUsage } from "../../model/message-usage.js";
import type { MessageRepository } from "../message.port.js";

const MESSAGE_SELECT_COLUMNS =
  `id, session_id, seq, role, content_json, provider, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens`;

function parseContent(json: string) {
  return parseMessageContent(json);
}

function rowToMessage(row: Row): ChatMessage {
  const attachments = parseAttachmentsJson(
    row.attachments_json == null ? null : String(row.attachments_json),
  );
  const usage = parseUsage(row);
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
    // Parse hidden column: 1 = true, 0 = false
    hidden: Number(row.hidden) === 1,
    ...(attachments != null ? { attachments } : {}),
    ...(usage != null ? { usage } : {}),
  };
}

function parseUsage(row: Row): MessageUsage | undefined {
  const promptTokens = row.prompt_tokens;
  const completionTokens = row.completion_tokens;
  const totalTokens = row.total_tokens;
  if (
    promptTokens == null &&
    completionTokens == null &&
    totalTokens == null
  ) {
    return undefined;
  }
  return {
    ...(promptTokens != null ? { promptTokens: Number(promptTokens) } : {}),
    ...(completionTokens != null
      ? { completionTokens: Number(completionTokens) }
      : {}),
    ...(totalTokens != null ? { totalTokens: Number(totalTokens) } : {}),
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
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC`,
      { sessionId },
    );
    return rows.map(rowToMessage);
  }

  async listBySessionTail(sessionId: string, limit: number): Promise<ChatMessage[]> {
    const clampedLimit = Math.max(1, Math.floor(limit));
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM (
         SELECT ${MESSAGE_SELECT_COLUMNS}
         FROM chat_message
         WHERE session_id = #{sessionId}
         ORDER BY seq DESC
         LIMIT #{limit}
       )
       ORDER BY seq ASC`,
      { sessionId, limit: clampedLimit },
    );
    return rows.map(rowToMessage);
  }

  async listBySessionPage(
    sessionId: string,
    limit: number,
    beforeSeq?: number,
  ): Promise<ChatMessage[]> {
    const clampedLimit = Math.max(1, Math.floor(limit));
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM (
         SELECT ${MESSAGE_SELECT_COLUMNS}
         FROM chat_message
         WHERE session_id = #{sessionId}
           AND (#{beforeSeq} IS NULL OR seq < #{beforeSeq})
         ORDER BY seq DESC
         LIMIT #{limit}
       )
       ORDER BY seq ASC`,
      { sessionId, beforeSeq: beforeSeq ?? null, limit: clampedLimit },
    );
    return rows.map(rowToMessage);
  }

  async findById(id: string): Promise<ChatMessage | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
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

  async updateContent(id: string, contentJson: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE chat_message SET content_json = #{contentJson} WHERE id = #{id}`,
      { id, contentJson },
    );
    return result.changes > 0;
  }

  async insert(message: ChatMessage): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO chat_message
       (id, session_id, seq, role, content_json, provider, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens)
       VALUES (#{id}, #{sessionId}, #{seq}, #{role}, #{contentJson}, #{provider}, #{rawJson}, #{createdAtMs}, #{hidden}, #{attachmentsJson}, #{promptTokens}, #{completionTokens}, #{totalTokens})`,
      {
        id: message.id,
        sessionId: message.sessionId,
        seq: message.seq,
        role: message.role,
        contentJson: JSON.stringify(message.content),
        provider: message.provider,
        rawJson: message.raw == null ? null : JSON.stringify(message.raw),
        createdAtMs: message.createdAtMs,
        // Convert boolean to integer: true = 1, false = 0
        hidden: message.hidden ? 1 : 0,
        attachmentsJson: serializeAttachmentsJson(message.attachments),
        promptTokens: message.usage?.promptTokens ?? null,
        completionTokens: message.usage?.completionTokens ?? null,
        totalTokens: message.usage?.totalTokens ?? null,
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

  async deleteAfterSeq(sessionId: string, afterSeq: number): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM chat_message WHERE session_id = #{sessionId} AND seq > #{afterSeq}`,
      { sessionId, afterSeq },
    );
  }

  async listIdsAfterSeq(sessionId: string, afterSeq: number): Promise<string[]> {
    const rows = await queryTemplate<{ id: string }>(
      this.conn,
      this.parser,
      `SELECT id FROM chat_message
       WHERE session_id = #{sessionId} AND seq > #{afterSeq}`,
      { sessionId, afterSeq },
    );
    return rows.map((row) => String(row.id));
  }

  async updateHidden(messageId: string, hidden: boolean): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE chat_message SET hidden = #{hidden} WHERE id = #{id}`,
      { id: messageId, hidden: hidden ? 1 : 0 },
    );
    return result.changes > 0;
  }

  async updateHiddenRange(
    sessionId: string,
    fromSeq: number,
    toSeq: number,
    hidden: boolean,
  ): Promise<number> {
    const hiddenFilter = hidden ? "AND hidden = 0" : "AND hidden = 1";
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE chat_message 
       SET hidden = #{hidden} 
       WHERE session_id = #{sessionId} 
         AND seq >= #{fromSeq} 
         AND seq <= #{toSeq}
         ${hiddenFilter}`,
      { sessionId, fromSeq, toSeq, hidden: hidden ? 1 : 0 },
    );
    return result.changes;
  }

  async searchMessages(
    sessionId: string,
    query: MessageSearchQuery,
  ): Promise<ChatMessage[]> {
    const keyword = query.keyword?.trim() ?? "";
    const hasKeyword = keyword.length > 0;
    // keyword 非空时加 role 粗筛 + LIKE 粗筛（LIKE 扫整个 content_json 是超集，内存层再精筛 TextBlock）；
    // keyword 为空时不加 role / LIKE 过滤，返回所有类型消息。
    const roleFilter = hasKeyword
      ? "AND role IN ('user', 'assistant')"
      : "";
    // JS 源码双反斜杠 → 落到 SQL 是单反斜杠 ESCAPE '\'。
    const likeFilter = hasKeyword
      ? "AND content_json LIKE #{likePattern} ESCAPE '\\'"
      : "";
    const likePattern = hasKeyword
      ? `%${escapeLikePattern(keyword)}%`
      : null;
    const clampedLimit = Math.max(1, Math.floor(query.limit));
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM chat_message
       WHERE session_id = #{sessionId}
         ${roleFilter}
         ${likeFilter}
         AND (#{beforeSeq} IS NULL OR seq < #{beforeSeq})
       ORDER BY seq DESC
       LIMIT #{limit}`,
      {
        sessionId,
        likePattern,
        beforeSeq: query.beforeSeq ?? null,
        limit: clampedLimit,
      },
    );
    return rows.map(rowToMessage);
  }
}
