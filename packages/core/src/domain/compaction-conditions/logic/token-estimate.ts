/**
 * Token estimation for compaction condition triggers.
 *
 * @module domain/compaction-conditions/logic/token-estimate
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { HeuristicTokenCounter } from "@/infra/tokenizer/impl/heuristic-token-counter.js";

const _heuristic = new HeuristicTokenCounter();

/** Rough token estimate via heuristic counter (visible message list). */
export function estimateTokens(messages: readonly ChatMessage[]): number {
  return _heuristic.countMessages(messages);
}
