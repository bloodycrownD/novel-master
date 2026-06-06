/**
 * Node prompt token counting (`@agnai/*`, `tiktoken`) for NMTP driver.
 *
 * @module count-prompt-llm-input
 */

import {
  HeuristicTokenCounter,
  mapVendorModelIdToTiktokenModel,
  parseApplicationModelId,
  resolveTokenizerFamily,
  serializePromptLlmInput,
  type CountPromptLlmInputParams,
  type PromptTokenCountResult,
  type TokenCounterKind,
  type TokenizerFamily,
} from "@novel-master/core";
import { encoding_for_model, type Tiktoken } from "tiktoken";
import { countSentencePieceFamilyPrompt } from "./impl/sentencepiece-token-counter.js";
import { countWebFamilyPrompt } from "./impl/web-tokenizer-counter.js";
import {
  countOpenAiStyleMessages,
  wrapSerializedPromptAsSystemMessage,
} from "./logic/count-openai-style-message.js";

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

/** Full model-aware count using Node tokenizer libraries. */
export async function countPromptLlmInput(
  params: CountPromptLlmInputParams,
): Promise<PromptTokenCountResult> {
  const { blocks, ctx, applicationModelId, registry } = params;
  const { vendorModelId } = parseApplicationModelId(applicationModelId);
  const override =
    params.tokenizerOverride ??
    (await registry.getTokenizerOverride?.()) ??
    "auto";
  const family = resolveTokenizerFamily(vendorModelId, override);
  const serialized = serializePromptLlmInput(blocks, ctx);

  let tokenCount: number;
  let counterKind: TokenCounterKind;
  let estimated = false;

  try {
    if (family === "heuristic") {
      tokenCount = registry.heuristic.countText(serialized);
      counterKind = "heuristic";
      estimated = true;
    } else if (family === "tiktoken" || family === "gpt2") {
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
        return pack(applicationModelId, vendorModelId, family, tokenCount, counterKind, estimated);
      }
      tokenCount = countOpenAiStyleMessages(
        encoding,
        [wrapSerializedPromptAsSystemMessage(serialized)],
        tiktokenModel,
      );
      encoding.free();
      counterKind = "tiktoken";
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

  return pack(
    applicationModelId,
    vendorModelId,
    family,
    tokenCount,
    counterKind,
    estimated,
  );
}

function pack(
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
