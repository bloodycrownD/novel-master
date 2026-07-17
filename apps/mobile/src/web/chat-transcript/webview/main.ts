/**
 * chat-transcript WebView 打包入口（esbuild → IIFE app.js）。
 * P0-3：本文件为唯一可同时触及 ui 与 runtime、并完成 UI 刷新注册的装配点。
 * 壳事件 / ready 见 runtime/boot（非「混合框架」，而是 boot 与视图注册分离）。
 */
import { h, render } from 'preact';
import {
  registerRenderContextMenu,
} from './runtime/menu/menu';
import { registerRenderRows } from './runtime/render/row-logic';
import { startTranscriptBoot } from './runtime/boot/boot-transcript';
import { ContextMenu } from './ui/menu/ContextMenu';
import { RowList } from './ui/render/RowList';

// P0-3：注册上下文菜单 Preact 结构（runtime 仅门面调用）
registerRenderContextMenu(({ menuRoot, messageId, items }) => {
  render(h(ContextMenu, { messageId, items }), menuRoot);
});

// P0-3：注册行列表 Preact 实现（消毒 HTML 经 TrustedHtml，见 ui/render）
registerRenderRows(() => {
  const list = document.getElementById('rows');
  if (!list) return;
  render(h(RowList, null), list);
});

startTranscriptBoot();

// 契约测 / 外部仍可检索 bootTranscript 符号（经 boot 模块再导出）
export { bootTranscript } from './runtime/boot/boot-transcript';
