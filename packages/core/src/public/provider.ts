/**
 * LLM Provider 与模型配置的公开入口（CRUD、采样参数、协议推断）。
 *
 * tokenizer 驱动注册请使用 `@novel-master/core/nmtp`；
 * feature flags 请使用 `@novel-master/core/feature-flags`。
 *
 * @module public/provider
 */

export { ProviderError } from "../errors/provider-errors.js";
export type { ProviderErrorCode } from "../errors/provider-errors.js";
export type { SecretStore } from "../infra/sksp/index.js";
export {
  parseApplicationModelId,
  formatApplicationModelId,
  normalizeVendorModelId,
} from "../domain/provider/logic/application-model-id.js";
export {
  assertSavedModelUuid,
  isSavedModelUuidFormat,
} from "../domain/provider/logic/assert-saved-model-uuid.js";
export { formatSavedModelDisplayName } from "../domain/provider/logic/format-saved-model-display-name.js";
export {
  inferLlmProtocolFromSavedModelId,
  inferLlmProtocolFromApplicationModelId,
} from "../domain/provider/logic/infer-llm-protocol-from-model-id.js";
export type { LlmProvider } from "../domain/provider/model/provider.js";
export { providerApiKeyRef } from "../domain/provider/model/provider.js";
export type {
  ModelSamplingParams,
  OpenAiSamplingParams,
  AnthropicSamplingParams,
  GeminiSamplingParams,
} from "../domain/provider/model/model-sampling-params.js";
export { samplingProtocol } from "../domain/provider/model/model-sampling-params.js";
export {
  mergeSamplingWithDefaults,
  maxOutputTokensFromSampling,
  OPENAI_SAMPLING_DEFAULTS,
  ANTHROPIC_SAMPLING_DEFAULTS,
  GEMINI_SAMPLING_DEFAULTS,
} from "../domain/provider/model/protocol-sampling-defaults.js";
export type { SavedModel } from "../domain/provider/model/saved-model.js";
export {
  savedModelDisplayName,
  toSavedModelView,
  type SavedModelView,
} from "../domain/provider/model/saved-model.js";
export type {
  SavedModelSettings,
  SavedModelSamplingSettings,
  ThinkingLevel,
  SavedModelInternalSettings,
  SavedModelGenerationSettings,
  SavedModelSettingsPatch,
} from "../domain/provider/model/saved-model-settings.js";
export {
  savedModelContextWindowTokens,
  savedModelTokenCounterMode,
  savedModelSampling,
  savedModelThinkingLevel,
  applySavedModelSettingsPatch,
} from "../domain/provider/model/saved-model-settings.js";
export {
  THINKING_LEVEL_OPTIONS,
  THINKING_LEVEL_SELECT_OPTIONS,
} from "../domain/provider/model/thinking-level-options.js";
export type {
  ModelThinkingParams,
  AnthropicThinkingParams,
  OpenAiThinkingParams,
  GeminiThinkingParams,
  GeminiThinkingConfig,
} from "../domain/provider/model/model-thinking-params.js";
export { thinkingProtocol } from "../domain/provider/model/model-thinking-params.js";
export {
  resolveEffectiveMaxTokens,
  resolveThinkingParamsForLevel,
} from "../domain/provider/logic/resolve-thinking-wire.js";
export { thinkingLevelToModelThinkingParams } from "../domain/provider/logic/thinking-level-presets.js";
export { defaultSavedModelSettings } from "../domain/provider/model/default-saved-model-settings.js";
export {
  savedModelSettingsFromJson,
  savedModelSettingsToJson,
} from "../domain/provider/model/saved-model-settings-from-json.js";
export {
  TOKEN_COUNTER_MODE_OPTIONS,
  TOKEN_COUNTER_MODE_SELECT_OPTIONS,
} from "../domain/provider/model/token-counter-mode-options.js";
export { resolveTokenCounterModeForModel } from "../service/provider/logic/resolve-token-counter-mode-for-model.js";
export type {
  ModelRetryPolicy,
  ModelRetryPolicyService,
} from "../service/provider/model-retry-policy.port.js";
export { createModelRetryPolicyService } from "../service/provider/create-model-retry-policy-service.js";
export { createProviderServices } from "../service/provider/create-provider-services.js";
export type { ProviderServiceBundle } from "../service/provider/create-provider-services.js";
export type {
  ProviderService,
  ProviderListItem,
  CreateProviderInput,
  EditProviderPatch,
} from "../service/provider/provider.port.js";
export type { ProviderModelService } from "../service/provider/provider-model.port.js";
export type { ModelRequestService, ModelRequestOptions } from "../service/provider/model-request.port.js";
export { formatLocalDateTime } from "../infra/date-format.js";
export type {
  LlmProtocolKind,
  LlmToolDefinition,
  LlmStreamEvent,
  LlmTokenUsage,
  LlmChatResult,
} from "../infra/llm-protocol/ports/adapter.port.js";
export { toolsFromRegistry } from "../infra/llm-protocol/logic/tool-definitions.js";
export { zodToJsonSchema } from "../infra/serialization/zod-to-json-schema.js";
export {
  clearProtocolAdapters,
  configureLlmFetch,
  getProtocolAdapter,
} from "../infra/llm-protocol/logic/registry.js";
export {
  createLoggingFetch,
  isLlmFetchDebugEnabled,
} from "../infra/llm-protocol/logic/debug-fetch.js";
export {
  createDefaultTokenCounterRegistry,
  HeuristicTokenCounter,
  CHARACTERS_PER_TOKEN_RATIO,
  serializePromptLlmInput,
  countPromptLlmInput,
  countPromptLlmInputHeuristicOnly,
  formatPromptTokenUsageLabel,
  resolveCurrentPromptTokens,
  pickLastPromptUsage,
  sessionApiPromptTokenCache,
  resolveTokenizerFamily,
  mapVendorModelIdToTiktokenModel,
  isGpt0301TiktokenModel,
  tokenizerAssetPaths,
  resolveContextWindowTokens,
  seedContextWindowTokens,
  getTokenizerDriver,
  resolveTokenizerDriver,
  clearTokenizerDrivers,
  TokenizerError,
  type TokenCounter,
  type TokenCounterRegistry,
  type TokenCounterKind,
  type TokenizerFamily,
  type TokenizerOverride,
  type CreateDefaultTokenCounterRegistryDeps,
  type CountPromptLlmInputParams,
  type PromptTokenCountResult,
  type PromptTokenSource,
  type ResolvedPromptTokens,
  type SessionApiPromptTokenCacheEntry,
  type TokenizerDriver,
  type TokenizerErrorCode,
} from "../infra/tokenizer/index.js";
export {
  parseTokenCounterModePref,
  isValidTokenCounterModePref,
  TOKEN_COUNTER_MODE_PREF_KEY,
} from "../infra/tokenizer/index.js";
