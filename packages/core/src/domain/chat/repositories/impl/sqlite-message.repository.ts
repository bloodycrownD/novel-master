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
import type { ChatMessage, ChatMessageHeader } from "../../model/message.js";
import type { MessageContent } from "../../model/content-block.js";
import type { MessageUsage } from "../../model/message-usage.js";
import {
  decodeMessageContent,
  encodeMessageContent,
} from "../../logic/message-content-codec.js";
import { countToolUseBlocks } from "../../logic/tool-use-count.js";
import type { MessageRepository } from "../message.port.js";

const MESSAGE_SELECT_COLUMNS = `id, session_id, seq, role, content_json, content_encoding, content_blob, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms`;

/**
 * chat_message 的 INSERT 语句（`?` 占位），insert 与 batchInsert 共用。
 *
 * 列顺序与 {@link toMessageParams} 的参数顺序一一对应，改一处必须同步另一处。
 */
const MESSAGE_INSERT_SQL =
  `INSERT INTO chat_message ` +
  `(id, session_id, seq, role, content_json, content_encoding, content_blob, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms, tool_use_count) ` +
  `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * 把 ChatMessage 摊平成与 {@link MESSAGE_INSERT_SQL} 列顺序对齐的参数数组。
 *
 * insert 走 executeTemplate 时由 SqlTemplateParser 按 `#{xxx}` 出现顺序收集参数，
 * 这里手写数组必须保持同一顺序——两边的列/`?`/参数三者完全对齐。
 *
 * 消息正文压缩：content_json 置空串 ''（NOT NULL 约束自然满足，blocks JSON
 * 恒非空串，'' 无歧义），正文走 content_encoding/content_blob 压缩两列
 * （编码收口在 {@link encodeMessageContent}，三端零感知）。
 *
 * tool_use_count 恒写非 NULL（无 tool_use 块记 0）：新行不走存量回填，
 * 读侧 SUM 无需兜底。NULL 只属于 v18 补列前的存量行。
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
    countToolUseBlocks(message.content),
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
  private readonly conn: TdbcConnection;
  private readonly yieldFn: (() => Promise<void>) | undefined;

  /**
   * 行解析分片大小：每片至多解析 50 行（两条 chat 消息 ≈ 一次屏幕页），
   * 片间让步一次——让步次数 O(行数/50)，解析粒度又足够细不至于一次让
   * 步间累积过长。
   */
  private static readonly ROW_PARSE_CHUNK = 50;

  /**
   * batchInsert 参数构造分片大小：每片至多构造 200 条（toMessageParams 内
   * 含 encodeMessageContent 同步压缩），片间让步一次——fork/copy 大会话
   * 时压缩成本按片摊开，不长时间占住 JS 线程。
   */
  private static readonly BATCH_BUILD_CHUNK = 200;

  /**
   * @param conn - 数据库连接。
   * @param yieldFn - 列表行解析（rowToMessage 含 content_json JSON.parse）的
   *   片间让步函数（rollback-large-jank Step 2）：缺省不传 → 直通同步 map，
   *   与现状逐字节等价（desktop/cli/测试零影响）；传入 → 行解析按片（每片
   *   ≤{@link ROW_PARSE_CHUNK} 行）执行、片间 await 让步，防大结果集把
   *   JS 线程变成单个长任务。core 只声明函数类型，由装配方注入具体实现
   *   （mobile 传 createQuantumYield(16)），不反向依赖 RN 模块。
   */
  constructor(conn: TdbcConnection, yieldFn?: () => Promise<void>) {
    this.conn = conn;
    this.yieldFn = yieldFn;
  }

  /** rows → ChatMessage 列表转换：无 yieldFn 直通同步 map，有则分片让步。 */
  private async mapRows(rows: Row[]): Promise<ChatMessage[]> {
    if (this.yieldFn == null) {
      return rows.map(rowToMessage);
    }
    const messages: ChatMessage[] = [];
    // 注意：分片步长是类静态常量，须以类名引用（this 上取不到 static
    // 成员——实例方法里 this.ROW_PARSE_CHUNK 运行时是 undefined，会让
    // start += undefined 变 NaN 而静默返回空数组）。
    const chunkSize = SqliteMessageRepository.ROW_PARSE_CHUNK;
    for (let start = 0; start < rows.length; start += chunkSize) {
      const end = Math.min(start + chunkSize, rows.length);
      for (let i = start; i < end; i++) {
        messages.push(rowToMessage(rows[i]!));
      }
      if (end < rows.length) {
        await this.yieldFn();
      }
    }
    return messages;
  }

  async listBySession(
    sessionId: string,
    options?: { includeHidden?: boolean }
  ): Promise<ChatMessage[]> {
    // includeHidden=false 在 SQL 层就滤掉 hidden 行：隐藏消息（压缩/置位产
    // 物）不必捞回并逐条解压正文——大会话（数千条、hidden 占多数）的 UI
    // 读口（token chip 的 prompt 组装只消费可见历史）曾因此全量解压秒级卡顿。
    const hiddenFilter =
      options?.includeHidden === false ? " AND hidden = 0" : "";
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM chat_message WHERE session_id = #{sessionId}${hiddenFilter} ORDER BY seq ASC`,
      { sessionId }
    );
    return this.mapRows(rows);
  }

  async listBySessionFromSeq(
    sessionId: string,
    fromSeq: number
  ): Promise<ChatMessage[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM chat_message
       WHERE session_id = #{sessionId} AND seq >= #{fromSeq}
       ORDER BY seq ASC`,
      { sessionId, fromSeq }
    );
    return this.mapRows(rows);
  }

  async listMessageHeadersBySession(
    sessionId: string
  ): Promise<ChatMessageHeader[]> {
    // 头投影：只取 id/seq/role/hidden/created_at_ms——不选 content 列即不解压
    // 正文（压缩/置位等区间逻辑在大会话上曾是秒级全量解压的主源之一）。
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, session_id, seq, role, hidden, created_at_ms
       FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC`,
      { sessionId }
    );
    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      seq: Number(row.seq),
      role: String(row.role),
      hidden: Number(row.hidden) === 1,
      createdAtMs: Number(row.created_at_ms),
    }));
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
    return this.mapRows(rows);
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
    return this.mapRows(rows);
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
    return this.mapRows(rows);
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
    // 压缩编码与 insert 同一收口）。tool_use_count 随正文重写同步重算——
    // 编辑可能增删 tool_use 块（列口径是「本行当前 blocks 的块数」）。
    const encoded = encodeMessageContent(JSON.stringify(content));
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE chat_message
       SET content_json = '', content_encoding = #{encoding}, content_blob = #{blob},
           tool_use_count = #{toolUseCount}
       WHERE id = #{id}`,
      { id, encoding: encoded.encoding, blob: encoded.blob, toolUseCount: countToolUseBlocks(content) }
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
    // 参数构造阶段分片（ic-30）：toMessageParams 内逐条 encodeMessageContent
    // 同步压缩，5000+ 条一次性构造会把主线程压成单个长任务。200 条一片、
    // 片间 await this.yieldFn?.() 让步；无 yieldFn 时（desktop/cli/测试缺省）
    // 让步退化成 await undefined，构造仍是同步一次完成，行为与现状一致。
    // 让步函数与 mapRows 共用同一个（构造器注入），两端装配只注入一处即可。
    const chunkSize = SqliteMessageRepository.BATCH_BUILD_CHUNK;
    const parameters: unknown[][] = [];
    for (let start = 0; start < messages.length; start += chunkSize) {
      const end = Math.min(start + chunkSize, messages.length);
      for (let i = start; i < end; i++) {
        parameters.push(toMessageParams(messages[i]!));
      }
      if (end < messages.length) {
        await this.yieldFn?.();
      }
    }
    await this.conn.batch(MESSAGE_INSERT_SQL, parameters);
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
    // 拉取 + 内存精筛（messageMatchesKeyword 与 service 层同一匹配）。
    // 旧 LIKE 只是超集预筛（且会漏 thinking/tool_result 块含关键词的场景
    // 反被 role 粗筛误杀），新实现按 TextBlock 精确匹配，召回语义严格
    // 不小于现状；大会话搜索多付解压成本，与 listBySession 全量路径同量级。
    const keyword = query.keyword?.trim() ?? "";
    const hasKeyword = keyword.length > 0;
    const clampedLimit = Math.max(1, Math.floor(query.limit));
    if (!hasKeyword) {
      // keyword 为空：不做关键词/role 过滤，SQL 直接 LIMIT（与旧口径一致）。
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
         LIMIT #{limit}`,
        {
          sessionId,
          beforeSeq: query.beforeSeq ?? null,
          fromSeq: query.fromSeq ?? null,
          toSeq: query.toSeq ?? null,
          limit: clampedLimit,
        }
      );
      return this.mapRows(rows);
    }
    // keyword 非空：SQL 加扫描上限（ic-08 方案 A）——scanLimit = max(limit*20, 200)，
    // 按 seq DESC keyset 续扫（AND seq < 游标），本段命中不足 limit 且本段拉满
    // scanLimit 行（可能还有剩余）时继续下一段，直到凑满 limit 或本段返回行数
    // 小于 scanLimit（SQLite LIMIT 语义保证此时已无剩余行）。
    // 语义红线：召回不得小于全量精筛——只有「凑满 limit」或「扫完全部行」
    // 两个出口，绝不在中途放弃续扫，返回结果恒为「最新的 limit 条命中」。
    const scanLimit = Math.max(clampedLimit * 20, 200);
    const matched: ChatMessage[] = [];
    // 游标初值即 beforeSeq（seq < beforeSeq 的翻页口径原样保留在第一段），
    // 后续段游标 = 上一段最小 seq（严格递减，恒不构成死循环）。
    let cursor: number | null = query.beforeSeq ?? null;
    for (;;) {
      const rows = await queryTemplate(
        this.conn,
        this.parser,
        `SELECT ${MESSAGE_SELECT_COLUMNS}
         FROM chat_message
         WHERE session_id = #{sessionId}
           AND (#{cursor} IS NULL OR seq < #{cursor})
           AND (#{fromSeq} IS NULL OR seq >= #{fromSeq})
           AND (#{toSeq} IS NULL OR seq <= #{toSeq})
         ORDER BY seq DESC
         LIMIT #{scanLimit}`,
        {
          sessionId,
          cursor,
          fromSeq: query.fromSeq ?? null,
          toSeq: query.toSeq ?? null,
          scanLimit,
        }
      );
      if (rows.length === 0) {
        break;
      }
      // mcdev 的内存精筛语义 + main 的分片映射（mapRows 分批让步，大会话
      // 搜索不长时间占住 JS 线程）——两条改动的并集；按段拉取后每段独立
      // 精筛，命中按 seq DESC 顺序累计。
      const messages = await this.mapRows(rows);
      for (const msg of messages) {
        if (messageMatchesKeyword(msg, keyword)) {
          matched.push(msg);
        }
      }
      if (matched.length >= clampedLimit) {
        break;
      }
      if (rows.length < scanLimit) {
        // 本段未拉满 scanLimit：剩余行已扫尽，允许返回不足 limit 的结果。
        break;
      }
      // keyset 续扫：下一段从本段最小 seq 之前继续（seq DESC 排序下末行最小）。
      cursor = Number(rows[rows.length - 1]!.seq);
    }
    return matched.slice(0, clampedLimit);
  }
}
