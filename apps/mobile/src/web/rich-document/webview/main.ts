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
  destroyAnnotator,
  refreshAnnotateAfterDocument,
} from './runtime/annotate';
import { DocumentApp } from './ui/DocumentApp';

const docRoot = document.getElementById('doc');

registerSetDocumentView((payload) => {
  // 换文档前先销毁 Recogito，避免挂在已卸载 DOM 上
  destroyAnnotator();
  if (!docRoot) return;
  render(h(DocumentApp, { payload }), docRoot);
  refreshAnnotateAfterDocument();
});

bindAnnotateUi();

document.addEventListener('message', function (e: Event) {
  const ev = e as MessageEvent;
  handleHostMessage(ev.data);
});
window.addEventListener('message', function (e: MessageEvent) {
  handleHostMessage(e.data);
});

post('ready', { version: 1 });
