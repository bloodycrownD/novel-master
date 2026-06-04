/**
 * Resolves the injected {@link TokenizerLoader} (platform installs assets + I/O).
 *
 * Core does not read tokenizer files; Mobile and CLI register loaders at startup.
 *
 * @module infra/tokenizer/impl/get-tokenizer-loader
 */

import { injectedTokenizerLoader, type TokenizerLoader } from "./tokenizer-loader-shared.js";

/** Requires {@link NM_TOKENIZER_LOADER_KEY} from Mobile polyfills or CLI `installNodeTokenizerLoader`. */
export function getTokenizerLoader(): TokenizerLoader {
  const injected = injectedTokenizerLoader();
  if (injected == null) {
    throw new Error(
      "Tokenizer loader not installed. Mobile: installMobileTokenizerLoader() in polyfills. CLI: installNodeTokenizerLoader() in runtime.",
    );
  }
  return injected;
}
