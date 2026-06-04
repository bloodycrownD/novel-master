/**
 * React Native prompt token counter (M1).
 *
 * Hermes cannot run @agnai/web-tokenizers or @agnai/sentencepiece-js (Node fs/url/WASM).
 * GPT families use js-tiktoken (Metro shim). WEB/SP families delegate to Android
 * NovelMasterTokenizer when available; otherwise heuristic + estimated.
 */
import {
  parseApplicationModelId,
  resolveTokenizerFamily,
  mapVendorModelIdToTiktokenModel,
  serializePromptLlmInput,
  CHARACTERS_PER_TOKEN_RATIO,
  NM_PROMPT_TOKEN_COUNTER_KEY,
} from '@novel-master/core';
import {encoding_for_model} from 'tiktoken';
import {countPromptViaNative, isNativeTokenizerAvailable} from './native-tokenizer';

/** WEB JSON families — M1 native on Android. */
const WEB_FAMILIES = new Set([
  'claude',
  'llama3',
  'qwen2',
  'command-r',
  'command-a',
  'nemo',
  'deepseek',
]);

/** SentencePiece families — M1 native on Android. */
const SP_FAMILIES = new Set(['llama', 'mistral', 'yi', 'gemma', 'jamba']);

function heuristicCount(text) {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN_RATIO);
}

function countTiktoken(serialized, vendorModelId) {
  const model = mapVendorModelIdToTiktokenModel(vendorModelId);
  const enc = encoding_for_model(model);
  try {
    const message = {role: 'system', content: serialized};
    let numTokens = 3;
    numTokens += enc.encode(message.content).length;
    numTokens += 3;
    enc.free();
    return {count: numTokens, counterKind: 'tiktoken', estimated: false};
  } catch {
    enc.free();
    return {count: heuristicCount(serialized), counterKind: 'heuristic', estimated: true};
  }
}

/**
 * Map native bridge payload to mobile counter shape.
 * @param {import('./native-tokenizer').NativeCountResponse} nativeResult
 */
function mapNativeResult(nativeResult) {
  return {
    count: nativeResult.tokenCount,
    counterKind: nativeResult.counterKind,
    estimated: nativeResult.estimated,
  };
}

async function countSerialized(family, serialized, vendorModelId) {
  if (family === 'heuristic') {
    return {count: heuristicCount(serialized), counterKind: 'heuristic', estimated: true};
  }
  // GPT path stays in JS — js-tiktoken is exact and Metro-safe (M0/M1).
  if (family === 'tiktoken' || family === 'gpt2') {
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
  return {count: heuristicCount(serialized), counterKind: 'heuristic', estimated: true};
}

/** @param {import('@novel-master/core').CountPromptLlmInputParams} params */
async function countPromptLlmInputMobile(params) {
  const {input, applicationModelId, registry} = params;
  const {vendorModelId} = parseApplicationModelId(applicationModelId);
  const override =
    params.tokenizerOverride ??
    (await registry.getTokenizerOverride?.()) ??
    'auto';
  const family = resolveTokenizerFamily(vendorModelId, override);
  const serialized = serializePromptLlmInput(input);
  const {count, counterKind, estimated} = await countSerialized(
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

export function installMobilePromptTokenCounter() {
  globalThis[NM_PROMPT_TOKEN_COUNTER_KEY] = {
    countPromptLlmInput: countPromptLlmInputMobile,
  };
}

// Test hooks
export const __test__ = {
  WEB_FAMILIES,
  SP_FAMILIES,
  countSerialized,
  heuristicCount,
};
