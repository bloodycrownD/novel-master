/**
 * Chat message model.
 *
 * @module domain/chat/model/message
 */

/** Minimal message content JSON stored in `content_json`. */
export interface MessageContent {
  readonly content?: string;
  readonly parts?: ReadonlyArray<unknown>;
}

/** A single message in a session, ordered by `seq`. */
export interface ChatMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly role: string;
  readonly content: MessageContent;
  readonly provider: string | null;
  readonly raw: Record<string, unknown> | null;
  readonly createdAtMs: number;
  /** Whether this message is hidden from LLM prompt rendering. */
  readonly hidden: boolean;
}
