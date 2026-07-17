/**
 * Stream tail HTML field update for appendStreamDelta.
 * Returns null when the field should be left unchanged (rich text off, no new html).
 */
export function nextStreamTailHtmlField(
  richText: boolean,
  incomingHtml: string | undefined | null,
): string | null {
  if (incomingHtml) {
    return incomingHtml;
  }
  if (richText) {
    return '';
  }
  return null;
}
