/**
 * Chat message model.
 *
 * @module domain/chat/model/message
 */

export type { MessageContent } from "./content-block.js";

import type { MessageContent } from "./content-block.js";

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
