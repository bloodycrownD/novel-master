/**
 * chat-conversation 合成包打包入口（esbuild → IIFE app.js）。
 *
 * 本包把 chat-transcript（转录）与 composer-input（输入框 dock）合并进**同一个文档**，
 * 输入框高度变化在文档内 flex 布局里消化，消灭现网「跨桥上报 + 80ms 渐变」的高度滞后。
 *
 * 装配顺序（spec §装配归属表，顺序是红线）：
 *   1. `bindHostMessageChannel(合成 dispatcher)` ← **必须先于两工厂**
 *   2. `createTranscriptRuntime({bindChannel:false, emitReady:false})`
 *   3. `createComposerRuntime('#composer-input', {heightReport:false, bindChannel:false, emitReady:false})`
 *   4. `dock.mount()`
 *   5. 两 runtime 均 boot 完成后由入口自建 `createBoundPost(2)` 发**单条** ready
 *
 * 第 5 步带一道装配闸：`composerRuntime.mounted` 与 `dock.mount()` 的返回值任一为假
 * （壳 id 漂移）就**不发** ready，由宿主 8s 超时兜底落错误态（详见 emitConversationReady）。
 *
 * 第 1 步为何必须最先：`bindHostMessageChannel` 是 document + window 双注册且**无幂等
 * 守卫**，晚于两工厂则两 runtime 各自又绑一次（`bindChannel:false` 已关掉它们那两次），
 * 而「先绑后装」保证 ready 之前到达的任何下行都不会漏——通道已就位，handler 命中的是
 * dispatcher，runtime 的转发目标在同一条同步链路上被赋值。
 *
 * 上行 v 号（spec §合成 dispatcher 契约第 1 条）：两旧 runtime 的 `BRIDGE_V = 1`
 * 硬编码不动、其 `post` 是被 6+ 兄弟模块直接 import 的模块级单例——「注入替换 post
 * 让上行带 v:2」已否决。本入口自持的 `createBoundPost(2)` **只**供 ready、dockAction
 * 使用；宿主只认 `v === 2` 的 ready，其余上行宽容解析（不校验 v）。
 *
 * es2018 纪律：web 代码禁 ES2021+ 运行时 API 与 lookbehind 正则（esbuild target es2018）。
 */
import {bindHostMessageChannel} from '@web/shared/host-message-channel';
import {createBoundPost} from '@web/shared/post';
import {handleHostMessage as handleTranscriptHostMessage} from '@web/chat-transcript/webview/runtime/bridge';
import {handleHostMessage as handleComposerHostMessage} from '@web/composer-input/webview/runtime/bridge';
import {createTranscriptRuntime} from '@web/chat-transcript/webview/runtime/factory';
import {createComposerRuntime} from '@web/composer-input/webview/runtime/factory';
import {createConversationDispatcher} from './dispatcher';
import {createConversationDock, shouldEmitConversationReady} from './dock';
import {
  CONVERSATION_BRIDGE_V,
  CONVERSATION_READY_VERSION,
  conversationCapabilities,
} from './model';

// 新包自有上行出口（v:2）：ready / dockAction。
const post = createBoundPost(CONVERSATION_BRIDGE_V);

const dock = createConversationDock(post);

// 合成 dispatcher：v2 信封 → 分域重打包 v1 → 两 runtime + dock 自有 handler。
const dispatcher = createConversationDispatcher({
  handleTranscript: handleTranscriptHostMessage,
  handleComposer: handleComposerHostMessage,
  applyDockRoute: route => dock.applyRoute(route),
  applyDockTheme: theme => dock.applyTheme(theme),
});

/* ---- 1. 单次通道注册（红线：先于两工厂） ---- */
bindHostMessageChannel(dispatcher);

/* ---- 2. 转录 runtime：自渲染/窗口化/mermaid portal/菜单 overlay 全在工厂内完成；
   bindChannel=false 交出通道注册权，emitReady=false 交出 ready 发言权。 ---- */
createTranscriptRuntime({bindChannel: false, emitReady: false});

/* ---- 3. composer runtime：挂到 dock 内的 #composer-input（与旧包 #root 不同名）；
   heightReport=false —— 高度改由文档内布局消化，chat 链断开 heightChange 上行
   （旧包 main 传 true，宏链活消费不受影响）。 ---- */
const composerRuntime = createComposerRuntime('#composer-input', {
  heightReport: false,
  bindChannel: false,
  emitReady: false,
});

/* ---- 4. dock handler 挂载（textarea 由上一步的 composer runtime 挂出，事件源已就位） ---- */
const dockMounted = dock.mount();

/* ---- 5. 单 ready：两 runtime 均 boot 完成后发，且**只发一条** ----
   boot 完成检测用入口自己的 DOMContentLoaded 回调：它的注册序在
   `createTranscriptRuntime` 之后（后者经 startTranscriptBoot 先注册自己的
   bootTranscript 回调），故同一次 DOMContentLoaded 里 transcript 的 boot 一定
   先于本回调跑完——顺序由注册序保证，不需要模块级可变 flag。 */
function emitConversationReady(): void {
  // ready 闸门（spec §合成 dispatcher 契约第 4 条）：两块装配面任一未成功就**不发** ready。
  // 早年这里是无条件发，于是壳 id 漂移时输入区整块消失、宿主却把这份残缺文档当成正常页面
  // 接上，8s 白屏兜底因为「ready 来了」永远不触发。故此处在闸口直接返回，把信号交回给
  // 宿主的超时兜底（约 8s 落错误态）——「ready 不来」本身就是最有效的装配失败诊断，
  // 比在 web 侧把某块 UI 藏起来更能让用户和日志同时看见问题。
  if (
    !shouldEmitConversationReady({
      composerMounted: composerRuntime.mounted,
      dockMounted,
    })
  ) {
    console.error(
      '[chat-conversation] 装配未完成，不发 ready：' +
        `composerMounted=${composerRuntime.mounted} dockMounted=${dockMounted}；` +
        '壳元素未命中（#composer-input / #composer-dock），交由宿主 8s 超时兜底落错误态。',
    );
    return;
  }
  post('ready', {
    version: CONVERSATION_READY_VERSION,
    capabilities: conversationCapabilities(),
    readyState: document.readyState,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', emitConversationReady);
} else {
  emitConversationReady();
}
