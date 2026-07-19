import MarkdownIt from 'markdown-it';
import {
  decodeAfterSanitize,
  decodeForMarkdownInput,
} from './decode-literal-html-entities';
import {sanitizeRichHtml} from './sanitize-rich-html';

const markdown = new MarkdownIt({html: true, linkify: true});

/**
 * Markdown → 消毒 HTML，供 WebView transcript 气泡（browser innerHTML）。
 * 顺序：入口完整 decode → markdown-it → sanitize(escape) → 出口 decode（保留 &lt;/&gt;）。
 * 安全规则与 prepare-rich-html 对齐；不做 RN RenderHTML 的 class 物化。
 */
export function prepareTranscriptRichHtml(content: string): string {
  const normalized = decodeForMarkdownInput(content);
  const sanitized = sanitizeRichHtml(markdown.render(normalized));
  // sanitize-html 可能把 markdown-it 的 &quot; 变成 &amp;quot; — 出口仍解 quot/amp
  return decodeAfterSanitize(sanitized);
}
