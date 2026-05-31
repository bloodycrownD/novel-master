/**
 * Default token counter registry — live provider lookup + tiktoken fallback.
 *
 * Resolves protocol from {@link ProviderRepository} on every {@link forApplicationModel}
 * call so CLI provider edits apply without restarting the process.
 *
 * @module infra/tokenizer/logic/create-default-registry
 */

import { parseApplicationModelId } from "@/domain/provider/logic/application-model-id.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import { HeuristicTokenCounter } from "../impl/heuristic-token-counter.js";
import { TiktokenTokenCounter } from "../impl/tiktoken-token-counter.js";
import type { TokenCounter } from "../ports/token-counter.port.js";
import type { TokenCounterRegistry } from "../ports/token-counter-registry.port.js";

let tiktokenLoadFailed = false;

/** Repositories for live protocol / saved-model lookups (no snapshot at init). */
export interface CreateDefaultTokenCounterRegistryDeps {
  readonly providers: ProviderRepository;
  /** When set, unsaved application models fall back to heuristic. */
  readonly savedModels?: SavedModelRepository;
}

class DefaultTokenCounterRegistry implements TokenCounterRegistry {
  readonly heuristic: TokenCounter = new HeuristicTokenCounter();
  private readonly vendorCounters = new Map<string, TokenCounter>();

  constructor(private readonly deps: CreateDefaultTokenCounterRegistryDeps) {}

  async forApplicationModel(applicationModelId: string): Promise<TokenCounter> {
    try {
      const { providerId, vendorModelId } = parseApplicationModelId(applicationModelId);
      const provider = await this.deps.providers.findById(providerId);
      if (provider == null) {
        return this.heuristic;
      }
      if (this.deps.savedModels != null) {
        const saved = await this.deps.savedModels.find(providerId, vendorModelId);
        if (saved == null) {
          return this.heuristic;
        }
      }
      return this.forVendorModel(vendorModelId, provider.protocol);
    } catch {
      return this.heuristic;
    }
  }

  forVendorModel(vendorModelId: string, protocol: LlmProtocolKind): TokenCounter {
    if (protocol !== "openai") {
      return this.heuristic;
    }

    const cacheKey = `${protocol}:${vendorModelId}`;
    const cached = this.vendorCounters.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    try {
      const counter = new TiktokenTokenCounter(vendorModelId);
      this.vendorCounters.set(cacheKey, counter);
      return counter;
    } catch (err: unknown) {
      if (!tiktokenLoadFailed) {
        tiktokenLoadFailed = true;
        console.debug(
          "tiktoken unavailable, falling back to heuristic token counter:",
          err instanceof Error ? err.message : String(err),
        );
      }
      return this.heuristic;
    }
  }
}

/** Creates a registry with heuristic fallback and OpenAI-protocol tiktoken routing. */
export function createDefaultTokenCounterRegistry(
  deps: CreateDefaultTokenCounterRegistryDeps,
): TokenCounterRegistry {
  return new DefaultTokenCounterRegistry(deps);
}

/** Resets one-shot tiktoken failure debug flag (tests). */
export function resetTiktokenLoadFailedFlag(): void {
  tiktokenLoadFailed = false;
}
