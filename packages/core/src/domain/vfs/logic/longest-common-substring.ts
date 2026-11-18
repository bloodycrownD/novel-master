/**
 * edit 失败诊断的 LCS 阈值（算法本体在 `common/text.ts` 的 `Text.longestCommonSubstring`）。
 *
 * 这里只留 VFS 域的诊断 / 展示口径：多短的公共子串算「几乎无匹配」、snippet 截到多少字符。
 *
 * @module domain/vfs/logic/longest-common-substring
 */

/** 低于此长度的公共子串视为「几乎无匹配」。 */
export const MIN_LCS_LENGTH = 4;

/** LLM / 用户可见 snippet 展示上限。 */
export const MAX_LCS_SNIPPET_CHARS = 200;
