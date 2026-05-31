/**
 * React Native shim for `tiktoken`: Metro/Hermes cannot load WASM.
 * Delegates to js-tiktoken (pure JS, same BPE) with snake_case API parity.
 */

import {Tiktoken, getEncodingNameForModel} from 'js-tiktoken/lite';
import * as cl100k_base from 'js-tiktoken/ranks/cl100k_base';
import * as o200k_base from 'js-tiktoken/ranks/o200k_base';

const rankModules = {
  cl100k_base,
  o200k_base,
};

/** @type {Map<string, import('js-tiktoken/lite').Tiktoken>} */
const encodingCache = new Map();

function loadRank(encodingName) {
  const rank = rankModules[encodingName];
  if (rank == null) {
    throw new Error(`Unsupported tiktoken encoding: ${encodingName}`);
  }
  return rank;
}

function getOrCreateEncoding(encodingName, extendSpecialTokens) {
  const cacheKey = `${encodingName}:${JSON.stringify(extendSpecialTokens ?? null)}`;
  let enc = encodingCache.get(cacheKey);
  if (enc == null) {
    enc = new Tiktoken(loadRank(encodingName), extendSpecialTokens);
    encodingCache.set(cacheKey, enc);
  }
  return enc;
}

function wrapEncoder(enc) {
  return {
    encode(text, allowedSpecial, disallowedSpecial) {
      return Uint32Array.from(enc.encode(text, allowedSpecial, disallowedSpecial));
    },
    encode_ordinary(text) {
      return Uint32Array.from(enc.encode(text));
    },
    free() {},
    name: undefined,
  };
}

export function encoding_for_model(model, extendSpecialTokens) {
  const encodingName = getEncodingNameForModel(model);
  return wrapEncoder(getOrCreateEncoding(encodingName, extendSpecialTokens));
}

export function get_encoding(encoding, extendSpecialTokens) {
  return wrapEncoder(getOrCreateEncoding(encoding, extendSpecialTokens));
}

export function get_encoding_name_for_model(model) {
  return getEncodingNameForModel(model);
}

export class TiktokenExport {
  free() {}

  encode() {
    throw new Error('Use encoding_for_model() instead of constructing Tiktoken directly');
  }
}

export {TiktokenExport as Tiktoken};
