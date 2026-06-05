/**
 * React Native prompt token counter (NMTP RN driver).
 *
 * Hermes cannot run @agnai/web-tokenizers or @agnai/sentencepiece-js (Node fs/url/WASM).
 * GPT families lazy-load js-tiktoken on first use (Metro shim). WEB/SP delegate to Android
 * NovelMasterTokenizer when available; otherwise heuristic + estimated.
 */
import {
  CHARACTERS_PER_TOKEN_RATIO,
  parseApplicationModelId,
  resolveTokenizerFamily,
  mapVendorModelIdToTiktokenModel,
  serializePromptLlmInput,
  type CountPromptLlmInputParams,
  type PromptTokenCountResult,
  type TokenCounterKind,
  type TokenizerFamily,
} from "@novel-master/core";
import {
  countPromptViaNative,
  isNativeTokenizerAvailable,
  type NativeCountResponse,
} from "./android-native-bridge.js";

type TiktokenModule = {
  encoding_for_model: (
    model: string,
  ) => { encode: (text: string) => { length: number }; free: () => void };
};

let tiktokenModule: TiktokenModule | null = null;

async function getTiktoken(): Promise<TiktokenModule> {
  if (tiktokenModule == null) {
    tiktokenModule = (await import("tiktoken")) as TiktokenModule;
  }
  return tiktokenModule;
}

/** WEB JSON families — M1 native on Android. */
const WEB_FAMILIES: ReadonlySet<TokenizerFamily> = new Set([
  "claude",
  "llama3",
  "qwen2",
  "command-r",
  "command-a",
  "nemo",
  "deepseek",
]);

/** SentencePiece families — M1 native on Android. */
const SP_FAMILIES: ReadonlySet<TokenizerFamily> = new Set([
  "llama",
  "mistral",
  "yi",
  "gemma",
  "jamba",
]);

function heuristicCount(text: string): number {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN_RATIO);
}

interface SerializedCountResult {
  count: number;
  counterKind: TokenCounterKind;
  estimated: boolean;
}

async function countTiktoken(
  serialized: string,
  vendorModelId: string,
): Promise<SerializedCountResult> {
  const { encoding_for_model } = await getTiktoken();
  const model = mapVendorModelIdToTiktokenModel(vendorModelId);
  const enc = encoding_for_model(model);
  try {
    const message = { role: "system", content: serialized };
    let numTokens = 3;
    numTokens += enc.encode(message.content).length;
    numTokens += 3;
    enc.free();
    return { count: numTokens, counterKind: "tiktoken", estimated: false };
  } catch {
    enc.free();
    return {
      count: heuristicCount(serialized),
      counterKind: "heuristic",
      estimated: true,
    };
  }
}

function mapNativeResult(nativeResult: NativeCountResponse): SerializedCountResult {
  return {
    count: nativeResult.tokenCount,
    counterKind: nativeResult.counterKind as TokenCounterKind,
    estimated: nativeResult.estimated,
  };
}

async function countSerialized(
  family: TokenizerFamily,
  serialized: string,
  vendorModelId: string,
): Promise<SerializedCountResult> {
  if (family === "heuristic") {
    return {
      count: heuristicCount(serialized),
      counterKind: "heuristic",
      estimated: true,
    };
  }
  // GPT path stays in JS — js-tiktoken is exact and Metro-safe (M0/M1).
  if (family === "tiktoken" || family === "gpt2") {
    return countTiktoken(serialized, vendorModelId);
  }
  if (WEB_FAMILIES.has(family) || SP_FAMILIES.has(family)) {
    if (isNativeTokenizerAvailable()) {
      const nativeResult = await countPromptViaNative({
        serialized,
        family,
        vendorModelId,
      });
      if (nativeResult != null) {
        return mapNativeResult(nativeResult);
      }
    }
    return {
      count: heuristicCount(serialized),
      counterKind: family,
      estimated: true,
    };
  }
  return {
    count: heuristicCount(serialized),
    counterKind: "heuristic",
    estimated: true,
  };
}

/** RN NMTP driver entry: model-aware prompt token counting. */
export async function countPromptLlmInputRn(
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
  const { count, counterKind, estimated } = await countSerialized(
    family,
    serialized,
    vendorModelId,
  );
  return {
    tokenCount: count,
    counterKind,
    estimated,
    applicationModelId,
    vendorModelId,
    tokenizerFamily: family,
  };
}

/** Test hooks for Jest (mobile + driver unit tests). */
export const __test__ = {
  WEB_FAMILIES,
  SP_FAMILIES,
  countSerialized,
  heuristicCount,
  /** Jest cannot run `import('tiktoken')`; prime the lazy cache from require(). */
  setTiktokenModuleForTests(mod: TiktokenModule): void {
    tiktokenModule = mod;
  },
  resetTiktokenModuleForTests(): void {
    tiktokenModule = null;
  },
};
