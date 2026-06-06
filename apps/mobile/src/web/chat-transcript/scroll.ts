/**
 * Forward DOM scroll helpers for WebView transcript (no column-reverse / inverted).
 * nearBottom: distance from visual bottom ≤ threshold ⇒ stick on stream updates.
 */
export const NEAR_BOTTOM_THRESHOLD_PX = 80;

/** True when scrollTop is within threshold of the visual bottom. */
export function nearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  return offsetFromBottom(scrollTop, scrollHeight, clientHeight) <= threshold;
}

/** Pixels from visual bottom (DOM forward order: newest at bottom). */
export function offsetFromBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

/** Pin scroll to visual bottom (open session / stream follow). */
export function scrollTopForBottom(scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight);
}

/** After prepend: preserve reading position (M1; exported for tests). */
export function scrollTopAfterPrepend(
  previousScrollTop: number,
  previousScrollHeight: number,
  nextScrollHeight: number,
): number {
  return previousScrollTop + (nextScrollHeight - previousScrollHeight);
}
