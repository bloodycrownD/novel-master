/**
 * Unified prompt token count — delegates to NMTP driver registry.
 *
 * @module infra/tokenizer/logic/count-prompt-llm-input
 */

import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import type { PromptRenderContext } from "@/domain/prompt/model/prompt-render-context.js";
import { resolveTokenizerDriver } from "../../nmtp/logic/registry.js";
import type { TokenCounterKind, TokenizerFamily } from "../ports/token-counter.port.js";
import type { TokenCounterRegistry } from "../ports/token-counter-registry.port.js";
import type { TokenizerOverride } from "./resolve-tokenizer-family.js";
import { resolveTokenizerFamily } from "./resolve-tokenizer-family.js";
import { serializePromptLlmInput } from "./serialize-prompt-input.js";

export interface CountPromptLlmInputParams {
  readonly layout: AgentPromptLayout;
  readonly ctx: PromptRenderContext;
  readonly savedModelId: string;
  readonly registry: TokenCounterRegistry;
  readonly tokenizerOverride?: TokenizerOverride;
  /** When set, resolves vendor model id via {@link findById}. */
  readonly savedModels?: Pick<SavedModelRepository, "findById">;
}

export interface PromptTokenCountResult {
  readonly tokenCount: number;
  readonly counterKind: TokenCounterKind;
  readonly estimated: boolean;
  readonly savedModelId: string;
  readonly vendorModelId: string;
  readonly tokenizerFamily: TokenizerFamily;
}

/**
 * Counts tokens for a full prompt via registered NMTP driver (assembly serialize).
 */
export async function countPromptLlmInput(
  params: CountPromptLlmInputParams,
): Promise<PromptTokenCountResult> {
  return resolveTokenizerDriver().countPromptLlmInput(params);
}

async function resolveVendorModelIdFromSaved(
  savedModelId: string,
  savedModels?: Pick<SavedModelRepository, "findById">,
): Promise<string> {
  if (savedModels == null) {
    return savedModelId;
  }
  const saved = await savedModels.findById(savedModelId.trim());
  return saved?.vendorModelId ?? savedModelId;
}

/** Minimal fallback without a registered driver (tests / documentation). */
export async function countPromptLlmInputHeuristicOnly(
  params: CountPromptLlmInputParams,
): Promise<PromptTokenCountResult> {
  const { savedModelId, registry, layout, ctx } = params;
  const vendorModelId = await resolveVendorModelIdFromSaved(
    savedModelId,
    params.savedModels,
  );
  const family = resolveTokenizerFamily(vendorModelId, "auto");
  const serialized = await serializePromptLlmInput(layout, ctx);
  const tokenCount = registry.heuristic.countText(serialized);
  return {
    tokenCount,
    counterKind: "heuristic",
    estimated: true,
    savedModelId,
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
