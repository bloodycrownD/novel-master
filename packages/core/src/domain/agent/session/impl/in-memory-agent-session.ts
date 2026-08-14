/**
 * In-memory agent session (tests).
 *
 * @module domain/agent/session/impl/in-memory-agent-session
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type {
  ChatMessage,
  MessageContent,
} from "@/domain/chat/model/message.js";
import type { MessageUsage } from "@/domain/chat/model/message-usage.js";
import type { AgentSession } from "../agent-session.port.js";

/**
 * Ephemeral session storing messages in memory.
 */
export class InMemoryAgentSession implements AgentSession {
  private readonly messages: ChatMessage[] = [];
  private seq = 0;

  constructor(
    readonly sessionId = "in-memory",
    readonly workplaceScopeSessionId = sessionId,
    readonly kkvScopeSessionId = sessionId,
  ) {}

  async list(): Promise<readonly ChatMessage[]> {
    return this.messages.filter((m) => !m.hidden);
  }

  async append(
    role: string,
    content: MessageContent,
    options?: {
      provider?: string | null;
      raw?: Record<string, unknown> | null;
      usage?: MessageUsage;
    },
  ): Promise<ChatMessage> {
    this.seq += 1;
    const message: ChatMessage = {
      id: randomUUID(),
      sessionId: this.sessionId,
      seq: this.seq,
      role,
      content,
      provider: options?.provider ?? null,
      raw: options?.raw ?? null,
      createdAtMs: Date.now(),
      hidden: false,
      ...(options?.usage != null ? { usage: options.usage } : {}),
    };
    this.messages.push(message);
    return message;
  }

  async hideRange(fromSeq: number, toSeq: number): Promise<number> {
    let count = 0;
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i]!;
      if (m.seq >= fromSeq && m.seq <= toSeq && !m.hidden) {
        this.messages[i] = { ...m, hidden: true };
        count += 1;
      }
    }
    return count;
  }

  async truncateAfterMessage(afterMessageId: string | null): Promise<void> {
    if (afterMessageId == null) {
      this.messages.length = 0;
      this.seq = 0;
      return;
    }
    const idx = this.messages.findIndex((m) => m.id === afterMessageId);
    if (idx < 0) {
      return;
    }
    this.messages.splice(idx + 1);
  }

  /** All messages including hidden (tests). */
  allMessages(): readonly ChatMessage[] {
    return [...this.messages];
  }
}
