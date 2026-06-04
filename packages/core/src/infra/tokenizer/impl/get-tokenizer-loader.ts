/**
 * Resolves tokenizer loader on Node (injection or filesystem).
 *
 * @module infra/tokenizer/impl/get-tokenizer-loader
 */

import { createNodeTokenizerLoader } from "./node-tokenizer-loader.js";
import { injectedTokenizerLoader, type TokenizerLoader } from "./tokenizer-loader-shared.js";

/** Active loader: RN injection when present, otherwise Node filesystem. */
export function getTokenizerLoader(): TokenizerLoader {
  return injectedTokenizerLoader() ?? createNodeTokenizerLoader();
}
