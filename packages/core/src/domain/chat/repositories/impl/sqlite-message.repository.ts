/**
 * SQLite chat message repository.
 *
 * @module domain/chat/repositories/impl/sqlite-message.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { TdbcError } from "@/infra/tdbc/errors.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { parseMessageContent } from "../../content/parse-message-content.js";
import {
  parseAttachmentsJson,
  serializeAttachmentsJson,
} from "../../model/message-attachment.schema.js";
import type { ChatMessage, ChatMessageHeader } from "../../model/message.js";
import type { MessageContent } from "../../model/content-block.js";
import type { MessageUsage } from "../../model/message-usage.js";
import { decodeMessageContent } from "../../logic/message-content-codec.js";
import { collectReadRefs } from "@/domain/vfs/logic/revision-ref-count.js";
import type {
  MessageReadRefTarget,
  MessageRepository,
} from "../message.port.js";

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
 * 消息正文明文化（2026-09-30 拍板的全库明文决策）：content_json 直存
 * blocks JSON 明文，content_encoding/content_blob 显式绑 NULL。两列名保留
 * 在 INSERT 列清单里（列不删，schema CHECK 约束原样），只是新行恒为空——
 * 读路径的双形态判定（{@link readRowContent} 的 blob 分支）在此期间为存量
 * 压缩行服务，明文行为唯一正形态。
 */
