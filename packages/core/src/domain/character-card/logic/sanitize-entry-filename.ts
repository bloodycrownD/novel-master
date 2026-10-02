/**
 * 世界书条目文件名清洗。
 *
 * @module domain/character-card/logic/sanitize-entry-filename
 */

// eslint-disable-next-line no-control-regex -- 故意剔除控制字符（文件名非法字符表的核心部分）
const ILLEGAL_CHARS = /[/\\:*?"<>|\x00-\x1f]/g;

/**
 * 清洗世界书标题基名：非法字符 → `_`，去掉首尾 `.` 与空格。
 * 空结果视为无效，返回 `undefined`。
 */
export function sanitizeEntryFilename(raw: string): string | undefined {
  const replaced = raw.replace(ILLEGAL_CHARS, "_");
  let trimmed = replaced.trim();
  while (trimmed.startsWith(".") || trimmed.endsWith(".")) {
    trimmed = trimmed.replace(/^\.+/, "").replace(/\.+$/, "").trim();
  }
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}
