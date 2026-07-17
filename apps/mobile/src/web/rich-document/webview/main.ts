/**
 * rich-document WebView 打包入口（esbuild → IIFE app.js）。
 * P0-3：本文件为唯一可同时触及 ui 与 runtime、并完成视图刷新注册的装配点。
 */
import {
  post,
  handleHostMessage,
  registerSetDocumentView,
} from './runtime/bridge';
// 冒烟：确保 shared/ui TSX + preact 进入 IIFE（phase-toolchain）
import { Smoke } from '../../shared/ui/Smoke';
// TrustedHtml 边界：组件供后续 ui；applyTrustedHtml 供 runtime 例外 import
import { TrustedHtml, applyTrustedHtml } from '../../shared/ui/TrustedHtml';
void Smoke;
// P0-3 预留：注册 no-op 占位，保证门面 + TrustedHtml 边界进入 IIFE
registerSetDocumentView(() => {
  void TrustedHtml;
  void applyTrustedHtml;
});

document.addEventListener('message', function (e: Event) {
  const ev = e as MessageEvent;
  handleHostMessage(ev.data);
});
window.addEventListener('message', function (e: MessageEvent) {
  handleHostMessage(e.data);
});

post('ready', { version: 1 });
