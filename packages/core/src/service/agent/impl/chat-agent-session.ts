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
 * workplaceScopeSessionId 决定规则评估与 workplace 服务的 scope：主 session 等于
 * 自身；子 session 指向父 session（子 agent 在父 session 工作区工作）。
 * kkvScopeSessionId 决定 rule_snapshot / file_cache 的 KKV 归属：永远等于自身
 * sessionId（子会话仅做规则快照隔离）。runChildAgent 装配子 agent 时显式传入
 * parentSessionId 作为第三位位置参数，第四位走默认值（= childSessionId）。
 */
export class ChatAgentSession implements AgentSession {
  constructor(
    private readonly messages: MessageService,
    readonly sessionId: string,
    readonly workplaceScopeSessionId: string = sessionId,
    readonly kkvScopeSessionId: string = sessionId
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
      modelName?: string | null;
      raw?: Record<string, unknown> | null;
      usage?: MessageUsage;
    }
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
