/**
 * Desktop renderer 对 `@novel-master/core/provider` 的具名薄再导出。
 * 禁止 `export *`；禁止 ProviderServiceFactory 等工厂。
 *
 * core 侧选项表 label 已是 descriptor（G3.3）：本层经 `coreT` 翻译成 string
 * 再导出，renderer 消费点零改动。
 */

import { THINKING_LEVEL_SELECT_OPTIONS as CORE_THINKING_LEVEL_OPTIONS, TOKEN_COUNTER_MODE_SELECT_OPTIONS as CORE_TOKEN_COUNTER_OPTIONS } from "@novel-master/core/provider";
import { coreT } from "./core-i18n.js";

export type {
    ModelSamplingParams,
    ThinkingLevel,
} from "@novel-master/core/provider";
export type { LlmProtocolKind } from "@novel-master/core/llm-protocol";
import type { TokenizerOverride } from "@novel-master/core/tokenizer";
export type { TokenizerOverride };

export { ProtocolSamplingDefaults } from "@novel-master/core/provider";
export { CHARACTERS_PER_TOKEN_RATIO } from "@novel-master/core/tokenizer";

export const THINKING_LEVEL_SELECT_OPTIONS = CORE_THINKING_LEVEL_OPTIONS.map((option) => ({ ...option, label: coreT(option.label) }));

// 显式注解（TS2883）：推断类型的 value 字段引用 core dist 深路径的 TokenizerOverride，
// 声明发射不可命名；用本模块已 import 的类型注解后引用落在可解析的子路径上。
export const TOKEN_COUNTER_MODE_SELECT_OPTIONS: ReadonlyArray<{ readonly value: TokenizerOverride; readonly label: string }> = CORE_TOKEN_COUNTER_OPTIONS.map((option) => ({ ...option, label: coreT(option.label) }));
