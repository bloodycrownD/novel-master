/**
 * chat-transcript WebView 打包入口（esbuild → IIFE app.js）。
 *
 * Step 1（chat-webview-unify）：装配副作用已全部下沉到 runtime/factory
 * （registerRenderContextMenu / registerRenderRows + measureRowWindow /
 * mountMermaidViewerPortal / attachMermaidViewerDelegation / startTranscriptBoot）。
 * 本文件只做「import 工厂 + 一行调用（默认参数 = 拆分前行为，零变化）」+
 * re-export 原导出名字（契约测按字面量检索，见 mermaid-fullscreen.test.ts）。
 *
 * P0-3：runtime/factory 是唯一可同时触及 ui 与 runtime、并完成 UI 刷新注册的装配点。
 * ISD：MenuOverlay 渲染到 #menu-portal（Portal 等价；不上 preact/compat）。
 * 壳事件 / ready 见 runtime/boot（非「混合框架」，而是 boot 与视图注册分离）。
 */
import {createTranscriptRuntime} from './runtime/factory';

createTranscriptRuntime();

export {
  attachMermaidViewerDelegation,
  mountMermaidViewerPortal,
} from '@web/shared/mermaid-fullscreen/mermaid-fullscreen';

// 契约测 / 外部仍可检索 bootTranscript 符号（经 boot 模块再导出）
export {bootTranscript} from './runtime/boot/boot-transcript';
