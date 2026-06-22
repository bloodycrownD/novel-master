/** Distance from visual bottom within which we treat the user as following the tail. */
export const NEAR_BOTTOM_THRESHOLD_PX = 80;

export function offsetFromBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

export function nearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  return offsetFromBottom(scrollTop, scrollHeight, clientHeight) <= threshold;
}

export function scrollTopForBottom(
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, scrollHeight - clientHeight);
}
