/**
 * 模型设置 UI 可用的思考强度档位选项。
 *
 * @module domain/provider/model/thinking-level-options
 */

import type { CoreMessageDescriptor } from "@/i18n/keys.js";
import type { ThinkingLevel } from "./saved-model-settings.js";

/** 持久化至 DB 的思考强度档位枚举。 */
export const THINKING_LEVEL_OPTIONS = ["off", "low", "medium", "high"] as const satisfies readonly ThinkingLevel[];

/** 档位 value + 标签 descriptor（Desktop / Mobile 分段控件，宿主 translator 渲染）。 */
export const THINKING_LEVEL_SELECT_OPTIONS: ReadonlyArray<{
  readonly value: ThinkingLevel;
  readonly label: CoreMessageDescriptor;
}> = [
  { value: "off", label: { key: "label.provider.thinking_level.off" } },
  { value: "low", label: { key: "label.provider.thinking_level.low" } },
  { value: "medium", label: { key: "label.provider.thinking_level.medium" } },
  { value: "high", label: { key: "label.provider.thinking_level.high" } },
];
