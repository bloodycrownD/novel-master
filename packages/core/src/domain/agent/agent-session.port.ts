/**
 * Agent session port: message list/append for agent runs.
 *
 * @module domain/agent/agent-session.port
 */

import type { ChatMessage, MessageContent } from "../chat/model/message.js";

/**
 * Session abstraction for agent context (in-memory or chat-backed).
 */
export interface AgentSession {
  /** Visible messages in order (excludes `hidden`). */
  list(): Promise<readonly ChatMessage[]>;

  /** Appends a message to the session. */
  append(
    role: string,
    content: MessageContent,
    options?: { provider?: string | null; raw?: Record<string, unknown> | null },
  ): Promise<ChatMessage>;

  /** Hides messages in a seq range (compaction). Returns affected count. */
  hideRange(fromSeq: number, toSeq: number): Promise<number>;
}
