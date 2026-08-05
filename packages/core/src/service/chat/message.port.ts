/**
 * Message application service port.
 *
 * @module service/chat/message.port
 */

import type {
  ChatMessage,
  MessageAttachment,
  MessageContent,
} from "@/domain/chat/model/message.js";
import type { ChatSession } from "@/domain/chat/model/session.js";
import type { MessageSearchQuery } from "@/domain/chat/content/message-content-match.js";

/** Message CRUD and fork (branch) operations. */
export interface MessageService {
  listBySession(sessionId: string): Promise<ChatMessage[]>;
  listBySessionTail(
    sessionId: string,
    options: { limit: number },
  ): Promise<ChatMessage[]>;
  listBySessionPage(
    sessionId: string,
    options: { limit: number; beforeSeq?: number },
  ): Promise<ChatMessage[]>;

  get(id: string): Promise<ChatMessage>;

  append(
    sessionId: string,
    role: string,
    content: MessageContent,
    options?: {
      provider?: string | null;
      raw?: Record<string, unknown> | null;
      /** 结构化附件；写入 `attachments_json`，不写入 `content_json`。 */
      attachments?: readonly MessageAttachment[];
    },
  ): Promise<ChatMessage>;

  delete(id: string): Promise<void>;

  /** Replaces message content (e.g. user edit in mobile). */
  updateContent(messageId: string, content: MessageContent): Promise<ChatMessage>;

  /**
   * Creates a new session with source session VFS and messages up to `upToMessageId`.
   */
  fork(sessionId: string, upToMessageId: string): Promise<ChatSession>;

  /** Hide a single message from LLM prompt rendering. */
  hide(messageId: string): Promise<void>;

  /** Show a previously hidden message. */
  show(messageId: string): Promise<void>;

  /** Hide a range of messages by seq. Returns count of affected messages. */
  hideRange(sessionId: string, fromSeq: number, toSeq: number): Promise<number>;

  /** Show a range of messages by seq. Returns count of affected messages. */
  showRange(sessionId: string, fromSeq: number, toSeq: number): Promise<number>;

  /**
   * 删除 `sessionId` 中严格位于 `afterMessageId` 之后的所有消息（及其 checkpoint 指针），
   * 不含 anchor 自身；`afterMessageId` 为 null 时清空 session 内全部消息。
   *
   * 主要给 agent turn abort 回滚用——干净回到 turn 起点。
   */
  truncateAfter(
    sessionId: string,
    afterMessageId: string | null,
  ): Promise<void>;

  /**
   * 搜索会话内消息（透传仓储层召回，keyword 非空时在内存层精筛 TextBlock）。
   */
  searchMessages(
    sessionId: string,
    query: MessageSearchQuery,
  ): Promise<ChatMessage[]>;
}
