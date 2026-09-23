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
import type { MessageSearchQuery } from "../../content/message-content-match.js";
import { messageMatchesKeyword } from "../../content/message-content-match.js";
import {
  parseAttachmentsJson,
  serializeAttachmentsJson,
} from "../../model/message-attachment.schema.js";
import type { ChatMessage } from "../../model/message.js";
import type { MessageContent } from "../../model/content-block.js";
import type { MessageUsage } from "../../model/message-usage.js";
import {
  decodeMessageContent,
  encodeMessageContent,
} from "../../logic/message-content-codec.js";
import type { MessageRepository } from "../message.port.js";

const MESSAGE_SELECT_COLUMNS = `id, session_id, seq, role, content_json, content_encoding, content_blob, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms`;

/**
 * chat_message 的 INSERT 语句（`?` 占位），insert 与 batchInsert 共用。
 *
 * 列顺序与 {@link toMessageParams} 的参数顺序一一对应，改一处必须同步另一处。
 */
const MESSAGE_INSERT_SQL =
  `INSERT INTO chat_message ` +
  `(id, session_id, seq, role, content_json, content_encoding, content_blob, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms) ` +
  `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * 把 ChatMessage 摊平成与 {@link MESSAGE_INSERT_SQL} 列顺序对齐的参数数组。
 *
 * insert 走 executeTemplate 时由 SqlTemplateParser 按 `#{xxx}` 出现顺序收集参数，
 * 这里手写数组必须保持同一顺序——两边的列/`?`/参数三者完全对齐。
 *
 * 消息正文压缩：content_json 置空串 ''（NOT NULL 约束自然满足，blocks JSON
 * 恒非空串，'' 无歧义），正文走 content_encoding/content_blob 压缩两列
 * （编码收口在 {@link encodeMessageContent}，三端零感知）。
 */
function toMessageParams(message: ChatMessage): unknown[] {
  const encoded = encodeMessageContent(JSON.stringify(message.content));
  return [
    message.id,
    message.sessionId,
    message.seq,
    message.role,
    "",
    encoded.encoding,
    encoded.blob,
    message.provider,
    message.providerId ?? null,
    message.raw == null ? null : JSON.stringify(message.raw),
    message.createdAtMs,
    // Convert boolean to integer: true = 1, false = 0
    message.hidden ? 1 : 0,
    serializeAttachmentsJson(message.attachments),
    message.usage?.promptTokens ?? null,
    message.usage?.completionTokens ?? null,
    message.usage?.totalTokens ?? null,
    message.usage?.cacheReadTokens ?? null,
    message.usage?.cacheCreationTokens ?? null,
    message.modelName ?? null,
    message.usage?.firstTokenMs ?? null,
    message.usage?.durationMs ?? null,
  ];
}

/** 双形态读：content_blob 非空走解压，否则 parse content_json 明文。 */
function readRowContent(row: Row): MessageContent {
  if (row.content_blob != null) {
    return parseMessageContent(
      decodeMessageContent(
        row.content_encoding,
        row.content_blob,
        String(row.id)
      )
    );
  }
  // legacy 明文行（e2e fixture 直插 / 压缩任务未搬运 / 整体回滚写路径）。
  return parseMessageContent(String(row.content_json));
}

