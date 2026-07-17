/**
 * 菜单 overlay 手势守卫。数值常量真源：`shared/constants.ts`。
 */
export {
  MENU_OPEN_GRACE_MS,
  LONG_PRESS_MOVE_TOLERANCE_PX,
} from '../shared/constants';
import {
  MENU_OPEN_GRACE_MS,
  LONG_PRESS_MOVE_TOLERANCE_PX,
} from '../shared/constants';

export function shouldCancelLongPressForMove(
  deltaX: number,
  deltaY: number,
  tolerancePx: number = LONG_PRESS_MOVE_TOLERANCE_PX,
): boolean {
  return Math.hypot(deltaX, deltaY) > tolerancePx;
}

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
