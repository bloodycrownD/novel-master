/**
 * React Native tokenizer loader — injection only (no `node:fs` / `node:path`).
 *
 * Metro selects this file instead of `get-tokenizer-loader.ts` on native platforms.
 *
 * @module infra/tokenizer/impl/get-tokenizer-loader.native
 */

import { injectedTokenizerLoader, type TokenizerLoader } from "./tokenizer-loader-shared.js";

/** Requires {@link NM_TOKENIZER_LOADER_KEY} from Mobile polyfills. */
export function getTokenizerLoader(): TokenizerLoader {
  const injected = injectedTokenizerLoader();
  if (injected == null) {
    throw new Error(
      "React Native tokenizer loader not installed; call installMobileTokenizerLoader() in polyfills before App",
    );
  }
  return injected;
}
