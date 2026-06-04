/**
 * Metro-bundled tokenizer assets for Hermes (no Node `fs`).
 * Installed on globalThis before App via polyfills.
 */
import {NM_TOKENIZER_LOADER_KEY} from '@novel-master/core';

const resolveAssetSource =
  require('react-native/Libraries/Image/resolveAssetSource').default;

const claudeJson = require('../../../../packages/core/assets/tokenizers/claude.json');
const llama3Json = require('../../../../packages/core/assets/tokenizers/llama3.json');
const qwen2Json = require('../../../../packages/core/assets/tokenizers/web/qwen2.json');
const commandRJson = require('../../../../packages/core/assets/tokenizers/web/command-r.json');
const commandAJson = require('../../../../packages/core/assets/tokenizers/web/command-a.json');
const nemoJson = require('../../../../packages/core/assets/tokenizers/web/nemo.json');
const deepseekJson = require('../../../../packages/core/assets/tokenizers/web/deepseek.json');

const llamaModel = require('../../../../packages/core/assets/tokenizers/llama.model');
const mistralModel = require('../../../../packages/core/assets/tokenizers/mistral.model');
const yiModel = require('../../../../packages/core/assets/tokenizers/yi.model');
const gemmaModel = require('../../../../packages/core/assets/tokenizers/gemma.model');
const jambaModel = require('../../../../packages/core/assets/tokenizers/jamba.model');

/** @type {Record<string, object>} */
const JSON_ASSETS = {
  'claude.json': claudeJson,
  'llama3.json': llama3Json,
  'web/qwen2.json': qwen2Json,
  'web/command-r.json': commandRJson,
  'web/command-a.json': commandAJson,
  'web/nemo.json': nemoJson,
  'web/deepseek.json': deepseekJson,
};

/** @type {Record<string, number>} */
const MODEL_ASSETS = {
  'llama.model': llamaModel,
  'mistral.model': mistralModel,
  'yi.model': yiModel,
  'gemma.model': gemmaModel,
  'jamba.model': jambaModel,
};

function jsonToArrayBuffer(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** @returns {import('@novel-master/core').TokenizerLoader} */
export function createMobileTokenizerLoader() {
  return {
    readJson(relativePath) {
      const data = JSON_ASSETS[relativePath];
      if (data == null) {
        throw new Error(`Unknown tokenizer JSON asset: ${relativePath}`);
      }
      return jsonToArrayBuffer(data);
    },
    readModel(relativePath) {
      const moduleId = MODEL_ASSETS[relativePath];
      if (moduleId == null) {
        throw new Error(`Unknown tokenizer model asset: ${relativePath}`);
      }
      const source = resolveAssetSource(moduleId);
      if (source?.uri == null || source.uri === '') {
        throw new Error(`Failed to resolve asset URI for ${relativePath}`);
      }
      return source.uri;
    },
  };
}

/** Installs loader for {@link getTokenizerLoader} in core. */
export function installMobileTokenizerLoader() {
  globalThis[NM_TOKENIZER_LOADER_KEY] = createMobileTokenizerLoader();
}
