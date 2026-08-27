/**
 * 提示词内联输入的限高常量（UX 简化：不再折叠，超出 8 行内部滚动）。
 * 全屏编辑入口由 ExpandablePromptInput 的 label 行右侧按钮提供，
 * 无折叠态/失焦折叠/测量初判。
 */

/** 内联输入框最多展示的行数，超出部分在输入框内部滚动。 */
export const PROMPT_INLINE_MAX_LINES = 8;

/** 与表单输入的 lineHeight 对齐（FormTextInput：fontSize 16 / lineHeight 22）：8×22=176。 */
export const PROMPT_INLINE_MAX_HEIGHT = 176;
