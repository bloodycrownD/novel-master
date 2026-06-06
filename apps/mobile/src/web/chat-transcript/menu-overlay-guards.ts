/** Grace period after long-press menu open; ignore bubble touchend (finger lift). */
export const MENU_OPEN_GRACE_MS = 400;

/**
 * Long-press opens the menu while the finger is still down; the subsequent touchend on
 * the message row must not dismiss the menu before the user picks an action.
 */
export function shouldIgnoreMenuOutsideDismiss(
  eventType: string,
  menuOpenedAtMs: number,
  nowMs: number,
  targetIsMessageRow: boolean,
): boolean {
  if (eventType !== 'touchend' || !targetIsMessageRow || menuOpenedAtMs <= 0) {
    return false;
  }
  return nowMs - menuOpenedAtMs < MENU_OPEN_GRACE_MS;
}
