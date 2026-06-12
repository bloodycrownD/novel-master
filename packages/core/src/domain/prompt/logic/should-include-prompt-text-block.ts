/**
 * Prompt text block lifecycle filtering for assembly.
 *
 * @module domain/prompt/logic/should-include-prompt-text-block
 */

import type { PromptBlock } from "../model/prompt-block.js";

/** Whether a text block is included at the given agent run step. */
export function shouldIncludePromptTextBlock(
  block: Extract<PromptBlock, { type: "text" }>,
  agentStepIndex: number,
): boolean {
  if (block.role === "system") {
    return true;
  }
  const lifecycle = block.lifecycle ?? "always";
  if (lifecycle === "always") {
    return true;
  }
  return agentStepIndex === 0;
}
