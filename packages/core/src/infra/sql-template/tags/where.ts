/**
 * `<where>` tag: strip leading AND/OR and prefix WHERE when content is non-empty.
 */

const LEADING_AND_OR = /^\s*(?:AND|OR)\b\s*/i;

/**
 * Removes repeated leading AND/OR tokens (case-insensitive).
 */
export function stripLeadingAndOr(content: string): string {
  let s = content;
  while (LEADING_AND_OR.test(s)) {
    s = s.replace(LEADING_AND_OR, "");
  }
  return s;
}

/**
 * Wraps inner SQL with WHERE when trimmed content is non-empty.
 */
export function wrapWhere(innerSql: string): string {
  const trimmed = innerSql.trim();
  if (!trimmed) return "";
  const body = stripLeadingAndOr(innerSql);
  const trimmedBody = body.trimStart();
  if (!trimmedBody) return "";
  return `WHERE ${trimmedBody}`;
}
