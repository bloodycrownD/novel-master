/**
 * Default token counter registry — routes by vendor model id, not provider protocol.
 *
 * @module infra/tokenizer/logic/create-default-registry
 */

import { parseApplicationModelId } from "@/domain/provider/logic/application-model-id.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import { HeuristicTokenCounter } from "../impl/heuristic-token-counter.js";
import { TiktokenTokenCounter } from "../impl/tiktoken-token-counter.js";
import { ClaudeWebTokenCounter } from "../impl/web-tokenizer-counter.js";
import { WebTokenizerCounter } from "../impl/web-tokenizer-counter.js";
import { SentencePieceTokenCounter } from "../impl/sentencepiece-token-counter.js";
import type { TokenCounter } from "../ports/token-counter.port.js";
import type {
  ForVendorModelOptions,
  TokenCounterRegistry,
} from "../ports/token-counter-registry.port.js";
import {
  resolveTokenizerFamily,
  type TokenizerOverride,
} from "./resolve-tokenizer-family.js";

let tiktokenLoadFailed = false;

/** Registry construction options. */
export interface CreateDefaultTokenCounterRegistryDeps {
  /** Reads `tokenCounter.mode` from preferences when set. */
  readonly getTokenizerOverride?: () => Promise<TokenizerOverride>;
}

class DefaultTokenCounterRegistry implements TokenCounterRegistry {
  readonly heuristic: TokenCounter = new HeuristicTokenCounter();
  private readonly vendorCounters = new Map<string, TokenCounter>();
  readonly getTokenizerOverride: (() => Promise<TokenizerOverride>) | undefined;

  constructor(deps: CreateDefaultTokenCounterRegistryDeps) {
    this.getTokenizerOverride = deps.getTokenizerOverride;
  }

  async forApplicationModel(
    applicationModelId: string,
    options?: ForVendorModelOptions,
  ): Promise<TokenCounter> {
    try {
      const { vendorModelId } = parseApplicationModelId(applicationModelId);
      return this.forVendorModel(vendorModelId, options);
    } catch {
      return this.heuristic;
    }
  }

  forVendorModel(
    vendorModelId: string,
    protocolOrOptions?: LlmProtocolKind | ForVendorModelOptions,
    legacyOptions?: ForVendorModelOptions,
  ): TokenCounter {
    const options = normalizeForVendorModelOptions(protocolOrOptions, legacyOptions);
    const override = options?.override ?? "auto";
    const family =
      override === "auto"
        ? resolveTokenizerFamily(vendorModelId, "auto")
        : resolveTokenizerFamily(vendorModelId, override);

    const cacheKey = `${family}:${vendorModelId}:${override}`;
    const cached = this.vendorCounters.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    const counter = this.createCounterForFamily(family, vendorModelId);
    this.vendorCounters.set(cacheKey, counter);
    return counter;
  }

  private createCounterForFamily(
    family: ReturnType<typeof resolveTokenizerFamily>,
    vendorModelId: string,
  ): TokenCounter {
    if (family === "heuristic") {
      return this.heuristic;
    }
    if (family === "tiktoken" || family === "gpt2") {
      try {
        return new TiktokenTokenCounter(vendorModelId);
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
    if (family === "claude") {
      return new ClaudeWebTokenCounter();
    }
    if (
      family === "llama3" ||
      family === "qwen2" ||
      family === "command-r" ||
      family === "command-a" ||
      family === "nemo" ||
      family === "deepseek"
    ) {
      return new WebTokenizerCounter(family);
    }
    if (
      family === "llama" ||
      family === "mistral" ||
      family === "yi" ||
      family === "gemma" ||
      family === "jamba"
    ) {
      return new SentencePieceTokenCounter(family);
    }
    return this.heuristic;
  }
}

function normalizeForVendorModelOptions(
  protocolOrOptions?: LlmProtocolKind | ForVendorModelOptions,
  legacyOptions?: ForVendorModelOptions,
): ForVendorModelOptions | undefined {
  if (protocolOrOptions == null) {
    return legacyOptions;
  }
  if (typeof protocolOrOptions === "string") {
    // Deprecated protocol arg — ignored; model name drives routing.
    return legacyOptions;
  }
  return protocolOrOptions;
}

/** Creates a registry with model-name routing and heuristic fallback. */
export function createDefaultTokenCounterRegistry(
  deps: CreateDefaultTokenCounterRegistryDeps = {},
): TokenCounterRegistry {
  return new DefaultTokenCounterRegistry(deps);
}

/** Resets one-shot tiktoken failure debug flag (tests). */
export function resetTiktokenLoadFailedFlag(): void {
  tiktokenLoadFailed = false;
}
