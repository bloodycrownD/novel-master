/**
 * Resolves the injected {@link TokenizerLoader} (platform installs assets + I/O).
 *
 * Core does not read tokenizer files; Mobile and CLI register loaders at startup.
 *
 * @module infra/tokenizer/impl/get-tokenizer-loader
 */

import { injectedTokenizerLoader, type TokenizerLoader } from "./tokenizer-loader-shared.js";

/** Requires {@link NM_TOKENIZER_LOADER_KEY} from CLI `installNodeTokenizerLoader` (Node/test). */
export function getTokenizerLoader(): TokenizerLoader {
  const injected = injectedTokenizerLoader();
  if (injected == null) {
    throw new Error(
      "Tokenizer loader not installed. CLI: installNodeTokenizerLoader() in runtime. " +
        "Mobile WEB/SP counting uses Android NovelMasterTokenizer; this API is Node/test-only.",
    );
  }
  return injected;
}
