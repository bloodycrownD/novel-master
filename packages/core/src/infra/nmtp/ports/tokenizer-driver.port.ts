/**
 * NMTP tokenizer driver port — platform-specific prompt token counting.
 *
 * @module infra/nmtp/ports/tokenizer-driver.port
 */

import type { AppError } from "../../../errors/app-error.js";
import type { Result } from "../../../errors/either.js";
import type {
  CountPromptLlmInputParams,
  PromptTokenCountResult,
} from "../../tokenizer/logic/count-prompt-llm-input.js";

/** Factory for platform-specific prompt token counting. */
export interface TokenizerDriver {
  readonly name: string;
  countPromptLlmInput(
    params: CountPromptLlmInputParams
  ): Promise<Result<PromptTokenCountResult, AppError>>;
}
