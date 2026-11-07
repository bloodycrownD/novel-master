/**
 * Desktop renderer 对 `@novel-master/core/provider` 的具名薄再导出。
 * 禁止 `export *`；禁止 createProviderServices 等工厂。
 *
 * core 侧选项表 label 已是 descriptor（G3.3）：本层经 `coreT` 翻译成 string
 * 再导出，renderer 消费点零改动。
 */

import { THINKING_LEVEL_SELECT_OPTIONS as CORE_THINKING_LEVEL_OPTIONS, TOKEN_COUNTER_MODE_SELECT_OPTIONS as CORE_TOKEN_COUNTER_OPTIONS } from "@novel-master/core/provider";
import { coreT } from "./core-i18n.js";

export type {
  LlmProtocolKind,
  ModelSamplingParams,
  ThinkingLevel,
  TokenizerOverride,
} from "@novel-master/core/provider";

export { CHARACTERS_PER_TOKEN_RATIO, mergeSamplingWithDefaults } from "@novel-master/core/provider";

export const THINKING_LEVEL_SELECT_OPTIONS = CORE_THINKING_LEVEL_OPTIONS.map((option) => ({ ...option, label: coreT(option.label) }));

export const TOKEN_COUNTER_MODE_SELECT_OPTIONS = CORE_TOKEN_COUNTER_OPTIONS.map((option) => ({ ...option, label: coreT(option.label) }));
