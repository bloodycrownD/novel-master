import type {TranscriptRow} from './ChatTranscriptBridge';
import {prepareTranscriptRichHtml} from '../rich-content/prepare-transcript-rich-html';

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
      textHtml: row.text ? prepareTranscriptRichHtml(row.text) : undefined,
      thinkingHtml: row.thinking
        ? prepareTranscriptRichHtml(row.thinking)
        : undefined,
    };
  });
}
