/**
 * Agent session port: message list/append for agent runs.
 *
 * @module domain/agent/session/agent-session.port
 */

import type { ChatMessage, MessageContent } from "@/domain/chat/model/message.js";

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

  /**
   * 删除当前 session 中严格位于 `afterMessageId` 之后追加的消息（不含 anchor 自身）；
   * `afterMessageId` 为 null 时清空 session 内全部消息。
   *
   * 用途：agent turn abort 时回滚到 turn 起点，避免残留 partial assistant 消息。
   */
  truncateAfterMessage(afterMessageId: string | null): Promise<void>;
}
