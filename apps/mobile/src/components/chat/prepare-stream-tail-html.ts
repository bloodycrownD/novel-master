import {isRichContentOverLimit} from '@/components/rich-content/rich-content-limits';
import {prepareTranscriptRichHtml} from '@/components/rich-content/prepare-transcript-rich-html';

/** Pre-render stream tail HTML on RN when richText is on; Web applies `.rich` class for typography. */
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
