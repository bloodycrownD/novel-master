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
  /** 本 session 的消息 session id（消息落库 / 读取用）。 */
  readonly sessionId: string;
  /**
   * 常驻工作区前缀读取的归属 session id。
   *
   * 主 session 等于自身 sessionId；子 session 指向父 session——子 session 是
   * createSubSession 新建的、sessionKkv 空，常驻前缀读父 session 的
   * rule_snapshot / file_cache，与父工作区视图一致（VFS 也复用同一归属 session）。
   * agent-runner 据此组装 wtScope，无需区分主 / 子。
   */
  readonly workplaceScopeSessionId: string;

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
