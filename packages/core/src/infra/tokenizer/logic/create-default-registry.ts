/**
 * Default token counter registry — protocol routing + tiktoken fallback.
 *
 * @module infra/tokenizer/logic/create-default-registry
 */

import { parseApplicationModelId } from "@/domain/provider/logic/application-model-id.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import { HeuristicTokenCounter } from "../impl/heuristic-token-counter.js";
import { TiktokenTokenCounter } from "../impl/tiktoken-token-counter.js";
import type { TokenCounter } from "../ports/token-counter.port.js";
import type { TokenCounterRegistry } from "../ports/token-counter-registry.port.js";

let tiktokenLoadFailed = false;

/** Sync lookups populated at runtime from provider / saved-model repos. */
export interface CreateDefaultTokenCounterRegistryDeps {
  /** Provider protocol by id; missing → heuristic for that model. */
  readonly resolveProviderProtocol: (providerId: string) => LlmProtocolKind | undefined;
  /** When set, unsaved models fall back to heuristic. */
  readonly isSavedModel?: (providerId: string, vendorModelId: string) => boolean;
}

class DefaultTokenCounterRegistry implements TokenCounterRegistry {
  readonly heuristic: TokenCounter = new HeuristicTokenCounter();
  private readonly vendorCounters = new Map<string, TokenCounter>();

  constructor(private readonly deps: CreateDefaultTokenCounterRegistryDeps) {}

  forApplicationModel(applicationModelId: string): TokenCounter {
    try {
      const { providerId, vendorModelId } = parseApplicationModelId(applicationModelId);
      const protocol = this.deps.resolveProviderProtocol(providerId);
      if (protocol == null) {
        return this.heuristic;
      }
      if (
        this.deps.isSavedModel != null &&
        !this.deps.isSavedModel(providerId, vendorModelId)
      ) {
        return this.heuristic;
      }
      return this.forVendorModel(vendorModelId, protocol);
    } catch {
      return this.heuristic;
    }
  }

  forVendorModel(vendorModelId: string, protocol: LlmProtocolKind): TokenCounter {
    // L1: non-openai protocols always use heuristic (gemini/anthropic this iteration).
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

/**
 * Creates a registry with heuristic fallback and OpenAI-protocol tiktoken routing.
 */
export function createDefaultTokenCounterRegistry(
  deps: CreateDefaultTokenCounterRegistryDeps,
): TokenCounterRegistry {
  return new DefaultTokenCounterRegistry(deps);
}

/** Resets one-shot tiktoken failure debug flag (tests). */
export function resetTiktokenLoadFailedFlag(): void {
  tiktokenLoadFailed = false;
}