function rowToMessage(row: Row): ChatMessage {
  const attachments = parseAttachmentsJson(
    row.attachments_json == null ? null : String(row.attachments_json)
  );
  const usage = parseUsage(row);
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    seq: Number(row.seq),
    role: String(row.role),
    content: readRowContent(row),
    provider: row.provider == null ? null : String(row.provider),
    providerId: row.provider_id == null ? null : String(row.provider_id),
    modelName: row.model_name == null ? null : String(row.model_name),
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
  const cacheReadTokens = row.cache_read_tokens;
  const cacheCreationTokens = row.cache_creation_tokens;
  const firstTokenMs = row.first_token_ms;
  const durationMs = row.duration_ms;
  if (
    promptTokens == null &&
    completionTokens == null &&
    totalTokens == null &&
    cacheReadTokens == null &&
    cacheCreationTokens == null &&
    firstTokenMs == null &&
    durationMs == null
  ) {
    return undefined;
  }
  return {
    ...(promptTokens != null ? { promptTokens: Number(promptTokens) } : {}),
    ...(completionTokens != null
      ? { completionTokens: Number(completionTokens) }
      : {}),
    ...(totalTokens != null ? { totalTokens: Number(totalTokens) } : {}),
    ...(cacheReadTokens != null
      ? { cacheReadTokens: Number(cacheReadTokens) }
      : {}),
    ...(cacheCreationTokens != null
      ? { cacheCreationTokens: Number(cacheCreationTokens) }
      : {}),
    ...(firstTokenMs != null ? { firstTokenMs: Number(firstTokenMs) } : {}),
    ...(durationMs != null ? { durationMs: Number(durationMs) } : {}),
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
      { sessionId }
    );
    return rows.map(rowToMessage);
  }

  async countBySession(sessionId: string): Promise<number> {
    const rows = await queryTemplate<{ n: number }>(
      this.conn,
      this.parser,
      `SELECT COUNT(*) AS n FROM chat_message WHERE session_id = #{sessionId}`,
      { sessionId }
    );
    // COUNT(*) 恒返回一行；SQLite 下 COUNT 结果是 INTEGER，Number() 安全。
    return Number(rows[0]!.n);
  }

  async listBySessionOffset(
    sessionId: string,
    offset: number
  ): Promise<ChatMessage[]> {
    const clampedOffset = Math.max(0, Math.floor(offset));
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM chat_message
       WHERE session_id = #{sessionId}
       ORDER BY seq ASC
       LIMIT -1 OFFSET #{offset}`,
      { sessionId, offset: clampedOffset }
    );
    return rows.map(rowToMessage);
  }

  async listBySessionTail(
    sessionId: string,
    limit: number
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
         ORDER BY seq DESC
         LIMIT #{limit}
       )
       ORDER BY seq ASC`,
      { sessionId, limit: clampedLimit }
    );
    return rows.map(rowToMessage);
  }

  async listBySessionPage(
    sessionId: string,
    limit: number,
    beforeSeq?: number
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
      { sessionId, beforeSeq: beforeSeq ?? null, limit: clampedLimit }
    );
    return rows.map(rowToMessage);
  }

  async findById(id: string): Promise<ChatMessage | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM chat_message WHERE id = #{id}`,
      { id }
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
      { sessionId }
    );
    const maxSeq = rows[0]?.max_seq;
    return maxSeq == null ? 1 : Number(maxSeq) + 1;
  }

  async updateContent(id: string, content: MessageContent): Promise<boolean> {
    // JSON.stringify 下沉到 repository（消除 service 层序列化的不一致编码点；
    // 压缩编码与 insert 同一收口）。
    const encoded = encodeMessageContent(JSON.stringify(content));
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE chat_message
       SET content_json = '', content_encoding = #{encoding}, content_blob = #{blob}
       WHERE id = #{id}`,
      { id, encoding: encoded.encoding, blob: encoded.blob }
    );
    return result.changes > 0;
  }

  async insert(message: ChatMessage): Promise<void> {
    await this.conn.execute(MESSAGE_INSERT_SQL, toMessageParams(message));
  }

  async batchInsert(messages: readonly ChatMessage[]): Promise<void> {
    // 空数组直接返回，避免驱动对空 parametersList 的行为分歧，
    // 也让 fork/copy 在源会话无消息时不用特殊判断。
    if (messages.length === 0) {
      return;
    }
    await this.conn.batch(
      MESSAGE_INSERT_SQL,
      messages.map((m) => toMessageParams(m))
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM chat_message WHERE id = #{id}`,
      { id }
    );
    return result.changes > 0;
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM chat_message WHERE session_id = #{sessionId}`,
      { sessionId }
    );
  }

  async deleteAfterSeq(sessionId: string, afterSeq: number): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM chat_message WHERE session_id = #{sessionId} AND seq > #{afterSeq}`,
      { sessionId, afterSeq }
    );
  }

  async listIdsAfterSeq(
    sessionId: string,
    afterSeq: number
  ): Promise<string[]> {
    const rows = await queryTemplate<{ id: string }>(
      this.conn,
      this.parser,
      `SELECT id FROM chat_message
       WHERE session_id = #{sessionId} AND seq > #{afterSeq}`,
      { sessionId, afterSeq }
    );
    return rows.map((row) => String(row.id));
  }

  async updateHidden(messageId: string, hidden: boolean): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE chat_message SET hidden = #{hidden} WHERE id = #{id}`,
      { id: messageId, hidden: hidden ? 1 : 0 }
    );
    return result.changes > 0;
  }

  async updateHiddenRange(
    sessionId: string,
    fromSeq: number,
    toSeq: number,
    hidden: boolean
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
      { sessionId, fromSeq, toSeq, hidden: hidden ? 1 : 0 }
    );
    return result.changes;
  }

  async searchMessages(
    sessionId: string,
    query: MessageSearchQuery
  ): Promise<ChatMessage[]> {
    // 正文压缩存储后 content_json 恒为空串，SQL LIKE 粗筛失效——改为
    // 全量拉取 + 内存精筛（messageMatchesKeyword 与 service 层同一匹配）。
    // 旧 LIKE 只是超集预筛（且会漏 thinking/tool_result 块含关键词的场景
    // 反被 role 粗筛误杀），新实现按 TextBlock 精确匹配，召回语义严格
    // 不小于现状；大会话搜索多付解压成本，与 listBySession 全量路径同量级。
    const keyword = query.keyword?.trim() ?? "";
    const hasKeyword = keyword.length > 0;
    const clampedLimit = Math.max(1, Math.floor(query.limit));
    // keyword 非空：SQL 不 LIMIT——先精筛后截断（旧实现 SQL 先 LIMIT 再由
    // service 精筛，命中数可能不足 limit；新语义一次给满）。
    // keyword 为空：不做关键词/role 过滤，SQL 直接 LIMIT（与旧口径一致）。
    const limitClause = hasKeyword ? "" : "LIMIT #{limit}";
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM chat_message
       WHERE session_id = #{sessionId}
         AND (#{beforeSeq} IS NULL OR seq < #{beforeSeq})
         AND (#{fromSeq} IS NULL OR seq >= #{fromSeq})
         AND (#{toSeq} IS NULL OR seq <= #{toSeq})
       ORDER BY seq DESC
       ${limitClause}`,
      {
        sessionId,
        beforeSeq: query.beforeSeq ?? null,
        fromSeq: query.fromSeq ?? null,
        toSeq: query.toSeq ?? null,
        limit: clampedLimit,
      }
    );
    if (!hasKeyword) {
      return rows.map(rowToMessage);
    }
    const messages = rows.map(rowToMessage);
    return messages
      .filter((msg) => messageMatchesKeyword(msg, keyword))
      .slice(0, clampedLimit);
  }
}
