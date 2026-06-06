import MarkdownIt from 'markdown-it';
import {sanitizeRichHtml} from './sanitize-rich-html';

const markdown = new MarkdownIt({html: true, linkify: true});

/**
 * Markdown → sanitized HTML for WebView transcript bubbles (browser innerHTML).
 * Aligns with prepare-rich-html security rules; skips RN RenderHTML class materialization.
 */
export function prepareTranscriptRichHtml(content: string): string {
  return sanitizeRichHtml(markdown.render(content));
}
