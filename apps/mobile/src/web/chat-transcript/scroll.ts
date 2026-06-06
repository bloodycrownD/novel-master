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

/** Restore scrollTop from cached distance-from-bottom (T6 workspace↔chat). */
export function scrollTopForOffsetFromBottom(
  scrollHeight: number,
  clientHeight: number,
  offsetY: number,
): number {
  return Math.max(0, scrollHeight - clientHeight - offsetY);
}

/**
 * After prependPage (not sessionSnapshot): preserve reading position.
 * scrollTop += scrollHeight - prependedScrollHeight — see spec §prepend 稳定.
 */
export function scrollTopAfterPrepend(
  previousScrollTop: number,
  previousScrollHeight: number,
  nextScrollHeight: number,
): number {
  return previousScrollTop + (nextScrollHeight - previousScrollHeight);
}
