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
import { renderMermaidBlocks } from './runtime/mermaid';
import {
  attachMermaidViewerDelegation,
  closeMermaidViewer,
  registerMermaidViewerView,
} from '@web/shared/mermaid-fullscreen/mermaid-fullscreen';
import { MermaidViewerOverlay } from '@web/shared/mermaid-fullscreen/MermaidViewerOverlay';
import { DocumentApp } from './ui/DocumentApp';

const docRoot = document.getElementById('doc');

registerSetDocumentView((payload) => {
  // 换文档前先销毁 Recogito，避免挂在已卸载 DOM 上
  destroyAnnotator();
  if (!docRoot) return;
  render(h(DocumentApp, { payload }), docRoot);
  // 先渲 mermaid（会移动源码 pre 进保留容器），再重建 Recogito，批注文本流按最终 DOM 计算
  void renderMermaidBlocks(docRoot).finally(() => {
    refreshAnnotateAfterDocument();
  });
});

bindAnnotateUi();

// Mermaid 全屏查看器：模块初始化处一次性挂接（不进 setDocument 视图刷新链路）
const overlayPortal = document.getElementById('overlay-portal');
registerMermaidViewerView((props) => {
  if (!overlayPortal) return;
  if (!props) {
    render(null, overlayPortal);
    return;
  }
  render(
    h(MermaidViewerOverlay, {
      svgClone: props.svgClone,
      onClose: () => closeMermaidViewer(true),
    }),
    overlayPortal,
  );
});
attachMermaidViewerDelegation(post);

document.addEventListener('message', function (e: Event) {
  const ev = e as MessageEvent;
  handleHostMessage(ev.data);
});
window.addEventListener('message', function (e: MessageEvent) {
  handleHostMessage(e.data);
});

post('ready', { version: 1 });
