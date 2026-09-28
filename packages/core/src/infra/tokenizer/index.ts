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
export {
  HeuristicTokenCounter,
  CHARACTERS_PER_TOKEN_RATIO,
} from "./impl/heuristic-token-counter.js";
export {
  createDefaultTokenCounterRegistry,
  type CreateDefaultTokenCounterRegistryDeps,
} from "./logic/create-default-registry.js";
export {
  resolveTokenizerFamily,
  mapVendorModelIdToTiktokenModel,
  isGpt0301TiktokenModel,
} from "./logic/resolve-tokenizer-family.js";
export { countTextWithIncrementalTokenizer } from "./logic/count-text-with-tokenizer.js";
export { resolveContextWindowTokens } from "./logic/resolve-context-window.js";
export { formatCounterKindLabel } from "./logic/format-counter-kind-label.js";
export { formatTokenSourceLabel } from "./logic/format-token-source-label.js";
export { seedContextWindowTokens } from "./logic/seed-context-window-tokens.js";
export {
  CONTEXT_WINDOW_RULES,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
} from "./logic/context-window-map.js";
export {
  countPromptLlmInput,
  countPromptLlmInputHeuristicOnly,
  formatPromptTokenUsageLabel,
  type CountPromptLlmInputParams,
  type PromptTokenCountResult,
} from "./logic/count-prompt-llm-input.js";
export {
  sessionApiPromptTokenCache,
  type SessionApiPromptTokenCacheEntry,
} from "./logic/session-api-prompt-token-cache.js";
export {
  serializeSessionApiPromptTokenEntry,
  parseSessionApiPromptTokenEntry,
  readSessionApiPromptTokenEntry,
  writeSessionApiPromptTokenEntry,
  invalidateSessionApiPromptTokenEntry,
  type SessionApiPromptTokenEntry,
} from "./logic/session-api-prompt-token-store.js";
export { pickLastPromptUsage } from "./logic/pick-last-prompt-usage.js";
export {
  promptWholeCache,
  PROMPT_WHOLE_CACHE_LRU_PER_SESSION,
  type PromptWholeCacheEntry,
} from "./logic/prompt-whole-cache.js";
export {
  tokenChunkCache,
  buildCounterScope,
  chunkHash16,
  parseTokenChunkCachePayload,
  CHUNK_CACHE_MAX_TOTAL_ENTRIES,
  type CounterScopeInput,
  type TokenChunkCacheItem,
  type AdvanceGenerationOptions,
} from "./logic/token-chunk-cache.js";
export {
  resolveCurrentPromptTokens,
  type PromptTokenSource,
  type ResolvedPromptTokens,
  type ResolveCurrentPromptTokensOptions,
} from "./logic/resolve-current-prompt-tokens.js";
export { resolvePromptTokensWithBackfill } from "./logic/resolve-prompt-tokens-with-backfill.js";
export { serializePromptLlmInput } from "./logic/serialize-prompt-input.js";
export { serializeToolsForTokenCount } from "./logic/serialize-tools-for-token-count.js";
export {
  countTokens,
  type ChatTokenEncoder,
  type ChatTokenMessage,
  type ChatTokenCountKind,
  type CountTokensOptions,
} from "./logic/count-tokens.js";
export {
  countOpenAiStyleMessages,
  wrapSerializedPromptAsSystemMessage,
  convertMessagesForWebTokenizer,
  countWebTokenizerMessages,
  type OpenAiStyleMessage,
  type CountOpenAiStyleMessageOptions,
  type TokenEncoder,
} from "./logic/count-openai-style-message.js";
export {
  getEncoding,
  clearForTests,
  setFactoryForTests,
  setClockForTests,
  ENCODING_RETRY_TTL_MS,
  type EncodingHandle,
  type EncodingFactory,
} from "./encoding-registry.js";
export { tokenizerAssetPaths } from "./logic/tokenizer-asset-paths.js";
export {
  parseTokenCounterModePref,
  isValidTokenCounterModePref,
  TOKEN_COUNTER_MODE_PREF_KEY,
} from "./logic/read-token-counter-mode-pref.js";
export {
  registerTokenizerDriver,
  getTokenizerDriver,
  resolveTokenizerDriver,
  clearTokenizerDrivers,
  TokenizerError,
} from "../nmtp/index.js";
export type { TokenizerDriver, TokenizerErrorCode } from "../nmtp/index.js";
