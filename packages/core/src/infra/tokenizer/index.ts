/**
 * Token counting infra — ports, implementations, and registry factory.
 *
 * @module infra/tokenizer
 */

export type {
  TokenCounter,
  TokenCounterKind,
  TokenizerFamily,
} from "./ports/token-counter.port.js";
export type {
  TokenCounterRegistry,
  ForVendorModelOptions,
} from "./ports/token-counter-registry.port.js";
export type { TokenizerOverride } from "./logic/resolve-tokenizer-family.js";
export { HeuristicTokenCounter, CHARACTERS_PER_TOKEN_RATIO } from "./impl/heuristic-token-counter.js";
export { TiktokenTokenCounter, clearTiktokenEncodingCache } from "./impl/tiktoken-token-counter.js";
/** Node-only counters — not exported here (avoid Metro pulling `@agnai/sentencepiece-js`). */
export {
  createDefaultTokenCounterRegistry,
  resetTiktokenLoadFailedFlag,
  type CreateDefaultTokenCounterRegistryDeps,
} from "./logic/create-default-registry.js";
export {
  resolveTokenizerFamily,
  mapVendorModelIdToTiktokenModel,
  isGpt0301TiktokenModel,
} from "./logic/resolve-tokenizer-family.js";
export {
  resolveContextWindowTokens,
  resolveContextWindowTokensOrDefault,
} from "./logic/resolve-context-window.js";
export {
  CONTEXT_WINDOW_RULES,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
} from "./logic/context-window-map.js";
export {
  countPromptLlmInput,
  formatPromptTokenUsageLabel,
  NM_PROMPT_TOKEN_COUNTER_KEY,
  type CountPromptLlmInputParams,
  type PromptTokenCountResult,
  type PromptTokenCounterBridge,
} from "./logic/count-prompt-llm-input.js";
export { serializePromptLlmInput } from "./logic/serialize-prompt-input.js";
export {
  tokenizerAssetPaths,
  NM_TOKENIZER_LOADER_KEY,
  type TokenizerLoader,
} from "./impl/tokenizer-loader-shared.js";
export { getTokenizerLoader } from "./impl/get-tokenizer-loader.js";
export {
  readTokenCounterModeFromPreferences,
  parseTokenCounterModePref,
  TOKEN_COUNTER_MODE_PREF_KEY,
} from "./logic/read-token-counter-mode-pref.js";
