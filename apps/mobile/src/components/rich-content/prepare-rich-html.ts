import MarkdownIt from 'markdown-it';
import type {MixedStyleRecord} from 'react-native-render-html';
import {extractStyleBlocksFromHtml} from './extract-style-classes';
import {sanitizeRichHtml} from './sanitize-rich-html';

const markdown = new MarkdownIt({html: true, linkify: true});

export interface PreparedRichHtml {
  readonly html: string;
  /** From `<style>` blocks in source; merged with theme tagsStyles in RichContentBody. */
  readonly classesStyles: Record<string, MixedStyleRecord>;
}

/**
 * Converts Markdown (with embedded HTML) to sanitized HTML for RenderHTML.
 */
export function prepareRichHtml(content: string): PreparedRichHtml {
  const rawHtml = markdown.render(content);
  const {htmlWithoutStyle, classesStyles} = extractStyleBlocksFromHtml(rawHtml);
  return {
    html: sanitizeRichHtml(htmlWithoutStyle),
    classesStyles,
  };
}
