/**
 * Unified prompt token count — single product entry for CLI, Mobile, and compaction.
 *
 * @module infra/tokenizer/logic/count-prompt-llm-input
 */

import { parseApplicationModelId } from "@/domain/provider/logic/application-model-id.js";
import type { PromptLlmInput } from "@/service/prompt/render-prompt.js";
import type { TokenCounterKind, TokenizerFamily } from "../ports/token-counter.port.js";
import type { TokenCounterRegistry } from "../ports/token-counter-registry.port.js";
import {
  countOpenAiStyleMessages,
  wrapSerializedPromptAsSystemMessage,
} from "./count-openai-style-message.js";
import {
  resolveTokenizerFamily,
  mapVendorModelIdToTiktokenModel,
  type TokenizerOverride,
} from "./resolve-tokenizer-family.js";
import { serializePromptLlmInput } from "./serialize-prompt-input.js";
import { HeuristicTokenCounter } from "../impl/heuristic-token-counter.js";
import { countWebFamilyPrompt } from "../impl/web-tokenizer-counter.js";
import { countSentencePieceFamilyPrompt } from "../impl/sentencepiece-token-counter.js";
import { encoding_for_model, type Tiktoken } from "tiktoken";

export interface CountPromptLlmInputParams {
  readonly input: PromptLlmInput;
  readonly applicationModelId: string;
  readonly registry: TokenCounterRegistry;
  /** Default `auto` — only vendorModelId + registry override. */
  readonly tokenizerOverride?: TokenizerOverride;
}

export interface PromptTokenCountResult {
  readonly tokenCount: number;
  readonly counterKind: TokenCounterKind;
  /** True when heuristic or tokenizer load failed. */
  readonly estimated: boolean;
  readonly applicationModelId: string;
  readonly vendorModelId: string;
  readonly tokenizerFamily: TokenizerFamily;
}

const WEB_FAMILIES: ReadonlySet<TokenizerFamily> = new Set([
  "claude",
  "llama3",
  "qwen2",
  "command-r",
  "command-a",
  "nemo",
  "deepseek",
]);

const SP_FAMILIES: ReadonlySet<TokenizerFamily> = new Set([
  "llama",
  "mistral",
  "yi",
  "gemma",
  "jamba",
]);

/**
 * Counts tokens for a full {@link PromptLlmInput} using model-aware tokenizer routing.
 */
export async function countPromptLlmInput(
  params: CountPromptLlmInputParams,
): Promise<PromptTokenCountResult> {
  const { input, applicationModelId, registry } = params;
  const { vendorModelId } = parseApplicationModelId(applicationModelId);
  const override =
    params.tokenizerOverride ??
    (await registry.getTokenizerOverride?.()) ??
    "auto";
  const family = resolveTokenizerFamily(vendorModelId, override);
  const serialized = serializePromptLlmInput(input);

  let tokenCount: number;
  let counterKind: TokenCounterKind;
  let estimated = false;

  try {
    if (family === "heuristic") {
      tokenCount = registry.heuristic.countText(serialized);
      counterKind = "heuristic";
      estimated = true;
    } else if (family === "tiktoken" || family === "gpt2") {
      const counter = registry.forVendorModel(vendorModelId);
      const tiktokenModel = mapVendorModelIdToTiktokenModel(vendorModelId);
      let encoding: Tiktoken;
      try {
        encoding = encoding_for_model(
          tiktokenModel as Parameters<typeof encoding_for_model>[0],
        );
      } catch {
        tokenCount = registry.heuristic.countText(serialized);
        counterKind = "heuristic";
        estimated = true;
        return result(applicationModelId, vendorModelId, family, tokenCount, counterKind, estimated);
      }
      tokenCount = countOpenAiStyleMessages(
        encoding,
        [wrapSerializedPromptAsSystemMessage(serialized)],
        tiktokenModel,
      );
      encoding.free();
      counterKind = counter.kind;
    } else if (WEB_FAMILIES.has(family)) {
      const web = await countWebFamilyPrompt(family, serialized);
      tokenCount = web.count;
      counterKind = family;
      estimated = web.estimated;
    } else if (SP_FAMILIES.has(family)) {
      const sp = await countSentencePieceFamilyPrompt(family, serialized);
      tokenCount = sp.count;
      counterKind = family;
      estimated = sp.estimated;
    } else {
      tokenCount = registry.heuristic.countText(serialized);
      counterKind = "heuristic";
      estimated = true;
    }
  } catch {
    tokenCount = new HeuristicTokenCounter().countText(serialized);
    counterKind = "heuristic";
    estimated = true;
  }

  return result(
    applicationModelId,
    vendorModelId,
    family,
    tokenCount,
    counterKind,
    estimated,
  );
}

function result(
  applicationModelId: string,
  vendorModelId: string,
  tokenizerFamily: TokenizerFamily,
  tokenCount: number,
  counterKind: TokenCounterKind,
  estimated: boolean,
): PromptTokenCountResult {
  return {
    tokenCount,
    counterKind,
    estimated,
    applicationModelId,
    vendorModelId,
    tokenizerFamily,
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
