// @ts-nocheck
import {
  NEAR_BOTTOM,
} from '../../shared/constants';
import { state, SCHEMA_V } from './state';
import { post } from './bridge';
import { clearLongPress } from './menu';
/**
 * 滚动锚点、贴底与加载更早消息。
 */
export var SCROLL_TOP_LOAD_OLDER = 24;
export function offsetFromBottom(el) {
    return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
  }

export function isNearBottom(el) {
    return offsetFromBottom(el) <= NEAR_BOTTOM;
  }

export function stickToBottom(el) {
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    state.nearBottom = true;
  }

  /** Tail shrink (rollback): prevScrollTop may exceed new max — clamp to avoid bubble jump. */
export function clampScrollTop(el, prevScrollTop) {
    var maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.min(prevScrollTop, maxScroll);
  }

export function scheduleStickIfNearBottom() {
    if (!state.nearBottom) return;
    if (state.scrollRaf != null) return;
    state.scrollRaf = requestAnimationFrame(function () {
      state.scrollRaf = null;
      var scroller = document.getElementById('scroller');
      if (scroller) stickToBottom(scroller);
    });
  }

export function emitScrollSnapshot() {
    var scroller = document.getElementById('scroller');
    if (!scroller) return;
    var off = offsetFromBottom(scroller);
    var near = off <= NEAR_BOTTOM;
    state.nearBottom = near;
    post('scrollSnapshot', {
      schemaVersion: SCHEMA_V,
      offsetY: off,
      nearBottom: near,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    });
  }

export var scrollTimer = null;
export function requestLoadOlder() {
    if (!state.hasMore || !state.loadOlderArmed) return;
    state.loadOlderArmed = false;
    post('loadOlder', {});
  }

export function onScroll() {
    var scroller = document.getElementById('scroller');
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
