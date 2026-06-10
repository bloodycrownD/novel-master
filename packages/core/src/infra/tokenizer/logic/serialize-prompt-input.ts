/**
 * Serializes full prompt LLM input to a single string for token counting.
 *
 * @module infra/tokenizer/logic/serialize-prompt-input
 */

import type { PromptBlock } from "@/domain/prompt/model/prompt-block.js";
import {
  formatPromptLlmInputForCli,
} from "@/service/prompt/render-prompt.js";
import type { PromptRenderContext } from "@/domain/prompt/model/prompt-render-context.js";

/** Same string as CLI preview (`formatPromptLlmInputForCli`) for token parity. */
export function serializePromptLlmInput(
  blocks: readonly PromptBlock[],
  ctx: PromptRenderContext,
): string {
  return formatPromptLlmInputForCli(blocks, ctx);
}
