/**
 * 提示词内联输入的限高常量（UX 简化：不再折叠，超出 5 行内部滚动）。
 * 全屏编辑入口由 ExpandablePromptInput 提供常驻按钮，无折叠态/失焦折叠/测量初判。
 */

/** 内联输入框最多展示的行数，超出部分在输入框内部滚动。 */
export const PROMPT_INLINE_MAX_LINES = 5;

/** 与表单输入的 lineHeight 对齐（FormTextInput：fontSize 16 / lineHeight 22）：5×22=110。 */
export const PROMPT_INLINE_MAX_HEIGHT = 110;
