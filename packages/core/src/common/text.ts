/**
 * 通用文本截断纯工具。
 *
 * @module common/text
 */

/**
 * 超过 `maxChars` 时保留前 `maxChars` 个字符并追加省略号；未超长原样返回。
 * 输出长度上限是 `maxChars + 1`（省略号不计入 `maxChars`）。
 */
export function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}
