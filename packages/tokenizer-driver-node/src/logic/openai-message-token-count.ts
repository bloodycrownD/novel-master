/**
 * OpenAI chat message token count with per-message overhead (SillyTavern-style).
 *
 * @module logic/openai-message-token-count
 */

import type { ChatMessage } from "@novel-master/core";
import { isGpt0301TiktokenModel, messageBodyText } from "@novel-master/core";
import type { Tiktoken } from "tiktoken";

/**
 * Counts tokens for visible messages using OpenAI chat billing overhead.
 *
 * - +3 tokens per message (+4 for 0301)
 * - encode each message body via tiktoken
 * - +3 trailing padding (+9 extra for 0301)
 */
export function countOpenAiMessages(
  encoding: Tiktoken,
  messages: readonly ChatMessage[],
  tiktokenModel: string,
): number {
  const is0301 = isGpt0301TiktokenModel(tiktokenModel);
  const perMessageOverhead = is0301 ? 4 : 3;
  let tokens = 0;

  for (const m of messages) {
    tokens += perMessageOverhead;
    tokens += encoding.encode(messageBodyText(m)).length;
  }

  tokens += 3;
  if (is0301) {
    tokens += 9;
  }

  return tokens;
}
