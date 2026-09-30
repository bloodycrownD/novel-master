/**
 * chat-conversation 合成包打包入口（esbuild → IIFE app.js）。
 *
 * 本包把 chat-transcript（转录）与 composer-input（输入框 dock）合并进**同一个文档**，
 * 输入框高度变化在文档内 flex 布局里消化，消灭现网「跨桥上报 + 80ms 渐变」的高度滞后。
 *
 * Step 2（phase-asset-pipeline）只落「可构建 + 过 dist 契约测」的最小装配骨架：
 * 两 runtime 各以 `bindChannel:false, emitReady:false` 装配——
 * 通道绑定、合成 dispatcher、单条 v2 ready、dock 自有 handler 全部由下一节点（wave-2，
 * Step 5 phase-bridge-v2）落地。**现在刻意不发真 ready**：宿主侧 ChatConversationWebView
 * 还没接，发了也没有 v2 消费者，只会污染旧链的 webReady 门控。
 *
 * 装配顺序（与 spec §装配归属表一致，后续节点只在此基础上补，不重排）：
 *   1. 单次 `bindHostMessageChannel(合成 dispatcher)` ← wave-2
 *   2. `createTranscriptRuntime({bindChannel:false, emitReady:false})`
 *   3. `createComposerRuntime('#composer-input', {heightReport:false, bindChannel:false, emitReady:false})`
 *   4. dock handler 挂载 ← wave-2
 *   5. 双 boot 完成后由入口自建 `createBoundPost(2)` 发**单条** ready（capabilities 含
 *      `composer-dock` 位，该位不进共享常量数组）← wave-2
 *
 * es2018 纪律：web 代码禁 ES2021+ 运行时 API 与 lookbehind 正则（esbuild target es2018）。
 */
import {createTranscriptRuntime} from '@web/chat-transcript/webview/runtime/factory';
import {createComposerRuntime} from '@web/composer-input/webview/runtime/factory';

// 转录 runtime：自渲染/窗口化/mermaid portal/菜单 overlay 全部在工厂内完成；
// bindChannel=false 交出通道注册权，emitReady=false 交出 ready 发言权。
createTranscriptRuntime({bindChannel: false, emitReady: false});

// composer runtime：挂到 dock 内的 #composer-input（与旧包 #root 不同名）；
// heightReport=false —— 高度改由文档内布局消化，chat 链断开 heightChange 上行
// （旧包 main 传 true，宏链活消费不受影响）。
createComposerRuntime('#composer-input', {
  heightReport: false,
  bindChannel: false,
  emitReady: false,
});

// TODO(wave-2 / phase-bridge-v2):
//   - bindHostMessageChannel(dispatcher)：按 §下行消息路由表把 v2 信封重打包为 v1
//     分发给两个 runtime（themeUpdate fan-out 三方；composer 域与 dock 域直发不 defer）。
//   - 自建 createBoundPost(2) 供 ready 与 dockAction 上行；runtime 内部上行仍走各自
//     v:1 单例（不注入替换 post）。
//   - dock 自有 handler 挂载（composerState / composerPaste / selectAll / dockAction）。
//   - 两 runtime 均 boot 完成后发单条 ready（version:'u1'，capabilities 含 composer-dock）。
