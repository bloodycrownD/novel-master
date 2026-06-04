/**
 * React Native prompt token counter — no Node `fs` / no `@agnai/sentencepiece-js`.
 *
 * Uses js-tiktoken (shim), @agnai/web-tokenizers for JSON families, heuristic for SentencePiece families.
 */
import {
  parseApplicationModelId,
  resolveTokenizerFamily,
  mapVendorModelIdToTiktokenModel,
  serializePromptLlmInput,
  CHARACTERS_PER_TOKEN_RATIO,
  NM_PROMPT_TOKEN_COUNTER_KEY,
  tokenizerAssetPaths,
} from '@novel-master/core';
import {encoding_for_model} from 'tiktoken';
import {Tokenizer} from '@agnai/web-tokenizers';

const WEB_FAMILIES = new Set([
  'claude',
  'llama3',
  'qwen2',
  'command-r',
  'command-a',
  'nemo',
  'deepseek',
]);

const SP_FAMILIES = new Set(['llama', 'mistral', 'yi', 'gemma', 'jamba']);

function heuristicCount(text) {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN_RATIO);
}

function getAssetLoader() {
  const loader = globalThis[NM_TOKENIZER_LOADER_KEY];
  if (loader?.readJson == null || loader?.readModel == null) {
    throw new Error('Tokenizer asset loader not installed');
  }
  return loader;
}

/** @type {Map<string, import('@agnai/web-tokenizers').Tokenizer>} */
const webTokenizerCache = new Map();

async function getWebTokenizer(family) {
  const cached = webTokenizerCache.get(family);
  if (cached != null) {
    return cached;
  }
  const paths = tokenizerAssetPaths(family);
  if (paths == null || paths.kind !== 'json') {
    return null;
  }
  const loader = getAssetLoader();
  try {
    const primary = loader.readJson(paths.primary);
    const instance = await Tokenizer.fromJSON(primary);
    webTokenizerCache.set(family, instance);
    return instance;
  } catch {
    if (paths.fallback != null) {
      try {
        const fallback = loader.readJson(paths.fallback);
        const instance = await Tokenizer.fromJSON(fallback);
        webTokenizerCache.set(family, instance);
        return instance;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function countWebMessage(instance, serialized) {
  const message = {role: 'system', content: serialized};
  const isClaude = false;
  let tokens = 0;
  const perMessage = 3;
  tokens += perMessage;
  tokens += instance.encode(message.content).length;
  tokens += 3;
  return tokens;
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
  if (family === 'tiktoken' || family === 'gpt2') {
    return countTiktoken(serialized, vendorModelId);
  }
  if (WEB_FAMILIES.has(family)) {
    const instance = await getWebTokenizer(family);
    if (instance == null) {
      return {count: heuristicCount(serialized), counterKind: 'heuristic', estimated: true};
    }
    return {count: countWebMessage(instance, serialized), counterKind: family, estimated: false};
  }
  if (SP_FAMILIES.has(family)) {
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
