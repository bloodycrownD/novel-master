/**
 * Token counter registry port — model-aware counter resolution.
 *
 * @module infra/tokenizer/ports/token-counter-registry.port
 */

import type { TokenCounter } from "./token-counter.port.js";
import type { TokenizerOverride } from "../logic/resolve-tokenizer-family.js";

export interface ForVendorModelOptions {
  readonly override?: TokenizerOverride;
}

/** Resolves {@link TokenCounter} by vendor model id (protocol-independent). */
export interface TokenCounterRegistry {
  readonly heuristic: TokenCounter;
  /** Optional override for tokenizer drivers when caller passes no explicit mode. */
  getTokenizerOverride?(): Promise<TokenizerOverride>;
  /**
   * Resolve counter for saved model UUID.
   * Routes by resolved vendor model name.
   */
  forSavedModel(
    savedModelId: string,
    options?: ForVendorModelOptions,
  ): Promise<TokenCounter>;
  /** Primary path: vendor model id substring → tokenizer family (heuristic in core). */
  forVendorModel(
    vendorModelId: string,
    options?: ForVendorModelOptions,
  ): TokenCounter;
}
