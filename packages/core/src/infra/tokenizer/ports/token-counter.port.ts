/**
 * Token counter port — plain text and chat message counting.
 *
 * @module infra/tokenizer/ports/token-counter.port
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";

/** Aligns with SillyTavern `getTokenizerModel` families plus heuristic fallback. */
export type TokenizerFamily =
  | "heuristic"
  | "tiktoken"
  | "claude"
  | "llama"
  | "llama3"
  | "mistral"
  | "yi"
  | "gemma"
  | "jamba"
  | "qwen2"
  | "command-r"
  | "command-a"
  | "nemo"
  | "deepseek"
  | "gpt2";

/** Implementation kind for observability (CLI stderr, debug). */
export type TokenCounterKind = TokenizerFamily;

/** Counts tokens in text or visible chat messages (`messageBodyText` per message). */
export interface TokenCounter {
  readonly kind: TokenCounterKind;
  /** Plain text token count (raw encode or heuristic). */
  countText(text: string): number;
  /** Uses messageBodyText per message (legacy compaction estimate path). */
  countMessages(messages: readonly ChatMessage[]): number;
}
