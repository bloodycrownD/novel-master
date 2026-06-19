import type {TranscriptRow} from './ChatTranscriptBridge';
import {prepareTranscriptRichHtml} from '@/components/rich-content/prepare-transcript-rich-html';

const richHtmlCache = new Map<string, string | undefined>();

function richHtmlCached(cacheKey: string, content: string): string | undefined {
  const hit = richHtmlCache.get(cacheKey);
  if (hit !== undefined) {
    return hit || undefined;
  }
  const html = prepareTranscriptRichHtml(content);
  richHtmlCache.set(cacheKey, html ?? '');
  return html;
}

/** Adds textHtml/thinkingHtml for assistant rows when richText is enabled. */
export function enrichTranscriptRows(
  rows: readonly TranscriptRow[],
  richText: boolean,
): readonly TranscriptRow[] {
  if (!richText) {
    return rows;
  }
  return rows.map(row => {
    if (row.kind !== 'message' || row.role !== 'assistant') {
      return row;
    }
    return {
      ...row,
      textHtml: row.text
        ? richHtmlCached(`${row.id}:text:${row.text}`, row.text)
        : undefined,
      thinkingHtml: row.thinking
        ? richHtmlCached(`${row.id}:thinking:${row.thinking}`, row.thinking)
        : undefined,
    };
  });
}
