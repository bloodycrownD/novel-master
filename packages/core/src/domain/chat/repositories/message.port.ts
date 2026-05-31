/**
 * Chat message repository port.
 *
 * @module domain/chat/repositories/message.port
 */

import type { ChatMessage } from "../model/message.js";

/** Persistence for `chat_message` rows. */
export interface MessageRepository {
  listBySession(sessionId: string): Promise<ChatMessage[]>;

  findById(id: string): Promise<ChatMessage | null>;

  nextSeq(sessionId: string): Promise<number>;

  insert(message: ChatMessage): Promise<void>;

  /** Replaces stored content JSON. Returns false when the row is missing. */
  updateContent(id: string, contentJson: string): Promise<boolean>;

  delete(id: string): Promise<boolean>;

  deleteBySession(sessionId: string): Promise<void>;

  /** Update the hidden state of a single message. Returns true if message was found. */
  updateHidden(messageId: string, hidden: boolean): Promise<boolean>;

  /** Update the hidden state of messages in a seq range. Returns count of affected rows. */
  updateHiddenRange(
    sessionId: string,
    fromSeq: number,
    toSeq: number,
    hidden: boolean,
  ): Promise<number>;
}
