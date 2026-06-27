/**
 * 模型设置 UI 可用的思考强度档位选项。
 *
 * @module domain/provider/model/thinking-level-options
 */

import type { ThinkingLevel } from "./saved-model-settings.js";

/** 持久化至 DB 的思考强度档位枚举。 */
export const THINKING_LEVEL_OPTIONS = [
  "off",
  "low",
  "medium",
  "high",
] as const satisfies readonly ThinkingLevel[];

/** 档位 value + 中文标签（Desktop / Mobile 分段控件）。 */
export const THINKING_LEVEL_SELECT_OPTIONS: ReadonlyArray<{
  readonly value: ThinkingLevel;
  readonly label: string;
}> = [
  { value: "off", label: "关" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];
