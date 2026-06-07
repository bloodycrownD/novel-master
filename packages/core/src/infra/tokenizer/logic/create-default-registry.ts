/**
 * Default token counter registry — heuristic-only; precise counting lives in NMTP drivers.
 *
 * @module infra/tokenizer/logic/create-default-registry
 */

import { parseApplicationModelId } from "@/domain/provider/logic/application-model-id.js";
import { HeuristicTokenCounter } from "../impl/heuristic-token-counter.js";
import type { TokenCounter } from "../ports/token-counter.port.js";
import type {
  ForVendorModelOptions,
  TokenCounterRegistry,
} from "../ports/token-counter-registry.port.js";
import type { TokenizerOverride } from "./resolve-tokenizer-family.js";

/** Registry construction options. */
export interface CreateDefaultTokenCounterRegistryDeps {
  /** Optional override hook for tokenizer drivers/tests; product runtimes do not inject. */
  readonly getTokenizerOverride?: () => Promise<TokenizerOverride>;
}

class DefaultTokenCounterRegistry implements TokenCounterRegistry {
  readonly heuristic: TokenCounter = new HeuristicTokenCounter();
  readonly getTokenizerOverride: (() => Promise<TokenizerOverride>) | undefined;

  constructor(deps: CreateDefaultTokenCounterRegistryDeps) {
    this.getTokenizerOverride = deps.getTokenizerOverride;
  }

  async forApplicationModel(
    applicationModelId: string,
    _options?: ForVendorModelOptions,
  ): Promise<TokenCounter> {
    try {
      parseApplicationModelId(applicationModelId);
      return this.heuristic;
    } catch {
      return this.heuristic;
    }
  }

  forVendorModel(
    _vendorModelId: string,
    _options?: ForVendorModelOptions,
  ): TokenCounter {
    return this.heuristic;
  }
}

/** Creates a heuristic-only registry. */
export function createDefaultTokenCounterRegistry(
  deps: CreateDefaultTokenCounterRegistryDeps = {},
): TokenCounterRegistry {
  return new DefaultTokenCounterRegistry(deps);
}
