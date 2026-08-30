import type {TranscriptRow} from './ChatTranscriptBridge';
import {prepareTranscriptRichHtml} from '@/components/rich-content/prepare-transcript-rich-html';
import {createScopeKeyCache} from '@/services/scope-key-cache';

// 有界 LRU：空串编码「已算过但无 html」，命中时按 miss 返回 undefined。
const richHtmlCache = createScopeKeyCache<string>({maxEntries: 500});

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

/** Test-only: reset the bounded cache between cases. */
export function clearRichHtmlCacheForTests(): void {
  richHtmlCache.clearAll();
}
