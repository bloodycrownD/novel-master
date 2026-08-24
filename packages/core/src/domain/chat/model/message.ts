/**
 * Chat message model.
 *
 * @module domain/chat/model/message
 */

export type { MessageContent } from "./content-block.js";
export type { MessageAttachment } from "./message-attachment.schema.js";
export type { MessageUsage } from "./message-usage.js";

import type { MessageContent } from "./content-block.js";
import type { MessageAttachment } from "./message-attachment.schema.js";
import type { MessageUsage } from "./message-usage.js";

/** A single message in a session, ordered by `seq`. */
export interface ChatMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly role: string;
  readonly content: MessageContent;
  readonly provider: string | null;
  /**
   * 产生本条 assistant 消息的厂商模型 id（`llm_saved_model.vendor_model_id`，
   * 映射 `chat_message.model_name` 列）。老消息缺列/NULL → `null`。
   */
  readonly modelName?: string | null;
  readonly raw: Record<string, unknown> | null;
  readonly createdAtMs: number;
  /** Whether this message is hidden from LLM prompt rendering. */
  readonly hidden: boolean;
  /**
   * 结构化附件（与 `attachments_json` 双向映射）。
   * 缺列/NULL → `undefined`；`content_json` 永不写 wrap XML。
   */
  readonly attachments?: readonly MessageAttachment[];
  /**
   * LLM token usage（assistant message 持久化的 prompt/completion/total tokens）。
   * 老消息缺列/NULL → `undefined`。
   */
  readonly usage?: MessageUsage;
}
