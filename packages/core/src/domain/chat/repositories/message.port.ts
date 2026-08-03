/**
 * Chat message repository port.
 *
 * @module domain/chat/repositories/message.port
 */

import type { ChatMessage } from "../model/message.js";
import type { MessageSearchQuery } from "../content/message-content-match.js";

/** Persistence for `chat_message` rows. */
export interface MessageRepository {
  listBySession(sessionId: string): Promise<ChatMessage[]>;
  listBySessionTail(sessionId: string, limit: number): Promise<ChatMessage[]>;
  listBySessionPage(
    sessionId: string,
    limit: number,
    beforeSeq?: number,
  ): Promise<ChatMessage[]>;

  findById(id: string): Promise<ChatMessage | null>;

  nextSeq(sessionId: string): Promise<number>;

  insert(message: ChatMessage): Promise<void>;

  /** Replaces stored content JSON. Returns false when the row is missing. */
  updateContent(id: string, contentJson: string): Promise<boolean>;

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
    hidden: boolean,
  ): Promise<number>;

  /**
   * 搜索会话内消息：keyword 非空时加 LIKE 粗筛 + role 粗筛，keyword 为空时全量拉；
   * seq DESC LIMIT + 可选 beforeSeq；不在 SQL 层过滤 hidden（始终含隐藏消息）。
   */
  searchMessages(
    sessionId: string,
    query: MessageSearchQuery,
  ): Promise<ChatMessage[]>;
}
