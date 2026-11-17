/**
 * Core test helper: registers the Node NMTP driver without tsconfig path hacks.
 *
 * Inlines driver registration via relative imports so core tests never need
 * `@novel-master/tokenizer-driver-node` or `@novel-master/core/nmtp` path maps.
 *
 * @module test/helpers/register-node-tokenizer-driver-for-tests
 */

import { TokenizerRegistry } from "../../src/infra/nmtp/index.js";
import { countPromptLlmInput } from "../../../tokenizer-driver-node/src/count-prompt-llm-input.js";
import {
  createNodeTokenizerLoader,
  defaultTokenizerAssetsRoot,
  setNodeTokenizerLoader,
} from "../../../tokenizer-driver-node/src/node-tokenizer-loader.js";
import { NODE_DRIVER_NAME } from "../../../tokenizer-driver-node/src/register.js";

/** Registers the Node driver for tests; clears any prior drivers first. */
export function registerNodeTokenizerDriverForTests(assetsRoot?: string): void {
  TokenizerRegistry.clear();
  const root = assetsRoot ?? defaultTokenizerAssetsRoot();
  setNodeTokenizerLoader(createNodeTokenizerLoader(root));
  TokenizerRegistry.register({
    name: NODE_DRIVER_NAME,
    countPromptLlmInput,
  });
}
