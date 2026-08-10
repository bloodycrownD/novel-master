/**
 * LLM token usage for a single assistant message.
 *
 * @module domain/chat/model/message-usage
 */

/** Token usage reported by the LLM for one assistant response. */
export interface MessageUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}
