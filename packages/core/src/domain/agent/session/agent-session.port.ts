/**
 * Agent session port: message list/append for agent runs.
 *
 * @module domain/agent/session/agent-session.port
 */

import type {
  ChatMessage,
  MessageContent,
} from "@/domain/chat/model/message.js";
import type { MessageUsage } from "@/domain/chat/model/message-usage.js";

/**
 * Session abstraction for agent context (in-memory or chat-backed).
 */
export interface AgentSession {
  /** 本 session 的消息 session id（消息落库 / 读取用）。 */
  readonly sessionId: string;
  /**
   * 常驻工作区前缀的规则评估与 workplace 服务归属 session id。
   *
   * 主 session 等于自身 sessionId；子 session 指向父 session（孙 agent 同样指向
   * 根父会话）——子 agent 在父 session 工作区工作：规则评估（evaluateRuleView）
   * 与文件列表都按父工作区来。agent-runner 据此组装 wtScope，无需区分主 / 子。
   */
  readonly workplaceScopeSessionId: string;
  /**
   * rule_snapshot / file_cache 的 KKV 归属 session id。
   *
   * 永远等于自身 sessionId（子会话仅做规则快照隔离：KKV 存取走子 session 自己的
   * 域，规则评估仍按 {@link workplaceScopeSessionId} 指向的父工作区）。
   */
  readonly kkvScopeSessionId: string;

  /** Visible messages in order (excludes `hidden`). */
  list(): Promise<readonly ChatMessage[]>;

  /** Appends a message to the session. */
  append(
    role: string,
    content: MessageContent,
    options?: {
      provider?: string | null;
      /** 厂商模型 id（透传到 `chat_message.model_name`）。 */
      modelName?: string | null;
      raw?: Record<string, unknown> | null;
      usage?: MessageUsage;
    },
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
