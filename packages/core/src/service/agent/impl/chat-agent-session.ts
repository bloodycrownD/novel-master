/**
 * Chat-backed agent session (SQLite via MessageService).
 *
 * @module domain/agent/session/impl/chat-agent-session
 */

import type { MessageContent } from "@/domain/chat/model/message.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { AgentSession } from "../agent-session.port.js";

/**
 * Agent session adapter over {@link MessageService}.
 */
export class ChatAgentSession implements AgentSession {
  constructor(
    private readonly messages: MessageService,
    readonly sessionId: string,
  ) {}

  async list(): Promise<readonly ChatMessage[]> {
    const all = await this.messages.listBySession(this.sessionId);
    return all.filter((m) => !m.hidden);
  }

  append(
    role: string,
    content: MessageContent,
    options?: { provider?: string | null; raw?: Record<string, unknown> | null },
  ): Promise<ChatMessage> {
    return this.messages.append(this.sessionId, role, content, options);
  }

  hideRange(fromSeq: number, toSeq: number): Promise<number> {
    return this.messages.hideRange(this.sessionId, fromSeq, toSeq);
  }
}
