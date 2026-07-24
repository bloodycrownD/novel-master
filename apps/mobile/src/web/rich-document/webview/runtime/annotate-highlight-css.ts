/**
 * 注入 CSS Custom Highlight 样式（`::highlight(nm-annotate)`）。
 * 与 `.annotate-mark` 回退样式对齐：主色下划线。
 */

export const ANNOTATE_HIGHLIGHT_NAME = 'nm-annotate';

const STYLE_ID = 'nm-annotate-highlight-style';

const HIGHLIGHT_CSS = `
::highlight(${ANNOTATE_HIGHLIGHT_NAME}) {
  text-decoration: underline;
  text-decoration-color: var(--primary, #007aff);
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
  background-color: color-mix(in srgb, var(--primary, #007aff) 22%, transparent);
}
`.trim();

/** 确保文档内已注入 ::highlight 样式（幂等）。 */
export function ensureAnnotateHighlightCss(
  doc: Document = document,
): void {
  if (typeof doc?.getElementById !== 'function') {
    return;
  }
  if (doc.getElementById(STYLE_ID)) {
    return;
  }
  const head = doc.head ?? doc.getElementsByTagName('head')[0];
  if (!head || typeof doc.createElement !== 'function') {
    return;
  }
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = HIGHLIGHT_CSS;
  head.appendChild(style);
}
