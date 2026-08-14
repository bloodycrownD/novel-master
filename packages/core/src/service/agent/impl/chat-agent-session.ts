/**
 * Chat-backed agent session (SQLite via MessageService).
 *
 * @module service/agent/impl/chat-agent-session
 */

import type { MessageContent } from "@/domain/chat/model/message.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { MessageUsage } from "@/domain/chat/model/message-usage.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";

/**
 * Agent session adapter over {@link MessageService}.
 *
 * workplaceScopeSessionId 默认等于 sessionId（主 session 与子 session 均如此：
 * Feature A 后子会话工作区隔离，子 session 的工作区归属指向自身，不再指向父
 * session）。runChildAgent 装配子 agent 时显式传入 childSessionId 作为第三位
 * 位置参数，使常驻工作区前缀读子 session 自己的（空）rule_snapshot / file_cache。
 */
export class ChatAgentSession implements AgentSession {
  constructor(
    private readonly messages: MessageService,
    readonly sessionId: string,
    readonly workplaceScopeSessionId: string = sessionId,
  ) {}

  async list(): Promise<readonly ChatMessage[]> {
    const all = await this.messages.listBySession(this.sessionId);
    return all.filter((m) => !m.hidden);
  }

  append(
    role: string,
    content: MessageContent,
    options?: {
      provider?: string | null;
      raw?: Record<string, unknown> | null;
      usage?: MessageUsage;
    },
  ): Promise<ChatMessage> {
    return this.messages.append(this.sessionId, role, content, options);
  }

  hideRange(fromSeq: number, toSeq: number): Promise<number> {
    return this.messages.hideRange(this.sessionId, fromSeq, toSeq);
  }

  truncateAfterMessage(afterMessageId: string | null): Promise<void> {
    return this.messages.truncateAfter(this.sessionId, afterMessageId);
  }
}
