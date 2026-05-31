/**
 * Heuristic token counter — chars / 4 (compaction fallback).
 *
 * @module infra/tokenizer/impl/heuristic-token-counter
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { messageBodyText } from "@/domain/prompt/logic/message-body.js";
import type { TokenCounter } from "../ports/token-counter.port.js";

/** `Math.floor(charLength / 4)` for text and message bodies. */
export class HeuristicTokenCounter implements TokenCounter {
  readonly kind = "heuristic" as const;

  countText(text: string): number {
    return Math.floor(text.length / 4);
  }

  countMessages(messages: readonly ChatMessage[]): number {
    let chars = 0;
    for (const m of messages) {
      chars += messageBodyText(m).length;
    }
    return Math.floor(chars / 4);
  }
}
