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
export { ClaudeWebTokenCounter } from "./impl/web-tokenizer-counter.js";
export { WebTokenizerCounter } from "./impl/web-tokenizer-counter.js";
export { SentencePieceTokenCounter } from "./impl/sentencepiece-token-counter.js";
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
  type CountPromptLlmInputParams,
  type PromptTokenCountResult,
} from "./logic/count-prompt-llm-input.js";
export { serializePromptLlmInput } from "./logic/serialize-prompt-input.js";
export { createTokenizerLoader, tokenizerAssetPaths } from "./impl/create-tokenizer-loader.js";
export {
  readTokenCounterModeFromPreferences,
  parseTokenCounterModePref,
  TOKEN_COUNTER_MODE_PREF_KEY,
} from "./logic/read-token-counter-mode-pref.js";
