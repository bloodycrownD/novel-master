/**
 * Chat message repository port.
 *
 * @module domain/chat/repositories/message.port
 */

import type { ChatMessage, ChatMessageHeader } from "../model/message.js";
import type { MessageContent } from "../model/content-block.js";
import type { MessageSearchQuery } from "../content/message-content-match.js";
// 仅取类型（编译后擦除，运行时不成环）：ReadRefPointer 在 vfs 侧定义，
// 这里不重新定义第二份，避免两个模块的 read 引用形状漂移。
import type { ReadRefPointer } from "@/domain/vfs/logic/revision-ref-count.js";

/**
 * 一条消息的「删除链素材」：id + 它的 read 引用指针。
 *
 * 窄投影（21 → 4 列）读口的返回元素：删除链需要的就是这两样东西，
 * 此前只能靠 21 列 `listBySession` 顺带取。
 */
export type MessageReadRefTarget = {
  readonly id: string;
  readonly refs: readonly ReadRefPointer[];
};

/** Persistence for `chat_message` rows. */
export interface MessageRepository {
  /**
   * 按 seq 升序列出会话消息。`includeHidden: false` 在 SQL 层滤掉 hidden
   * 行（默认含 hidden——回滚锚定等既有口径依赖「含隐藏全量」）。
   */
  listBySession(
    sessionId: string,
    options?: { includeHidden?: boolean }
  ): Promise<ChatMessage[]>;

  /**
   * 消息头投影（无正文，不解压 content）：压缩 hide / 置位锚定等只需要
   * id/seq/role/hidden 的区间逻辑专用，大会话上替代全量解压。
   */
  listMessageHeadersBySession(
    sessionId: string
  ): Promise<ChatMessageHeader[]>;

  /**
   * 统计会话消息行数（`SELECT COUNT(*) ... WHERE session_id = ?`）。
   *
   * 乐观锁只需要计数对比，不必把整行捞回内存——用这个替代 `listBySession().length`，
   * 1000 条消息从拉 1000 行退化成拉 1 行。
   */
  countBySession(sessionId: string): Promise<number>;

  // ============================================================
  // 窄读口区 · Wave C「全量读收窄系列」四条
  //
  // 这四条是同一个动作的四次落地：把「本来只需要一小块」的读取从 21 列
  // `listBySession` 上拆下来。**它们相邻排布是有意的护栏**（CR c1 K10）——
  // 下一个人想加第五个全列读口时，会先看见这四条并被提醒「该加窄口，不该加
  // 全列口」。每条都写明了「谁在用、为什么不能用别的」，因为「能不能用现成
  // 的某个口」正是最容易拍错的地方。
  //
  // 新增读口时照这四条的两条纪律来：① 能收窄就别全量；② 收窄的口只服务一个
  // 消费者，出现第二个消费者时**另起一条**，不要把上一条放宽。
  // ============================================================

  /**
   * 按 seq 升序跳过前 `offset` 行，取余下全部消息头（backfill 圈「新增段」用）。
   *
   * `offset` 是行偏移而非 seq 值（seq 可能因删除有洞）；SQLite 方言
   * `LIMIT -1 OFFSET ?` 表示不限条数。消息集只增不减时前 `offset` 行即
   * 上次扫描确认过的消息，返回的就是之后的新增段。
   *
   * @remarks **谁在用**：`backfill-baseline-checkpoints.ts:132`（增量段判定，
   *          只消费 `id`）。
   * @remarks **为什么不能用别的**：不能用 `listMessageHeadersBySession` + 内存
   *          `slice` —— 那会把 offset 之前的消息头也读回来，offset 越大浪费越多；
   *          更不能用 `listBySession` —— 21 列 + 逐行 `JSON.parse` 换一批
   *          根本不需要的 id。21 列 → 6 列、零 parse。
   * @remarks 新增第二个「要正文」的调用方时必须**另起读口**，不要放宽本口。
   */
  listBySessionOffset(
    sessionId: string,
    offset: number
  ): Promise<ChatMessageHeader[]>;

  /**
   * 按 seq 升序列出「seq <= maxSeq（含上界）」的消息（fork 上界收窄用）。
   *
   * fork 消费方的全部读都在锚点及更早方向（`filter(seq <= upTo.seq)`），
   * 锚点之后的整条尾巴是纯浪费——用户在第 3 条消息处 fork 一个 3000 条的
   * 会话时，2997 条正文被读回、逐行 `JSON.parse`、再整条丢掉。
   * 与 {@link listBySessionFromSeq} 对称（那边收下界、这边收上界）。
   *
   * @remarks **谁在用**：`message.service.ts:335`（`fork` 的上界收窄）。
   * @remarks **为什么不能用别的**：不能用 `listBySession` + 内存 `filter`
   *          ——过滤发生在读回**之后**，省不下任何一行；也不能用
   *          `listMessageHeadersBySession`，fork 要的是完整 `ChatMessage`
   *          （含正文内容块）来重建目标会话。
   * @remarks **含 hidden**：本读口只加 `seq` 上界，**不得**加 `AND hidden = 0`
   *          ——fork 明确「Preserve hidden state」，滤掉 hidden 行会让 fork
   *          出来的会话**静默丢消息**。
   */
  listBySessionUpToSeq(sessionId: string, maxSeq: number): Promise<ChatMessage[]>;

