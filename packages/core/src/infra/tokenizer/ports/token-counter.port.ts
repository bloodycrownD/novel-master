/**
 * Token counter port — plain text and chat message counting.
 *
 * @module infra/tokenizer/ports/token-counter.port
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";

/** Implementation kind for observability (CLI stderr, debug). */
export type TokenCounterKind = "heuristic" | "tiktoken";

/** Counts tokens in text or visible chat messages (`messageBodyText` per message). */
export interface TokenCounter {
  readonly kind: TokenCounterKind;
  /** Plain text token count. */
  countText(text: string): number;
  /** Uses messageBodyText per message (skips thinking-only paths via body helper). */
  countMessages(messages: readonly ChatMessage[]): number;
}
