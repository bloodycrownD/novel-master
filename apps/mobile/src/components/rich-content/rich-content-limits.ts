/** Max UTF-16 length before rollback plain-text body shows over-limit hint. */
export const RICH_CONTENT_MAX_CHARS = 12_000;

/**
 * WebView 文档预览的放宽阈值：浏览器内核整页渲染 + markdown-it 毫秒级解析，
 * 12k 的 RN RenderHTML / FlatList 护栏不适用于该路径——两三万字的小说章节
 * 远在阈值内，不应被误判「超长」回退纯文本。
 */
export const RICH_DOCUMENT_WEBVIEW_MAX_CHARS = 200_000;

/** Skip RenderHTML when body is too large (FlatList performance guard). */
export function isRichContentOverLimit(content: string): boolean {
  return content.length > RICH_CONTENT_MAX_CHARS;
}

/** WebView 文档预览的 over-limit 判定（见 {@link RICH_DOCUMENT_WEBVIEW_MAX_CHARS}）。 */
export function isWebViewDocumentOverLimit(content: string): boolean {
  return content.length > RICH_DOCUMENT_WEBVIEW_MAX_CHARS;
}
