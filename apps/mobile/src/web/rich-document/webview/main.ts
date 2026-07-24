/**
 * rich-document WebView 打包入口（esbuild → IIFE app.js）。
 * P0-3：本文件为唯一可同时触及 ui 与 runtime、并完成视图刷新注册的装配点。
 */
import { h, render } from 'preact';
import {
  post,
  handleHostMessage,
  registerSetDocumentView,
} from './runtime/bridge';
import {
  bindAnnotateUi,
  isAnnotateDomSearchFallbackEnabled,
  refreshAnnotateMarks,
} from './runtime/annotate';
import { bindAnnotateCollectBridge } from './runtime/annotate-collect';
import { DocumentApp } from './ui/DocumentApp';

const docRoot = document.getElementById('doc');

registerSetDocumentView((payload) => {
  if (!docRoot) return;
  render(h(DocumentApp, { payload }), docRoot);
  // 主路径高亮已在宿主注入锚；仅应急开关下重建旧 marks
  if (isAnnotateDomSearchFallbackEnabled()) {
    refreshAnnotateMarks();
  }
});

bindAnnotateUi();
bindAnnotateCollectBridge();

document.addEventListener('message', function (e: Event) {
  const ev = e as MessageEvent;
  handleHostMessage(ev.data);
});
window.addEventListener('message', function (e: MessageEvent) {
  handleHostMessage(e.data);
});

post('ready', { version: 1 });
