/**
 * Token counting infra — ports, implementations, and registry factory.
 *
 * @module infra/tokenizer
 */

export type { TokenCounter, TokenCounterKind } from "./ports/token-counter.port.js";
export type { TokenCounterRegistry } from "./ports/token-counter-registry.port.js";
export { HeuristicTokenCounter } from "./impl/heuristic-token-counter.js";
export { TiktokenTokenCounter, clearTiktokenEncodingCache } from "./impl/tiktoken-token-counter.js";
export {
  createDefaultTokenCounterRegistry,
  resetTiktokenLoadFailedFlag,
  type CreateDefaultTokenCounterRegistryDeps,
} from "./logic/create-default-registry.js";
export {
  mapVendorModelIdToTiktokenModel,
  isGpt0301TiktokenModel,
} from "./logic/tiktoken-model-map.js";
export { serializePromptLlmInput } from "./logic/serialize-prompt-input.js";
