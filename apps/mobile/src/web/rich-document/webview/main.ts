/**
 * rich-document WebView 打包入口（esbuild → IIFE app.js）。
 * P0-3：本文件为唯一可同时触及 ui 与 runtime、并完成视图刷新注册的装配点。
 */
import {h, render} from 'preact';
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
import {renderMermaidBlocks} from './runtime/mermaid';
import {
  attachMermaidViewerDelegation,
  mountMermaidViewerPortal,
} from '@web/shared/mermaid-fullscreen/mermaid-fullscreen';
import {attachCodeCopyDelegation} from '@web/shared/code-copy';
import {bindHostMessageChannel} from '@web/shared/host-message-channel';
import {DocumentApp} from './ui/DocumentApp';

const docRoot = document.getElementById('doc');

/** 连续刷新防护：每轮 setDocument 自增，异步链回来时序号已过期则放弃刷新。 */
let setDocumentSeq = 0;

registerSetDocumentView(payload => {
  const seq = ++setDocumentSeq;
  // 换文档前先销毁 Recogito，避免挂在已卸载 DOM 上
  destroyAnnotator();
  if (!docRoot) return;
  render(h(DocumentApp, {payload}), docRoot);
  // 先渲 mermaid（会移动源码 pre 进保留容器），再重建 Recogito，批注文本流按最终 DOM 计算；
  // 序号过期说明已有更新一轮 setDocument，按中间态重建 Recogito 会错乱
  void renderMermaidBlocks(docRoot).finally(() => {
    if (seq !== setDocumentSeq) {
      return;
    }
    refreshAnnotateAfterDocument();
  });
});

bindAnnotateUi();

// Mermaid 全屏查看器：模块刈处一行挂接（不进 setDocument 视图刷新链路）
mountMermaidViewerPortal('overlay-portal');
attachMermaidViewerDelegation(post);
// 代码块复制按钮：document 捕获委托（一次挂接，不进 setDocument 视图刷新链路）
attachCodeCopyDelegation(post);

bindHostMessageChannel(handleHostMessage);

post('ready', {version: 1});
