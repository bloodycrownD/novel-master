/**
 * SQLite chat message repository.
 *
 * @module domain/chat/repositories/impl/sqlite-message.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { executeTemplate, queryTemplate } from "@/infra/tdbc/logic/template-helper.js";
import { runInTransactionOrConn } from "@/infra/tdbc/index.js";
import type { Row } from "@/infra/tdbc/types.js";
import { nullableText } from "@/common/coerce.js";
import { AppError } from "@/errors/app-error.js";
import { parseMessageContent } from "../../content/parse-message-content.js";
import { parseAttachmentsJson } from "../../model/message-attachment.schema.js";
import type { ChatMessageData, ChatMessageHeader } from "../../model/message.js";
import { ChatMessage } from "../../logic/message/chat-message.js";
import type { MessageContent } from "../../model/content-block.js";
import type { MessageUsage } from "../../model/message-usage.js";
import type { MessageRepository } from "../message.port.js";
import { BaseSqliteChatRepository } from "./base-sqlite-chat-repository.js";

const MESSAGE_SELECT_COLUMNS = `id, session_id, seq, role, content_json, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms`;

const MESSAGE_HEADER_COLUMNS = "id, session_id, seq, role, hidden, created_at_ms";

/**
 * chat_message 的 INSERT 列清单，insert 与 batchInsert 共用。
 *
 * 比读投影多出 content_encoding / content_blob 两个存量兼容列（写侧恒绑
 * NULL）。列顺序与 {@link toMessageParams} 的参数顺序一一对应，改一处必须同步
 * 另一处。
 */
const MESSAGE_INSERT_COLUMNS = "id, session_id, seq, role, content_json, content_encoding, content_blob, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms";

const MESSAGE_INSERT_SQL = `INSERT INTO chat_message (${MESSAGE_INSERT_COLUMNS}) VALUES (${MESSAGE_INSERT_COLUMNS.split(", ").map(() => "?").join(", ")})`;

/**
 * 把 ChatMessageData 摊平成与 {@link MESSAGE_INSERT_COLUMNS} 列顺序对齐的参数数组。
 *
 * 消息正文只写明文一种形态：content_json 直存 blocks JSON，content_encoding /
 * content_blob 两列保留在 INSERT 列清单里但恒绑 NULL（读路径只认 content_json）。
 */
