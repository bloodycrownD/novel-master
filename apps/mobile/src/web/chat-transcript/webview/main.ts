/**
 * chat-transcript WebView 打包入口（esbuild → IIFE app.js）。
 * P0-3：本文件为唯一可同时触及 ui 与 runtime、并完成 UI 刷新注册的装配点。
 */
import { state } from './runtime/state/state';
import { post, onHostMessage } from './runtime/bridge/bridge';
import { onScroll } from './runtime/scroll/scroll';
import { onRowsClick } from './runtime/render/rows-click';
import {
  onMessagePointerDown,
  onMessagePointerMove,
  onMessagePointerUp,
  registerRenderContextMenu,
} from './runtime/menu/menu';
import { registerRenderRows } from './runtime/render/row-logic';
// 冒烟：确保 shared/ui TSX + preact 进入 IIFE（phase-toolchain）
import { Smoke } from '../../shared/ui/Smoke';
// TrustedHtml 边界：组件供后续 ui；applyTrustedHtml 供 runtime 例外 import
import { TrustedHtml, applyTrustedHtml } from '../../shared/ui/TrustedHtml';
void Smoke;
// P0-3 预留：注册 no-op 占位，保证门面 + TrustedHtml 边界进入 IIFE
registerRenderRows(() => {
  void TrustedHtml;
  void applyTrustedHtml;
});
registerRenderContextMenu(() => {
  void TrustedHtml;
  void applyTrustedHtml;
});

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
