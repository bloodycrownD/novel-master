/**
 * Chat message model.
 *
 * @module domain/chat/model/message
 */

export type { MessageContent } from "./content-block.js";
export type { MessageAttachment } from "./message-attachment.schema.js";

import type { MessageContent } from "./content-block.js";
import type { MessageAttachment } from "./message-attachment.schema.js";

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
  /**
   * 结构化附件（与 `attachments_json` 双向映射）。
   * 缺列/NULL → `undefined`；`content_json` 永不写 wrap XML。
   */
  readonly attachments?: readonly MessageAttachment[];
}
