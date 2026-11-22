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
    DefaultTokenCounterRegistry,
} from "./logic/create-default-registry.js";
export {
    TokenizerFamilyResolver,
} from "./logic/resolve-tokenizer-family.js";
export { TokenizerTextCount } from "./logic/count-text-with-tokenizer.js";
export {
    IncrementalTokenCounter,
} from "./logic/incremental-token-counter.js";
export { ContextWindow } from "./logic/resolve-context-window.js";
export { ContextWindowSeed } from "./logic/seed-context-window-tokens.js";
export {
    CONTEXT_WINDOW_RULES,
    DEFAULT_CONTEXT_WINDOW_TOKENS,
} from "./logic/context-window-map.js";
export {
    PromptLlmInputCount,
    type CountPromptLlmInputParams,
    type PromptTokenCountResult,
} from "./logic/count-prompt-llm-input.js";
export {
    sessionApiPromptTokenCache,
} from "./logic/session-api-prompt-token-cache.js";
export { SessionApiPromptTokenEntry } from "./logic/session-api-prompt-token-store.js";
export { LastPromptUsage } from "./logic/pick-last-prompt-usage.js";
export {
    promptWholeCache,
    type PromptWholeCacheEntry,
} from "./logic/prompt-whole-cache.js";
export {
    tokenChunkCache,
    TokenChunkCache,
} from "./logic/token-chunk-cache.js";
// message-token-cache Step 3：双驱动块流程需要与 core 同源的确定性切分
// （golden 锁定行为），切分器本体不动、只接出导出面。
export { ChunkSplitter } from "./logic/chunk-splitter.js";
export {
    CurrentPromptTokens,
    type ResolvedPromptTokens,
    type ResolveCurrentPromptTokensOptions,
} from "./logic/resolve-current-prompt-tokens.js";
export { PromptTokens } from "./logic/resolve-prompt-tokens-with-backfill.js";
export { serializePromptLlmInput } from "./logic/serialize-prompt-input.js";
export { TokenCountTools } from "./logic/serialize-tools-for-token-count.js";
export {
    ChatTokenCount,
    type ChatTokenEncoder,
    type ChatTokenMessage,
    type ChatTokenCountKind,
    type CountTokensOptions,
} from "./logic/count-tokens.js";
export {
    OpenAiStyleMessageCount,
    type OpenAiStyleMessage,
} from "./logic/count-openai-style-message.js";
export {
    EncodingRegistry,
    type EncodingHandle,
} from "./encoding-registry.js";
export {
    TokenCounterModePref,
} from "./logic/read-token-counter-mode-pref.js";
export { TokenizerRegistry } from "../nmtp/index.js";
export type { TokenizerDriver } from "../nmtp/index.js";
