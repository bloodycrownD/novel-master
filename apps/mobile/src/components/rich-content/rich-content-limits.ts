/** Max UTF-16 length before rollback plain-text body shows over-limit hint. */
export const RICH_CONTENT_MAX_CHARS = 12_000;

/** Skip RenderHTML when body is too large (FlatList performance guard). */
export function isRichContentOverLimit(content: string): boolean {
  return content.length > RICH_CONTENT_MAX_CHARS;
}
