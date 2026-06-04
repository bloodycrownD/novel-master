/**
 * Factory for explicit Node / RN tokenizer loaders (CLI and tests).
 *
 * Runtime hot path uses {@link getTokenizerLoader} from `get-tokenizer-loader(.native).ts`.
 *
 * @module infra/tokenizer/impl/create-tokenizer-loader
 */

import { createNodeTokenizerLoader } from "./node-tokenizer-loader.js";
import {
  injectedTokenizerLoader,
  type TokenizerLoader,
  type TokenizerRuntime,
} from "./tokenizer-loader-shared.js";

/** Node loader — reads from `packages/core/assets/tokenizers`. */
export function createTokenizerLoader(runtime: "node"): TokenizerLoader;
/** RN loader — requires global injection (see Mobile polyfills). */
export function createTokenizerLoader(runtime: "react-native"): TokenizerLoader;
export function createTokenizerLoader(runtime: TokenizerRuntime): TokenizerLoader {
  if (runtime === "react-native") {
    const injected = injectedTokenizerLoader();
    if (injected == null) {
      throw new Error(
        "React Native tokenizer loader not installed; set globalThis.__NM_TOKENIZER_LOADER__ in polyfills",
      );
    }
    return injected;
  }
  return createNodeTokenizerLoader();
}
