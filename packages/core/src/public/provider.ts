/**
 * LLM Provider 与模型配置的公开入口（CRUD、采样参数、协议推断）。
 *
 * tokenizer 驱动注册请使用 `@novel-master/core/nmtp`；
 * token 计数/编码符号走 `@novel-master/core/tokenizer`，协议层符号
 * （adapter、registry、SSE transport、isAbortLikeError）走
 * `@novel-master/core/llm-protocol`；
 * feature flags 请使用 `@novel-master/core/feature-flags`。
 *
 * @module public/provider
 */

export { ApplicationModelId } from "../domain/provider/logic/application-model-id.js";
export { SavedModelUuid } from "../domain/provider/logic/assert-saved-model-uuid.js";
export { SavedModelDisplayName } from "../domain/provider/logic/format-saved-model-display-name.js";
export { LlmProtocol } from "../domain/provider/logic/infer-llm-protocol-from-model-id.js";
export type { LlmProvider } from "../domain/provider/model/provider.js";
export { ProviderModel } from "../domain/provider/model/provider.js";
export type {
    ModelSamplingParams,
    OpenAiSamplingParams,
    AnthropicSamplingParams,
    GeminiSamplingParams,
} from "../domain/provider/model/model-sampling-params.js";
export {
    ProtocolSamplingDefaults,
    OPENAI_SAMPLING_DEFAULTS,
    ANTHROPIC_SAMPLING_DEFAULTS,
    GEMINI_SAMPLING_DEFAULTS,
} from "../domain/provider/model/protocol-sampling-defaults.js";
export { SavedModel } from "../domain/provider/model/saved-model.js";
export type {
    SavedModelSamplingSettings,
    ThinkingLevel,
    SavedModelSettingsPatch,
} from "../domain/provider/model/saved-model-settings.js";
export { SavedModelSettings } from "../domain/provider/model/saved-model-settings.js";
export {
    THINKING_LEVEL_SELECT_OPTIONS,
} from "../domain/provider/model/thinking-level-options.js";
export type {
    ModelThinkingParams,
    AnthropicThinkingParams,
    OpenAiThinkingParams,
    GeminiThinkingParams,
    GeminiThinkingConfig,
} from "../domain/provider/model/model-thinking-params.js";
export { ThinkingWire } from "../domain/provider/logic/resolve-thinking-wire.js";
export { ThinkingLevelPresets } from "../domain/provider/logic/thinking-level-presets.js";
export { DefaultSavedModelSettings } from "../domain/provider/model/default-saved-model-settings.js";
export { SavedModelSettingsJson } from "../domain/provider/model/saved-model-settings-from-json.js";
export {
    TOKEN_COUNTER_MODE_SELECT_OPTIONS,
} from "../domain/provider/model/token-counter-mode-options.js";
export { TokenCounterMode } from "../service/provider/logic/resolve-token-counter-mode-for-model.js";
export type {
    ModelRetryPolicy,
    ModelRetryPolicyService,
} from "../service/provider/model-retry-policy.port.js";
export { ProviderServiceFactory } from "../service/provider/provider-service-factory.js";
export type { ProviderServiceBundle } from "../service/provider/provider-service-factory.js";
export type {
    ProviderService,
    ProviderListItem,
    CreateProviderInput,
    EditProviderPatch,
} from "../service/provider/provider.port.js";
export type { ProviderModelService } from "../service/provider/provider-model.port.js";
export type {
    ModelRequestService,
    ModelRequestOptions,
} from "../service/provider/model-request.port.js";
export { SerializationZodToJsonSchema } from "@/common/serialization/zod-to-json-schema.js";
