/**
 * NMTP React Native driver registration.
 *
 * @module register
 */

import { TokenizerRegistry } from "@novel-master/core/nmtp";
import { countPromptLlmInputRn } from "./count-prompt-llm-input.js";

const RN_DRIVER_NAME = "rn";

/** Registers the React Native tokenizer driver (js-tiktoken + Android native bridge). */
export function registerTokenizerRnDriver(): void {
  TokenizerRegistry.register({
    name: RN_DRIVER_NAME,
    countPromptLlmInput: countPromptLlmInputRn,
  });
}
