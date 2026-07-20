/**
 * Desktop renderer 对 `@novel-master/core/provider` 的具名薄再导出。
 * 禁止 `export *`；禁止 createProviderServices 等工厂。
 */

export type {
  LlmProtocolKind,
  ModelSamplingParams,
  ThinkingLevel,
  TokenizerOverride,
} from "@novel-master/core/provider";

export {
  mergeSamplingWithDefaults,
  THINKING_LEVEL_SELECT_OPTIONS,
  TOKEN_COUNTER_MODE_SELECT_OPTIONS,
} from "@novel-master/core/provider";
