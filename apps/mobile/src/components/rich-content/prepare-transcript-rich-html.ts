import MarkdownIt from 'markdown-it';
import {decodeLiteralHtmlEntities} from './decode-literal-html-entities';
import {sanitizeRichHtml} from './sanitize-rich-html';

const markdown = new MarkdownIt({html: true, linkify: true});

/**
 * Markdown → sanitized HTML for WebView transcript bubbles (browser innerHTML).
 * Aligns with prepare-rich-html security rules; skips RN RenderHTML class materialization.
 */
export function prepareTranscriptRichHtml(content: string): string {
  const normalized = decodeLiteralHtmlEntities(content);
  const sanitized = sanitizeRichHtml(markdown.render(normalized));
  // sanitize-html can turn markdown-it's &quot; into &amp;quot; — decode for innerHTML.
  return decodeLiteralHtmlEntities(sanitized);
}
