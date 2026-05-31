import MarkdownIt from 'markdown-it';
import {sanitizeRichHtml} from './sanitize-rich-html';

const markdown = new MarkdownIt({html: true, linkify: true});

/**
 * Converts Markdown (with embedded HTML) to sanitized HTML for RenderHTML.
 */
export function prepareRichHtml(content: string): string {
  const rawHtml = markdown.render(content);
  return sanitizeRichHtml(rawHtml);
}
