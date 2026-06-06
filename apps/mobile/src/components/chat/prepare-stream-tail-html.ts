import {isRichContentOverLimit} from '../rich-content/rich-content-limits';
import {prepareTranscriptRichHtml} from '../rich-content/prepare-transcript-rich-html';

/** Pre-render stream tail HTML on RN when richText is on; Web uses innerHTML incrementally. */
export function prepareStreamTailHtml(
  content: string,
  richText: boolean,
): string | undefined {
  if (!richText) {
    return undefined;
  }
  const trimmed = content.trim();
  if (!trimmed || isRichContentOverLimit(trimmed)) {
    return undefined;
  }
  return prepareTranscriptRichHtml(trimmed);
}
