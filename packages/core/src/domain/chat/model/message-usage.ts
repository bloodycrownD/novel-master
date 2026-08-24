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
  /** 命中 prompt cache 的输入 token 数（供应商原始值，不改 promptTokens 语义）。 */
  readonly cacheReadTokens?: number;
  /** 本次请求新写入 prompt cache 的输入 token 数（OpenAI/Gemini 无此概念，仅 Anthropic）。 */
  readonly cacheCreationTokens?: number;
}
