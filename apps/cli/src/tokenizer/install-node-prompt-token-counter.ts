/**
 * Installs Node {@link PromptTokenCounterBridge} for CLI (uses `@agnai/*` in core).
 *
 * @module tokenizer/install-node-prompt-token-counter
 */

import { NM_PROMPT_TOKEN_COUNTER_KEY } from "@novel-master/core";

/** Registers full model-aware counting on `globalThis`. */
export async function installNodePromptTokenCounter(): Promise<void> {
  const { countPromptLlmInputNode } = await import("@novel-master/core/tokenizer-node");
  (globalThis as Record<string, unknown>)[NM_PROMPT_TOKEN_COUNTER_KEY] = {
    countPromptLlmInput: countPromptLlmInputNode,
  };
}
