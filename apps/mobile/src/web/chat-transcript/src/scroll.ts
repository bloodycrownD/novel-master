import { NEAR_BOTTOM } from '../../shared/constants';
import { state, SCHEMA_V } from './state';
import { post } from './bridge';
import { clearLongPress } from './menu';
/**
 * 滚动锚点、贴底与加载更早消息。
 */
export const SCROLL_TOP_LOAD_OLDER = 24;

export function offsetFromBottom(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

export function isNearBottom(el: HTMLElement): boolean {
  return offsetFromBottom(el) <= NEAR_BOTTOM;
}

export function stickToBottom(el: HTMLElement): void {
  el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  state.nearBottom = true;
}

/** Tail shrink (rollback): prevScrollTop may exceed new max — clamp to avoid bubble jump. */
export function clampScrollTop(el: HTMLElement, prevScrollTop: number): void {
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
  el.scrollTop = Math.min(prevScrollTop, maxScroll);
}

export function scheduleStickIfNearBottom(): void {
  if (!state.nearBottom) return;
  if (state.scrollRaf != null) return;
  state.scrollRaf = requestAnimationFrame(function () {
    state.scrollRaf = null;
    const scroller = document.getElementById('scroller');
    if (scroller) stickToBottom(scroller);
  });
}

export function emitScrollSnapshot(): void {
  const scroller = document.getElementById('scroller');
  if (!scroller) return;
  const off = offsetFromBottom(scroller);
  const near = off <= NEAR_BOTTOM;
  state.nearBottom = near;
  post('scrollSnapshot', {
    schemaVersion: SCHEMA_V,
    offsetY: off,
    nearBottom: near,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
  });
}

export let scrollTimer: ReturnType<typeof setTimeout> | null = null;

export function requestLoadOlder(): void {
  if (!state.hasMore || !state.loadOlderArmed) return;
  state.loadOlderArmed = false;
  post('loadOlder', {});
}

export function onScroll(): void {
  const scroller = document.getElementById('scroller');
  if (!scroller) return;
  if (state.longPressTimer != null || state.longPressTarget != null) {
    clearLongPress();
  }
  state.nearBottom = isNearBottom(scroller);
  if (scroller.scrollTop <= SCROLL_TOP_LOAD_OLDER) {
    requestLoadOlder();
  }
  if (scrollTimer != null) return;
  scrollTimer = setTimeout(function () {
    scrollTimer = null;
    emitScrollSnapshot();
  }, 100);
}
