/**
 * 提示词超长折叠阈值与判定（R3：超长折叠 + 全屏编辑）。
 * 纯函数便于单测与调整；聚焦保持（失焦才折叠）由 ExpandablePromptInput 的状态处理。
 */
export const PROMPT_COLLAPSE_THRESHOLD = 600;

/** value 超过阈值时判定为折叠展示形态。 */
export function isPromptCollapsed(value: string): boolean {
  return value.length > PROMPT_COLLAPSE_THRESHOLD;
}
