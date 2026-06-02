/**
 * Message application service port.
 *
 * @module service/chat/message.port
 */

import type { ChatMessage, MessageContent } from "@/domain/chat/model/message.js";
import type { ChatSession } from "@/domain/chat/model/session.js";

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
    options?: { provider?: string | null; raw?: Record<string, unknown> | null },
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
}
