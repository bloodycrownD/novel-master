/**
 * In-memory overlay on a chat session: reads base visible history, appends only to RAM.
 *
 * Used by {@link runRunAgentAction} so event-triggered agents do not persist turns.
 *
 * @module service/agent/impl/ephemeral-overlay-agent-session
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { ChatMessage, MessageContent } from "@/domain/chat/model/message.js";

/**
 * {@link AgentSession} that lists base + overlay messages; {@link append} never hits SQLite.
 */
export class EphemeralOverlayAgentSession implements AgentSession {
  private readonly overlay: ChatMessage[] = [];
  private nextSeq = 1_000_000_000;

  constructor(
    private readonly base: AgentSession,
    readonly sessionId: string,
  ) {}

  async list(): Promise<readonly ChatMessage[]> {
    const base = await this.base.list();
    return [...base, ...this.overlay];
  }

  async append(
    role: string,
    content: MessageContent,
    options?: { provider?: string | null; raw?: Record<string, unknown> | null },
  ): Promise<ChatMessage> {
    const seq = this.nextSeq++;
    const message: ChatMessage = {
      id: `ephemeral-${seq}`,
      sessionId: this.sessionId,
      seq,
      role,
      content,
      provider: options?.provider ?? null,
      raw: options?.raw ?? null,
      createdAtMs: Date.now(),
      hidden: false,
    };
    this.overlay.push(message);
    return message;
  }

  hideRange(fromSeq: number, toSeq: number): Promise<number> {
    return this.base.hideRange(fromSeq, toSeq);
  }
}
