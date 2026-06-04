/**
 * React Native prompt token counter (M0).
 *
 * Hermes cannot run @agnai/web-tokenizers or @agnai/sentencepiece-js (Node fs/url/WASM).
 * GPT families use js-tiktoken (Metro shim); all other families use heuristic until M1
 * Android native TokenizerModule replaces WEB/SP counting.
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

/** WEB JSON families — M1 will delegate to native; M0 uses heuristic + estimated. */
const WEB_FAMILIES = new Set([
  'claude',
  'llama3',
  'qwen2',
  'command-r',
  'command-a',
  'nemo',
  'deepseek',
]);

/** SentencePiece families — M1 native; M0 heuristic + estimated. */
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

async function countSerialized(family, serialized, vendorModelId) {
  if (family === 'heuristic') {
    return {count: heuristicCount(serialized), counterKind: 'heuristic', estimated: true};
  }
  // Only GPT path is exact in RN; js-tiktoken is the sole @agnai-free tokenizer lib.
  if (family === 'tiktoken' || family === 'gpt2') {
    return countTiktoken(serialized, vendorModelId);
  }
  // M0: no @agnai/* in bundle — WEB/SP families are estimated until M1 native bridge.
  if (WEB_FAMILIES.has(family) || SP_FAMILIES.has(family)) {
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
