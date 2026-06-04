/**
 * Unified prompt token count — delegates to platform bridge (Mobile / CLI) or Node impl.
 *
 * @module infra/tokenizer/logic/count-prompt-llm-input
 */

import { parseApplicationModelId } from "@/domain/provider/logic/application-model-id.js";
import type { PromptLlmInput } from "@/service/prompt/render-prompt.js";
import type { TokenCounterKind, TokenizerFamily } from "../ports/token-counter.port.js";
import type { TokenCounterRegistry } from "../ports/token-counter-registry.port.js";
import type { TokenizerOverride } from "./resolve-tokenizer-family.js";
import { resolveTokenizerFamily } from "./resolve-tokenizer-family.js";
import { serializePromptLlmInput } from "./serialize-prompt-input.js";
/** Installed by Mobile polyfills or CLI before counting (avoids `@agnai/sentencepiece-js` on RN). */
export const NM_PROMPT_TOKEN_COUNTER_KEY = "__NM_PROMPT_TOKEN_COUNTER__";

export interface CountPromptLlmInputParams {
  readonly input: PromptLlmInput;
  readonly applicationModelId: string;
  readonly registry: TokenCounterRegistry;
  readonly tokenizerOverride?: TokenizerOverride;
}

export interface PromptTokenCountResult {
  readonly tokenCount: number;
  readonly counterKind: TokenCounterKind;
  readonly estimated: boolean;
  readonly applicationModelId: string;
  readonly vendorModelId: string;
  readonly tokenizerFamily: TokenizerFamily;
}

/** Platform implements full model-aware counting without Node-only deps. */
export interface PromptTokenCounterBridge {
  countPromptLlmInput(
    params: CountPromptLlmInputParams,
  ): Promise<PromptTokenCountResult>;
}

function injectedPromptTokenCounter(): PromptTokenCounterBridge | undefined {
  const g = globalThis as Record<string, unknown>;
  const bridge = g[NM_PROMPT_TOKEN_COUNTER_KEY];
  if (
    bridge != null &&
    typeof bridge === "object" &&
    typeof (bridge as PromptTokenCounterBridge).countPromptLlmInput === "function"
  ) {
    return bridge as PromptTokenCounterBridge;
  }
  return undefined;
}

/**
 * Counts tokens for a full {@link PromptLlmInput}.
 * RN always uses {@link PromptTokenCounterBridge}; Node falls back to dynamic import when unset.
 */
export async function countPromptLlmInput(
  params: CountPromptLlmInputParams,
): Promise<PromptTokenCountResult> {
  const bridge = injectedPromptTokenCounter();
  if (bridge != null) {
    return bridge.countPromptLlmInput(params);
  }

  const { countPromptLlmInputNode } = await import("./count-prompt-llm-input-node.js");
  return countPromptLlmInputNode(params);
}

/** Minimal fallback when bridge missing and dynamic import fails (tests). */
export async function countPromptLlmInputHeuristicOnly(
  params: CountPromptLlmInputParams,
): Promise<PromptTokenCountResult> {
  const { applicationModelId, registry, input } = params;
  const { vendorModelId } = parseApplicationModelId(applicationModelId);
  const family = resolveTokenizerFamily(vendorModelId, "auto");
  const serialized = serializePromptLlmInput(input);
  const tokenCount = registry.heuristic.countText(serialized);
  return {
    tokenCount,
    counterKind: "heuristic",
    estimated: true,
    applicationModelId,
    vendorModelId,
    tokenizerFamily: family,
  };
}

/** Formats prompt token usage label: percentage when context window known. */
export function formatPromptTokenUsageLabel(
  count: number,
  contextWindowTokens?: number,
  options?: { readonly estimated?: boolean },
): string {
  const prefix = options?.estimated ? "~" : "";
  const current = formatCompact(count);
  if (contextWindowTokens == null || contextWindowTokens <= 0) {
    return options?.estimated
      ? `${prefix}${current} tokens (est.)`
      : `${current} tokens`;
  }
  const pct = Math.min(999, Math.round((count / contextWindowTokens) * 100));
  return `${prefix}${pct}% • ${current}/${formatCompact(contextWindowTokens)}`;
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "—";
  }
  const rounded = Math.round(n);
  if (rounded < 1000) {
    return String(rounded);
  }
  if (rounded < 1_000_000) {
    const k = rounded / 1000;
    if (k >= 100) {
      return `${Math.round(k)}K`;
    }
    return `${String(k.toFixed(1)).replace(/\.0$/, "")}K`;
  }
  const m = rounded / 1_000_000;
  if (m >= 100) {
    return `${Math.round(m)}M`;
  }
  return `${String(m.toFixed(1)).replace(/\.0$/, "")}M`;
}
