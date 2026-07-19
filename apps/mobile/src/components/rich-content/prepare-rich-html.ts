import MarkdownIt from 'markdown-it';
import type {MixedStyleRecord} from 'react-native-render-html';
import {decodeForMarkdownInput} from './decode-literal-html-entities';
import {extractStyleBlocksFromHtml} from './extract-style-classes';
import {liftInlineColorToInnerSpan} from './lift-inline-color';
import {materializeInlineColors} from './materialize-inline-colors';
import {sanitizeRichHtml} from './sanitize-rich-html';

const markdown = new MarkdownIt({html: true, linkify: true});

export interface PreparedRichHtml {
  readonly html: string;
  /** 来自源中的 `<style>` 块；在 RichContentBody 中与主题 tagsStyles 合并。 */
  readonly classesStyles: Record<string, MixedStyleRecord>;
}

/**
 * 将 Markdown（可含嵌入 HTML）转为消毒后的 HTML，供 RenderHTML 使用。
 */
export function prepareRichHtml(content: string): PreparedRichHtml {
  const rawHtml = markdown.render(decodeForMarkdownInput(content));
  const {htmlWithoutStyle, classesStyles} = extractStyleBlocksFromHtml(rawHtml);
  const sanitized = liftInlineColorToInnerSpan(
    sanitizeRichHtml(htmlWithoutStyle),
  );
  return {
    html: materializeInlineColors(sanitized, classesStyles),
    classesStyles,
  };
}