  /**
   * tail + role 过滤：取「该 role 的最后 limit 条」（seq 升序返回）。
   *
   * @remarks **谁在用**：`subagent-tool.ts:230`（拿「末条 assistant 的合并文本」）。
   * @remarks **为什么不能用别的**：不能用 `listBySessionTail(sessionId, limit)`
   *          ——它的 `limit` 数的是**所有 role 的行**，夹在 assistant 回合之间的
   *          tool_result（role=user）会吃掉配额；也不能用
   *          `listBySessionTail(sessionId, 1)` 再过滤，assistant 之前最近的那条
   *          多半是 tool_result，直接落空。`role` 必须在 SQL 子查询里过滤、
   *          `limit` 只数该 role，子会话 41 条时也不再整条倒扫。
   */
  listBySessionTailOfRole(
    sessionId: string,
    role: string,
    limit: number
  ): Promise<ChatMessage[]>;

  /**
   * 列出会话内每条消息的 id 与其 read 引用指针（entryId/version），不解压/不解析
   * 正文以外的任何列。删除链（清空会话 / 删会话 / 删项目）需要「id 列表 +
   * read 引用 −1 素材」两样东西，此前只能靠 21 列 `listBySession` 顺带取。
   *
   * @remarks **谁在用**：`message.service.ts:508`（`truncateAfter` 空锚分支）、
   *          `session.service.ts:231`（`deleteSessionTree`）、
   *          `project.service.ts:182`（删项目连带删会话）。
   * @remarks **为什么不能用别的**：不能用 `listBySession` + 内存
   *          `collectReadRefs` ——省不下任何一列，21 列的正文全部读回再丢掉。
   * @remarks ⚠ 不过滤 hidden：本读口产出的是「即将被 deleteBySession 全删」的消息集合，
   *          漏掉 hidden 行 = 漏减 read 引用 = revision 永不 GC（内容不可再生的方向）。
   * @remarks ⚠ 返回类型**仍是**逐条 parse 后的 refs（`collectReadRefs` 需要完整
   *          `MessageContent`）——本读口省的是**列数**与**事务外往返**，不是省 parse。
   */
  listReadRefTargetsBySession(
    sessionId: string
  ): Promise<readonly MessageReadRefTarget[]>;

  /**
   * 按 seq 升序列出「seq >= fromSeq（含下界）」的消息。
   *
   * 回滚 plan 拉取收窄口径（rollback-large-jank Step 2）：resolveRollbackPlan
   * 对消息列表的全部消费都落在「触发消息自身 + seq 更大方向」（锚点解析只做
   * tool_result 前向配对、tail 过滤只取锚点之后），锚点之前的消息不拉取。
   */
  listBySessionFromSeq(
    sessionId: string,
    fromSeq: number
  ): Promise<ChatMessage[]>;

  listBySessionTail(sessionId: string, limit: number): Promise<ChatMessage[]>;

  listBySessionPage(
    sessionId: string,
    limit: number,
    beforeSeq?: number
  ): Promise<ChatMessage[]>;

  findById(id: string): Promise<ChatMessage | null>;

  nextSeq(sessionId: string): Promise<number>;

  insert(message: ChatMessage): Promise<void>;

  /**
   * 批量写入消息：一次 `conn.batch` 提交所有行，消除 fork/copy 的逐条 INSERT。
   *
   * 空数组是 no-op（不发出 SQL），方便调用方在不判断长度时直接传入。
   */
  batchInsert(messages: readonly ChatMessage[]): Promise<void>;

  /**
   * 替换存储的消息正文。行缺失时返回 false。
   *
   * 入参为 MessageContent 对象——JSON 序列化与压缩编码都收口在
   * repository（service 层不再 stringify）。
   */
  updateContent(id: string, content: MessageContent): Promise<boolean>;

  delete(id: string): Promise<boolean>;

  deleteBySession(sessionId: string): Promise<void>;

  /** Deletes messages with seq strictly greater than `afterSeq` in the session. */
  deleteAfterSeq(sessionId: string, afterSeq: number): Promise<void>;

  /** 列出 seq > afterSeq 的消息 id（截断 tail 用，避免全量 listBySession）。 */
  listIdsAfterSeq(sessionId: string, afterSeq: number): Promise<string[]>;

  /** Update the hidden state of a single message. Returns true if message was found. */
  updateHidden(messageId: string, hidden: boolean): Promise<boolean>;

  /** Update the hidden state of messages in a seq range. Returns count of affected rows. */
  updateHiddenRange(
    sessionId: string,
    fromSeq: number,
    toSeq: number,
    hidden: boolean
  ): Promise<number>;

  /**
   * 搜索会话内消息：keyword 非空时全量拉取后按 TextBlock 内存精筛再截断
   * limit（正文压缩后无 SQL LIKE 粗筛），keyword 为空时全量返回（不过滤
   * role）；seq DESC + 可选 beforeSeq/fromSeq/toSeq；不在 SQL 层过滤
   * hidden（始终含隐藏消息）。
   */
  searchMessages(
    sessionId: string,
    query: MessageSearchQuery
  ): Promise<ChatMessage[]>;
}
