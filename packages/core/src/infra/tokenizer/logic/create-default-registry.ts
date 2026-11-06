/**
 * Default token counter registry — heuristic-only; precise counting lives in NMTP drivers.
 *
 * @module infra/tokenizer/logic/create-default-registry
 */

import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import { HeuristicTokenCounter } from "../impl/heuristic-token-counter.js";
import type { TokenCounter } from "../ports/token-counter.port.js";
import type { ForVendorModelOptions, TokenCounterRegistry } from "../ports/token-counter-registry.port.js";
import type { TokenizerOverride } from "./resolve-tokenizer-family.js";

/** Registry construction options. */
interface CreateDefaultTokenCounterRegistryDeps {
  /** Optional override hook for tokenizer drivers/tests; product runtimes do not inject. */
  readonly getTokenizerOverride?: () => Promise<TokenizerOverride>;
  /** When set, resolves vendor model id from saved model UUID. */
  readonly savedModels?: Pick<SavedModelRepository, "findById">;
}

class DefaultTokenCounterRegistry implements TokenCounterRegistry {
  readonly heuristic: TokenCounter = new HeuristicTokenCounter();
  readonly getTokenizerOverride: (() => Promise<TokenizerOverride>) | undefined;
  private readonly savedModels:
    | Pick<SavedModelRepository, "findById">
    | undefined;

  constructor(deps: CreateDefaultTokenCounterRegistryDeps) {
    this.getTokenizerOverride = deps.getTokenizerOverride;
    this.savedModels = deps.savedModels;
  }

  /**
   * nm-style: keep-public — TokenCounterRegistry 端口实现，调用方按接口多态调用，不能内联到单一调用点。
   */
  async forSavedModel(savedModelId: string, _options?: ForVendorModelOptions): Promise<TokenCounter> {
    if (this.savedModels != null) {
      const saved = await this.savedModels.findById(savedModelId.trim());
      if (saved != null) {
        return this.forVendorModel(saved.vendorModelId, _options);
      }
    }
    return this.heuristic;
  }

  forVendorModel(_vendorModelId: string, _options?: ForVendorModelOptions): TokenCounter {
    return this.heuristic;
  }
}

/** Creates a heuristic-only registry. */
export function createDefaultTokenCounterRegistry(deps: CreateDefaultTokenCounterRegistryDeps = {}): TokenCounterRegistry {
  return new DefaultTokenCounterRegistry(deps);
}
