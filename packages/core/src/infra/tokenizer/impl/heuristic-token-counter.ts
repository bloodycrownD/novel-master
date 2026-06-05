/**
 * Heuristic token counter — SillyTavern CHARACTERS_PER_TOKEN_RATIO fallback.
 *
 * @module infra/tokenizer/impl/heuristic-token-counter
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { messageBodyText } from "@/domain/prompt/logic/message-body.js";
import type { TokenCounter } from "../ports/token-counter.port.js";

/**
 * Matches SillyTavern `CHARACTERS_PER_TOKEN_RATIO`.
 * Kotlin mirror: `tokenizer-driver-rn/.../TokenizerConstants.kt` (update both when changed).
 */
export const CHARACTERS_PER_TOKEN_RATIO = 3.35;

/** `Math.ceil(charLength / 3.35)` for text and message bodies. */
export class HeuristicTokenCounter implements TokenCounter {
  readonly kind = "heuristic" as const;

  countText(text: string): number {
    return Math.ceil(text.length / CHARACTERS_PER_TOKEN_RATIO);
  }

  countMessages(messages: readonly ChatMessage[]): number {
    let chars = 0;
    for (const m of messages) {
      chars += messageBodyText(m).length;
    }
    return Math.ceil(chars / CHARACTERS_PER_TOKEN_RATIO);
  }
}
