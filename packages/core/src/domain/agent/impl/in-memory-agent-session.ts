/**
 * In-memory agent session (tests).
 *
 * @module domain/agent/impl/in-memory-agent-session
 */

import { randomUUID } from "node:crypto";
import type { ChatMessage, MessageContent } from "../../chat/model/message.js";
import type { AgentSession } from "../agent-session.port.js";

/**
 * Ephemeral session storing messages in memory.
 */
export class InMemoryAgentSession implements AgentSession {
  private readonly messages: ChatMessage[] = [];
  private seq = 0;

  constructor(readonly sessionId = "in-memory") {}

  async list(): Promise<readonly ChatMessage[]> {
    return this.messages.filter((m) => !m.hidden);
  }

  async append(
    role: string,
    content: MessageContent,
    options?: { provider?: string | null; raw?: Record<string, unknown> | null },
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

  /** All messages including hidden (tests). */
  allMessages(): readonly ChatMessage[] {
    return [...this.messages];
  }
}
