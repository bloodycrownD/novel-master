/**
 * NMTP React Native driver registration.
 *
 * @module register
 */

import { registerTokenizerDriver } from "@novel-master/core/nmtp";
import { countPromptLlmInputRn } from "./count-prompt-llm-input.js";

export const RN_DRIVER_NAME = "rn";

/** Registers the React Native tokenizer driver (js-tiktoken + Android native bridge). */
export function registerTokenizerRnDriver(): void {
  registerTokenizerDriver({
    name: RN_DRIVER_NAME,
    countPromptLlmInput: countPromptLlmInputRn,
  });
}
