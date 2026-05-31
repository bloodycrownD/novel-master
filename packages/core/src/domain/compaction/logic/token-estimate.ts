/**
 * Token estimation for compaction triggers.
 *
 * @module domain/compaction/logic/token-estimate
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { messageBodyText } from "@/domain/prompt/logic/message-body.js";

/** Rough token estimate: character count / 4 (integer). */
export function estimateTokens(messages: readonly ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += messageBodyText(m).length;
  }
  return Math.floor(chars / 4);
}
