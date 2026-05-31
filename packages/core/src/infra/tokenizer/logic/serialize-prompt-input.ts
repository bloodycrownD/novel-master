/**
 * Serializes full prompt LLM input to a single string for token counting.
 *
 * @module infra/tokenizer/logic/serialize-prompt-input
 */

import { messageBodyText } from "@/domain/prompt/logic/message-body.js";
import type { PromptLlmInput } from "@/service/prompt/render-prompt.js";

/** Joins system + role-prefixed message bodies (CLI `--tokens` and tests). */
export function serializePromptLlmInput(input: PromptLlmInput): string {
  const parts: string[] = [];
  if (input.system != null && input.system !== "") {
    parts.push(input.system);
  }
  for (const m of input.messages) {
    parts.push(`${m.role}: ${messageBodyText(m)}`);
  }
  return parts.join("\n\n");
}