function toMessageParams(message: ChatMessage): unknown[] {
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

/**
 * 无外层事务时开一个事务跑 `fn`；已经身处事务中则直接复用 `conn` 跑。
 *
 * 惯例来源：`service/vfs/impl/revision-aware-vfs.service.ts` 的同名模块私有
 * 函数（那里未导出，这里按同一形状复制一份，避免 domain 层反向依赖 service 层）。
 *
 * 边界（务必保留，别"顺手"改成 try/finally 或吞错）：这个兜底**只**针对
 * `conn.transaction()` 入口抛出的 `NESTED_TRANSACTION`——三驱动契约里 tx 句柄的
 * `transaction()` 无条件 reject 且**不执行** `fn`（connection.port.ts:37），
 * 所以捕获后用 `fn(conn)` 直通是等价且安全的。若 `fn` 内部自己抛出同码错误，
 * 会被误判成「已在事务内」而重跑一遍，已执行的写操作将被重放。
 */
async function runInTransactionOrConn<T>(
  conn: TdbcConnection,
  fn: (tx: TdbcConnection) => Promise<T>
): Promise<T> {
  try {
    return await conn.transaction(fn);
  } catch (error) {
    if (error instanceof TdbcError && error.code === "NESTED_TRANSACTION") {
      return fn(conn);
    }
    throw error;
  }
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
  // 明文行是唯一正形态（2026-09-30 起写侧直写明文）：新写行、以及被反向
  // 搬运任务解压回明文的存量行都走这里。压缩行仅在反向搬运收敛前共存。
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
    // includeHidden=false 在 SQL 层就滤掉 hidden 行：置位产物不必捞回——
    // 大会话（数千条、hidden 占多数）的 UI 读口（token chip 的 prompt 组装
    // 只消费可见历史）因此不必把不可见行的正文字节取回来。
    // 正文读取本身按形态分派（见 readRowContent）：明文行 parse
    // content_json，压缩行才需解压——迁移期压缩行与明文行共存时，不做这层
    // 过滤就得为不可见的压缩行逐条解压。
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

  async listBySessionUpToSeq(
    sessionId: string,
    maxSeq: number
  ): Promise<ChatMessage[]> {
    // 与 listBySessionFromSeq 对称：这边收上界。SQL 里**只**加 seq 上界，
    // 不加 AND hidden = 0（fork 要保留 hidden 状态）。
    // 走 mapRows 保住 yieldFn 分片让步（mobile 上大结果集退化成单次长任务）。
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM chat_message
       WHERE session_id = #{sessionId} AND seq <= #{maxSeq}
       ORDER BY seq ASC`,
      { sessionId, maxSeq }
    );
    return this.mapRows(rows);
  }

  async listBySessionTailOfRole(
    sessionId: string,
    role: string,
    limit: number
  ): Promise<ChatMessage[]> {
    // role 在子查询里过滤：limit 只数该 role 的行，夹在中间的 tool_result
    // （role=user）不占配额。外层再包一层 ORDER BY seq ASC 保持升序返回。
    const clampedLimit = Math.max(1, Math.floor(limit));
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM (
         SELECT ${MESSAGE_SELECT_COLUMNS}
         FROM chat_message
         WHERE session_id = #{sessionId} AND role = #{role}
         ORDER BY seq DESC
         LIMIT #{limit}
       )
       ORDER BY seq ASC`,
      { sessionId, role, limit: clampedLimit }
    );
    return this.mapRows(rows);
  }

  async listReadRefTargetsBySession(
    sessionId: string
  ): Promise<readonly MessageReadRefTarget[]> {
    // 窄投影（21 → 4 列）：只取 id + 正文三列。**不过滤 hidden**
    // （hidden 行也要出现在 targets 里，否则漏减 read 引用 = revision 永不 GC）。
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, content_json, content_encoding, content_blob
       FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC`,
      { sessionId }
    );
    // ⚠️ **本方法刻意不走 `mapRows`**（下面这个裸 for 循环）：它是在**写事务内**
    // 被调用的（`message.service.ts:truncateAfter` 的空锚分支 / `session.service.ts`
    // 的 deleteSessionTree / `project.service.ts` 的删项目链）。`mapRows` 的分片
    // `yieldFn` 只在「让出事件循环」时有用——对锁持有期**零帮助**，反倒会在事务
    // 中间插入 await，把本该是一段的临界区切成若干段，让等锁的写方有机会插队。
    // 这里的收益是**列数**（21 → 4）与**消除事务外的一次全量往返**，不是并发度。
    // ⚠️ 因此本方法的 `JSON.parse` 成本是落在写事务持有期内的，这是 C1-2 换窄读口
    //    时已知的代价（不是本轮新增）。要真正缩短这个窗口得重划「产出写集合的读」
    //    与「写」之间的边界，那与 c2 域「产出写集合的读必须留在事务内」的判据
    //    直接冲突，已登记为债务（CR cr1-c1 P2-1 修法 b），本波不做。
    const targets: MessageReadRefTarget[] = [];
    for (const row of rows) {
      try {
        // 直接调用本文件既有的模块私有 readRowContent（双形态解码），
        // 不新写一份解码分支。
        targets.push({
          id: String(row.id),
          refs: collectReadRefs(readRowContent(row)),
        });
      } catch (err) {
        // 坏行按「空 refs」处理并 warn——与 aggregateReadRefsFromAllMessages 的
        // 坏行隔离口径一致（一条坏行不拖累其它行；这是有意的降级：旧形态
        // listBySession 对坏行 fail-fast，会让整条清空/删除失败）。
        console.warn(
          "[sqlite-message] read_ref_target_row_skip：消息行解析失败，其 read 引用不参与 −1",
          { id: String(row.id), err: err instanceof Error ? err.message : err }
        );
        targets.push({ id: String(row.id), refs: [] });
      }
    }
    return targets;
  }

  async listMessageHeadersBySession(
    sessionId: string
  ): Promise<ChatMessageHeader[]> {
    // 头投影：只取 id/seq/role/hidden/created_at_ms——不选 content 列即不取
    // 正文字节（新行本就是明文、存量行才需解压；不选列让两者都零成本，
    // 大会话上这曾是秒级全量解压的主源之一）。
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
  ): Promise<ChatMessageHeader[]> {
    // 头投影：唯一调用方（backfill 增量段判定）只消费 `id`，不取正文字节。
    // 原先按 21 列全量取并逐条 JSON.parse——会话导入 / 复制 / 首次回填时
    // offset 可能是 0 或很旧，一次调用就把全会话正文拉回来了。
    const clampedOffset = Math.max(0, Math.floor(offset));
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, session_id, seq, role, hidden, created_at_ms
       FROM chat_message
       WHERE session_id = #{sessionId}
       ORDER BY seq ASC
       LIMIT -1 OFFSET #{offset}`,
      { sessionId, offset: clampedOffset }
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
    // JSON.stringify 下沉到 repository（消除 service 层序列化的不一致编码点）。
    //
    // P0 约束——三列必须齐置：content_json 写新明文的同时，content_encoding
    // 与 content_blob 一起置 NULL。编辑一条存量压缩行时若只写 content_json，
    // 读路径 readRowContent 的「blob 非空优先」分支仍会解压出**旧正文**：
    // 不崩溃、不报错，只是静默返回错内容（数据错乱，比崩溃更难发现）。
    // 反例由 test/chat/message-plaintext-write.test.ts 的 T-MP1 锁死。
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE chat_message
       SET content_json = #{json}, content_encoding = NULL, content_blob = NULL
       WHERE id = #{id}`,
      { id, json: JSON.stringify(content) }
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
}
