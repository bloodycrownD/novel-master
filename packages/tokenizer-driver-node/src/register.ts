/**
 * NMTP Node driver registration.
 *
 * @module register
 */

import { registerTokenizerDriver } from "@novel-master/core/nmtp";
import { countPromptLlmInput } from "./count-prompt-llm-input.js";
import {
  createNodeTokenizerLoader,
  defaultTokenizerAssetsRoot,
  setNodeTokenizerLoader,
} from "./node-tokenizer-loader.js";

export const NODE_DRIVER_NAME = "node";

export interface RegisterTokenizerNodeDriverOptions {
  readonly assetsRoot?: string;
}

/** Registers the Node tokenizer driver and installs the filesystem asset loader. */
export function registerTokenizerNodeDriver(
  options?: RegisterTokenizerNodeDriverOptions,
): void {
  const root = options?.assetsRoot ?? defaultTokenizerAssetsRoot();
  setNodeTokenizerLoader(createNodeTokenizerLoader(root));
  registerTokenizerDriver({
    name: NODE_DRIVER_NAME,
    countPromptLlmInput,
  });
}
