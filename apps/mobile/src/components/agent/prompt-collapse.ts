/**
 * 提示词超长折叠阈值与判定（R3：超长折叠 + 全屏编辑；阈值改行数）。
 * 折叠判据从固定字符数改为实际内容高度：换行多字数少的文本（诗/列表）同样能正确折叠。
 * 纯函数便于单测与调整；聚焦保持（失焦才折叠）由 ExpandablePromptInput 的状态处理。
 */

/** 内联形态最多展示的行数，超过即视为超长（失焦后折叠）。 */
export const PROMPT_INLINE_MAX_LINES = 5;

/** 折叠预览的省略行数。 */
export const PROMPT_PREVIEW_LINES = 3;

/** 与表单输入的 lineHeight 对齐（FormTextInput：fontSize 16 / lineHeight 22）。 */
export const PROMPT_INLINE_LINE_HEIGHT = 22;

/** 内容实测高度超过 5 行（> 5*22=110）时判定为超长。 */
export function isPromptContentCollapsed(contentHeight: number): boolean {
  return contentHeight > PROMPT_INLINE_MAX_LINES * PROMPT_INLINE_LINE_HEIGHT;
}

/**
 * 未测量前的初判启发：换行符数超过 5 行直接初始折叠，
 * 避免长文首帧在高度上报前把表单撑开。实测高度上报后以实测为准。
 */
export function isPromptInitiallyCollapsed(value: string): boolean {
  return value.split('\n').length > PROMPT_INLINE_MAX_LINES;
}
