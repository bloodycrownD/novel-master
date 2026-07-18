/**
 * chat-transcript WebView 打包入口（esbuild → IIFE app.js）。
 * P0-3：本文件为唯一可同时触及 ui 与 runtime、并完成 UI 刷新注册的装配点。
 * ISD：MenuOverlay 渲染到 #menu-portal（Portal 等价；不上 preact/compat）。
 * 壳事件 / ready 见 runtime/boot（非「混合框架」，而是 boot 与视图注册分离）。
 */
import { h, render } from 'preact';
import {
  registerRenderContextMenu,
} from './runtime/menu/menu';
import { registerRenderRows } from './runtime/render/row-logic';
import { startTranscriptBoot } from './runtime/boot/boot-transcript';
import { MenuOverlay } from './ui/menu/MenuOverlay';
import { RowList } from './ui/render/RowList';

const menuPortal = document.getElementById('menu-portal');

// P0-3 / ISD：注册完整菜单 overlay；关闭时 render(null) 卸载
registerRenderContextMenu((props) => {
  if (!menuPortal) return;
  if (!props) {
    render(null, menuPortal);
    return;
  }
  render(h(MenuOverlay, props), menuPortal);
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