function toMessageParams(message: ChatMessageData): unknown[] {
  const attachmentsJson = message.attachments == null || message.attachments.length === 0 ? null : JSON.stringify(message.attachments);
  return [
    message.id,
    message.sessionId,
    message.seq,
    message.role,
    JSON.stringify(message.content),
    null,
    null,
    message.provider,
    message.providerId ?? null,
    message.raw == null ? null : JSON.stringify(message.raw),
    message.createdAtMs,
    // Convert boolean to integer: true = 1, false = 0
    message.hidden ? 1 : 0,
    attachmentsJson,
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

/** 存储行损坏：把底层解析失败收成可区分的 `CHAT_MESSAGE_CORRUPT`。 */
function corruptMessageRow(row: Row, field: string, cause: unknown): AppError<"CHAT_MESSAGE_CORRUPT"> {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new AppError("CHAT_MESSAGE_CORRUPT", `chat_message ${String(row.id)} ${field} 损坏：${detail}`, { messageId: String(row.id), field });
}

function rowToMessage(row: Row): ChatMessage {
  // 正文只有明文一种形态：content_json 直接 parse；解析失败按 repository 边界抛。
  const content = parseMessageContent(String(row.content_json));
  if (!content.ok) {
    throw corruptMessageRow(row, "content_json", content.error);
  }
  const attachments = parseAttachmentsJson(nullableText(row.attachments_json));
  // usage 列全空时保持「无 usage 属性」形状（条件 spread 保证空对象没有 key）。
  const usageFields: MessageUsage = {
    ...(row.prompt_tokens != null ? { promptTokens: Number(row.prompt_tokens) } : {}),
    ...(row.completion_tokens != null ? { completionTokens: Number(row.completion_tokens) } : {}),
    ...(row.total_tokens != null ? { totalTokens: Number(row.total_tokens) } : {}),
    ...(row.cache_read_tokens != null ? { cacheReadTokens: Number(row.cache_read_tokens) } : {}),
    ...(row.cache_creation_tokens != null ? { cacheCreationTokens: Number(row.cache_creation_tokens) } : {}),
    ...(row.first_token_ms != null ? { firstTokenMs: Number(row.first_token_ms) } : {}),
    ...(row.duration_ms != null ? { durationMs: Number(row.duration_ms) } : {}),
  };
  const usage: MessageUsage | undefined = Object.keys(usageFields).length > 0 ? usageFields : undefined;
  let raw: Record<string, unknown> | null = null;
  if (row.raw_json != null) {
    try {
      raw = JSON.parse(String(row.raw_json)) as Record<string, unknown>;
    } catch (error) {
      throw corruptMessageRow(row, "raw_json", error);
    }
  }
  return ChatMessage.from({
    id: String(row.id),
    sessionId: String(row.session_id),
    seq: Number(row.seq),
    role: String(row.role),
    content: content.value,
    provider: nullableText(row.provider),
    providerId: nullableText(row.provider_id),
    modelName: nullableText(row.model_name),
    raw,
    createdAtMs: Number(row.created_at_ms),
    hidden: Number(row.hidden) === 1,
    ...(attachments != null ? { attachments } : {}),
    ...(usage != null ? { usage } : {}),
  });
}

function rowToHeader(row: Row): ChatMessageHeader {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    seq: Number(row.seq),
    role: String(row.role),
    hidden: Number(row.hidden) === 1,
    createdAtMs: Number(row.created_at_ms),
  };
}

/** TDBC-backed `chat_message` repository. */
export class SqliteMessageRepository extends BaseSqliteChatRepository<ChatMessageData> implements MessageRepository {
  private readonly yieldFn: (() => Promise<void>) | undefined;

  /**
   * 行解析分片大小：每片至多解析 50 行（两条 chat 消息 ≈ 一次屏幕页），
   * 片间让步一次——让步次数 O(行数/50)，解析粒度又足够细不至于一次让
   * 步间累积过长。
   */
  private static readonly ROW_PARSE_CHUNK = 50;

  /**
   * batchInsert 分片大小：每片至多 200 条，参数**按片构造**、SQL **按片下发**。
   *
   * 明文化后 toMessageParams 已无同步压缩，但 JSON.stringify 本身仍是同步重活，
   * 且参数数组里驻留的是明文 JSON（fork/copy 是全会话，2-3× 于压缩 blob，见
   * 消费处矩阵 #7）。按片构造 + 按片下发后，峰值内存从「全会话 ×1」降为
   * O(片大小)——构造与下发都不再堆成单个长任务。
   *
   * chunk 按下标区间切分 messages（`slice` 只复制引用数组，不复制消息体）。
   */
  private static readonly BATCH_PARAM_BUILD_CHUNK = 200;

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
    super(conn, {
      table: "chat_message",
      columns: MESSAGE_SELECT_COLUMNS,
      insertSql: MESSAGE_INSERT_SQL,
      entityFromRow: rowToMessage,
      insertParams: toMessageParams,
    });
    this.yieldFn = yieldFn;
  }

  /** rows → ChatMessageData 列表转换：无 yieldFn 直通同步 map，有则分片让步。 */
  private async mapRows(rows: Row[]): Promise<ChatMessageData[]> {
    if (this.yieldFn == null) {
      return rows.map(rowToMessage);
    }
    const messages: ChatMessageData[] = [];
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

  async listBySession(sessionId: string, options?: { includeHidden?: boolean }): Promise<ChatMessageData[]> {
    // includeHidden=false 在 SQL 层就滤掉 hidden 行：置位产物不必捞回——
    // 大会话（数千条、hidden 占多数）的 UI 读口（token chip 的 prompt 组装
    // 只消费可见历史）因此不必把不可见行的正文字节取回来，也省掉逐行
    // parse content_json（读路径只有明文一种形态）。
    const hiddenFilter = options?.includeHidden === false ? " AND hidden = 0" : "";
    const sql = `SELECT ${MESSAGE_SELECT_COLUMNS} FROM chat_message WHERE session_id = #{sessionId}${hiddenFilter} ORDER BY seq ASC`;
    const rows = await queryTemplate(this.conn, this.parser, sql, { sessionId });
    return this.mapRows(rows);
  }

  async listBySessionFromSeq(sessionId: string, fromSeq: number): Promise<ChatMessageData[]> {
    const sql = `SELECT ${MESSAGE_SELECT_COLUMNS} FROM chat_message WHERE session_id = #{sessionId} AND seq >= #{fromSeq} ORDER BY seq ASC`;
    const rows = await queryTemplate(this.conn, this.parser, sql, { sessionId, fromSeq });
    return this.mapRows(rows);
  }

  /** nm-style: keep-public — MessageRepository 端口读口；message.service 的 fork 单点消费。 */
  async listBySessionUpToSeq(sessionId: string, maxSeq: number): Promise<ChatMessageData[]> {
    // 与 listBySessionFromSeq 对称：这边收上界。SQL 里**只**加 seq 上界，
    // 不加 AND hidden = 0（fork 要保留 hidden 状态）。
    // 走 mapRows 保住 yieldFn 分片让步（mobile 上大结果集退化成单次长任务）。
    const sql = `SELECT ${MESSAGE_SELECT_COLUMNS} FROM chat_message WHERE session_id = #{sessionId} AND seq <= #{maxSeq} ORDER BY seq ASC`;
    const rows = await queryTemplate(this.conn, this.parser, sql, { sessionId, maxSeq });
    return this.mapRows(rows);
  }

  async listBySessionTailOfRole(sessionId: string, role: string, limit: number): Promise<ChatMessageData[]> {
    // role 在子查询里过滤：limit 只数该 role 的行，夹在中间的 tool_result
    // （role=user）不占配额。外层再包一层 ORDER BY seq ASC 保持升序返回。
    const clampedLimit = Math.max(1, Math.floor(limit));
    const sql = `SELECT ${MESSAGE_SELECT_COLUMNS} FROM (SELECT ${MESSAGE_SELECT_COLUMNS} FROM chat_message WHERE session_id = #{sessionId} AND role = #{role} ORDER BY seq DESC LIMIT #{limit}) ORDER BY seq ASC`;
    const rows = await queryTemplate(this.conn, this.parser, sql, { sessionId, role, limit: clampedLimit });
    return this.mapRows(rows);
  }

  /** nm-style: keep-public — MessageRepository 端口读口；message.service 的 truncateAfter 空锚分支消费。 */
  async listIdsBySession(sessionId: string): Promise<readonly string[]> {
    // 单列窄投影（19 → 1 列）：只取 id，零 parse。**不过滤 hidden**
    // （hidden 行也要在列，否则漏删 checkpoint = 孤儿行）。
    // 读口原为 listReadRefTargetsBySession（id + read 引用指针双素材）——
    // read 引用机制随 E1 清理版退役后（v1.5.40 同批）refs 消费方全灭，
    // 收窄为 id 单素材；写事务内被调用的性质不变（message.service.ts 的
    // truncateAfter 空锚分支），仍刻意不走 mapRows 的分片 yieldFn。
    const sql = "SELECT id FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC";
    const rows = await queryTemplate(this.conn, this.parser, sql, { sessionId });
    return rows.map((row) => String(row.id));
  }

  async listMessageHeadersBySession(sessionId: string): Promise<ChatMessageHeader[]> {
    // 头投影：只取 id/seq/role/hidden/created_at_ms——不选 content 列即不取
    // 正文字节（读路径只有明文一种形态，不选列连 parse 都省；大会话上这曾是
    // 秒级全量 parse 的主源之一）。
    const sql = `SELECT ${MESSAGE_HEADER_COLUMNS} FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC`;
    const rows = await queryTemplate(this.conn, this.parser, sql, { sessionId });
    return rows.map(rowToHeader);
  }

  async countBySession(sessionId: string): Promise<number> {
    const sql = "SELECT COUNT(*) AS n FROM chat_message WHERE session_id = #{sessionId}";
    const rows = await queryTemplate<{ n: number }>(this.conn, this.parser, sql, { sessionId });
    // COUNT(*) 恒返回一行；SQLite 下 COUNT 结果是 INTEGER，Number() 安全。
    return Number(rows[0]!.n);
  }

  /** nm-style: keep-public — MessageRepository 端口读口；decideBackfillShortCircuit 单点消费。 */
  async listBySessionOffset(sessionId: string, offset: number): Promise<ChatMessageHeader[]> {
    // 头投影：唯一调用方 decideBackfillShortCircuit（backfill 增量段判定）只消费 `id`，
    // 不取正文字节。原先按 19 列全量取并逐条 JSON.parse——会话导入 / 复制 /
    // 首次回填时 offset 可能是 0 或很旧，一次调用就把全会话正文拉回来了。
    const clampedOffset = Math.max(0, Math.floor(offset));
    const sql = `SELECT ${MESSAGE_HEADER_COLUMNS} FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC LIMIT -1 OFFSET #{offset}`;
    const rows = await queryTemplate(this.conn, this.parser, sql, { sessionId, offset: clampedOffset });
    return rows.map(rowToHeader);
  }

  async listBySessionTail(sessionId: string, limit: number): Promise<ChatMessageData[]> {
    const clampedLimit = Math.max(1, Math.floor(limit));
    const sql = `SELECT ${MESSAGE_SELECT_COLUMNS} FROM (SELECT ${MESSAGE_SELECT_COLUMNS} FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq DESC LIMIT #{limit}) ORDER BY seq ASC`;
    const rows = await queryTemplate(this.conn, this.parser, sql, { sessionId, limit: clampedLimit });
    return this.mapRows(rows);
  }

  async listBySessionPage(sessionId: string, limit: number, beforeSeq?: number): Promise<ChatMessageData[]> {
    const clampedLimit = Math.max(1, Math.floor(limit));
    const sql = `SELECT ${MESSAGE_SELECT_COLUMNS} FROM (SELECT ${MESSAGE_SELECT_COLUMNS} FROM chat_message WHERE session_id = #{sessionId} AND (#{beforeSeq} IS NULL OR seq < #{beforeSeq}) ORDER BY seq DESC LIMIT #{limit}) ORDER BY seq ASC`;
    const rows = await queryTemplate(this.conn, this.parser, sql, { sessionId, beforeSeq: beforeSeq ?? null, limit: clampedLimit });
    return this.mapRows(rows);
  }

  async nextSeq(sessionId: string): Promise<number> {
    const sql = "SELECT MAX(seq) AS max_seq FROM chat_message WHERE session_id = #{sessionId}";
    const rows = await queryTemplate<{ max_seq: number | null }>(this.conn, this.parser, sql, { sessionId });
    const maxSeq = rows[0]?.max_seq;
    return maxSeq == null ? 1 : Number(maxSeq) + 1;
  }

  async updateContent(id: string, content: MessageContent): Promise<boolean> {
    // JSON.stringify 下沉到 repository（消除 service 层序列化的不一致编码点）。
    //
    // 三列齐置：写新明文 content_json 的同时把 content_encoding / content_blob
    // 一起置 NULL。存量压缩行改写后仍要清掉旧 blob，避免后续迁移 / 人工排查
    // 把同一行看成双形态。反例由 test/chat/message-plaintext-write.test.ts 的
    // T-MP1 锁死。
    const sql = `UPDATE chat_message SET content_json = #{json}, content_encoding = NULL, content_blob = NULL WHERE id = #{id}`;
    const result = await executeTemplate(this.conn, this.parser, sql, { id, json: JSON.stringify(content) });
    return result.changes > 0;
  }

  async batchInsert(messages: readonly ChatMessageData[]): Promise<void> {
    // 空数组直接返回，避免驱动对空 parametersList 的行为分歧，
    // 也让 fork/copy 在源会话无消息时不用特殊判断。
    if (messages.length === 0) {
      return;
    }
    // 参数按片构造、按片下发：峰值内存 O(片大小)。
    // this.conn 可能是根连接（测试直调）也可能是事务句柄（生产 fork/copy 在
    // 外层事务内调 batchInsert：session.service 的 copy、message.service 的
    // fork 都在 conn.transaction(...) 里用 tx 句柄建 repo）——嵌套
    // transaction 抛 NESTED_TRANSACTION，必须运行时判定而非静态假设，故走
    // runInTransactionOrConn（兜底边界见该函数注释：只针对 conn.transaction()
    // 入口抛出的嵌套码，fn 内部若将来自行抛该码会被误判重跑）。
    // 独占窗口不新增：生产路径的连接本就被外层事务独占整段；根连接路径
    // （测试直调）与原先的单次 batch 等价地包一层小事务，原子性不变。
    // 让步语义照旧：mobile 注入 createQuantumYield 时真正让出事件循环，
    // desktop/CLI/测试缺省注入时退化为一次 microtask 让步（与构造器注入的
    // mapRows 共用同一个 yieldFn，装配端只注入一处）。
    const chunkSize = SqliteMessageRepository.BATCH_PARAM_BUILD_CHUNK;
    await runInTransactionOrConn(this.conn, async (c) => {
      for (let start = 0; start < messages.length; start += chunkSize) {
        const end = Math.min(start + chunkSize, messages.length);
        const parameters = messages.slice(start, end).map(toMessageParams);
        await c.batch(MESSAGE_INSERT_SQL, parameters);
        await this.yieldFn?.();
      }
    });
  }

  async deleteBySession(sessionId: string): Promise<void> {
    const sql = "DELETE FROM chat_message WHERE session_id = #{sessionId}";
    await executeTemplate(this.conn, this.parser, sql, { sessionId });
  }

  async deleteAfterSeq(sessionId: string, afterSeq: number): Promise<void> {
    const sql = "DELETE FROM chat_message WHERE session_id = #{sessionId} AND seq > #{afterSeq}";
    await executeTemplate(this.conn, this.parser, sql, { sessionId, afterSeq });
  }

  /** nm-style: keep-public — MessageRepository 端口读口；回滚 tail 截断的 checkpoint 清理消费。 */
  async listIdsAfterSeq(sessionId: string, afterSeq: number): Promise<string[]> {
    const sql = "SELECT id FROM chat_message WHERE session_id = #{sessionId} AND seq > #{afterSeq}";
    const rows = await queryTemplate<{ id: string }>(this.conn, this.parser, sql, { sessionId, afterSeq });
    return rows.map((row) => String(row.id));
  }

  async updateHidden(messageId: string, hidden: boolean): Promise<boolean> {
    const sql = "UPDATE chat_message SET hidden = #{hidden} WHERE id = #{id}";
    const result = await executeTemplate(this.conn, this.parser, sql, { id: messageId, hidden: hidden ? 1 : 0 });
    return result.changes > 0;
  }

  async updateHiddenRange(sessionId: string, fromSeq: number, toSeq: number, hidden: boolean): Promise<number> {
    const hiddenFilter = hidden ? "AND hidden = 0" : "AND hidden = 1";
    const sql = `UPDATE chat_message SET hidden = #{hidden} WHERE session_id = #{sessionId} AND seq >= #{fromSeq} AND seq <= #{toSeq} ${hiddenFilter}`;
    const result = await executeTemplate(this.conn, this.parser, sql, { sessionId, fromSeq, toSeq, hidden: hidden ? 1 : 0 });
    return result.changes;
  }
}
