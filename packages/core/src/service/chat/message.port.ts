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

  get(id: string): Promise<ChatMessage>;

  append(
    sessionId: string,
    role: string,
    content: MessageContent,
    options?: { provider?: string | null; raw?: Record<string, unknown> | null },
  ): Promise<ChatMessage>;

  delete(id: string): Promise<void>;

  /**
   * Creates a new session with source session VFS and messages up to `upToMessageId`.
   */
  fork(sessionId: string, upToMessageId: string): Promise<ChatSession>;
}
