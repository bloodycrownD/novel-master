/**
 * NMTP Node driver registration.
 *
 * @module register
 */

import { TokenizerRegistry } from "@novel-master/core/nmtp";
import { PromptLlmInputCounter } from "./count-prompt-llm-input.js";
import { NodeTokenizerLoader } from "./node-tokenizer-loader.js";

export const NODE_DRIVER_NAME = "node";

export interface RegisterTokenizerNodeDriverOptions {
  readonly assetsRoot?: string;
}

// nm-style 注记：文件名 register 太泛，按成员主体起名（TokenizerNodeRegister）。
/** Registers the Node tokenizer driver and installs the filesystem asset loader. */
export namespace TokenizerNodeRegister {
  export function register(options?: RegisterTokenizerNodeDriverOptions): void {
    const root = options?.assetsRoot ?? NodeTokenizerLoader.defaultAssetsRoot();
    NodeTokenizerLoader.set(NodeTokenizerLoader.create(root));
    TokenizerRegistry.register({
      name: NODE_DRIVER_NAME,
      countPromptLlmInput: PromptLlmInputCounter.count,
    });
  }
}
