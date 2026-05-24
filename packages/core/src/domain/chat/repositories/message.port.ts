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

  delete(id: string): Promise<boolean>;

  deleteBySession(sessionId: string): Promise<void>;
}
