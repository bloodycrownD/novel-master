/**
 * NMTP React Native driver registration.
 *
 * @module register
 */

import { TokenizerRegistry } from "@novel-master/core/nmtp";
import { PromptLlmInputCounter } from "./count-prompt-llm-input.js";

const RN_DRIVER_NAME = "rn";

// nm-style 注记：文件名 register 太泛，按成员主体起名（TokenizerRnRegister）。
/** Registers the React Native tokenizer driver (js-tiktoken + Android native bridge). */
export namespace TokenizerRnRegister {
    export function register(): void {
        TokenizerRegistry.register({
            name: RN_DRIVER_NAME,
            countPromptLlmInput: PromptLlmInputCounter.count,
        });
    }
}
