/**
 * Token estimation for compaction triggers (deprecated — use TokenCounterRegistry).
 *
 * @module domain/compaction/logic/token-estimate
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { HeuristicTokenCounter } from "@/infra/tokenizer/impl/heuristic-token-counter.js";

const _heuristic = new HeuristicTokenCounter();

/**
 * Rough token estimate: character count / 4 (integer).
 *
 * @deprecated Use {@link TokenCounterRegistry} or {@link HeuristicTokenCounter} instead.
 */
export function estimateTokens(messages: readonly ChatMessage[]): number {
  return _heuristic.countMessages(messages);
}
