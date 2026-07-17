/**
 * chat-transcript WebView 打包入口（esbuild → IIFE app.js）。
 */
import { state } from './state/state';
import { post, onHostMessage } from './bridge/bridge';
import { onScroll } from './scroll/scroll';
import { onRowsClick } from './render/rows-click';
import {
  onMessagePointerDown,
  onMessagePointerMove,
  onMessagePointerUp,
} from './menu/menu';
// 冒烟：确保 shared/ui TSX + preact 进入 IIFE（phase-toolchain）
import { Smoke } from '../../shared/ui/Smoke';
void Smoke;
/**
 * chat-transcript boot 入口收尾：宿主 message 监听 + bootTranscript + readyState 兜底。
 */
document.addEventListener('message', onHostMessage as EventListener);
window.addEventListener('message', onHostMessage);

export function bootTranscript(): void {
  const scroller = document.getElementById('scroller');
  const rows = document.getElementById('rows');
  if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
  if (rows) {
    rows.addEventListener('click', onRowsClick);
    rows.addEventListener('touchstart', onMessagePointerDown, { passive: true });
    rows.addEventListener('touchmove', onMessagePointerMove, { passive: true });
    rows.addEventListener('touchend', onMessagePointerUp, { passive: true });
    rows.addEventListener('touchcancel', onMessagePointerUp, { passive: true });
  }
  // RN WebView html source 上 DOMContentLoaded 可能已错过；readyState 兜底
  post('ready', { version: 'm3', readyState: document.readyState });
  state.ready = true;
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootTranscript);
} else {
  bootTranscript();
}
