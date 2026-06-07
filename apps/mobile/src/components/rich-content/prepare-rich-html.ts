import MarkdownIt from 'markdown-it';
import type {MixedStyleRecord} from 'react-native-render-html';
import {decodeLiteralHtmlEntities} from './decode-literal-html-entities';
import {extractStyleBlocksFromHtml} from './extract-style-classes';
import {liftInlineColorToInnerSpan} from './lift-inline-color';
import {materializeInlineColors} from './materialize-inline-colors';
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
  const rawHtml = markdown.render(decodeLiteralHtmlEntities(content));
  const {htmlWithoutStyle, classesStyles} = extractStyleBlocksFromHtml(rawHtml);
  const sanitized = liftInlineColorToInnerSpan(
    sanitizeRichHtml(htmlWithoutStyle),
  );
  return {
    html: materializeInlineColors(sanitized, classesStyles),
    classesStyles,
  };
}
