/**
 * Token estimation for compaction triggers.
 *
 * @module service/compaction/token-estimate
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { messageBodyText } from "@/domain/prompt/message-body.js";

/** Rough token estimate: character count / 4 (integer). */
export function estimateTokens(messages: readonly ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += messageBodyText(m).length;
  }
  return Math.floor(chars / 4);
}
