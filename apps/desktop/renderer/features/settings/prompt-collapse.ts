/**
 * 提示词折叠行数语义常量（desktop）。
 *
 * desktop 的折叠判据以 DOM 实测为准：内联 textarea 内容溢出可视高度
 * （scrollHeight > clientHeight，即 rows/min-height 决定的可见行数装不下内容）
 * 即视为超长，失焦后折叠为 3 行省略预览。溢出即超过约 4~5 行，
 * 语义上与「超过 5 行折叠」对齐，不精确数行。
 *
 * 这里的常量不参与运行时判定，仅作语义文档与保守初判的参照。
 */

/** 折叠态预览显示的省略行数。 */
export const PROMPT_PREVIEW_LINES = 3;

/** 内联编辑可容纳的最大行数，内容超过（约）该行数即折叠。 */
export const PROMPT_INLINE_MAX_LINES = 5;
