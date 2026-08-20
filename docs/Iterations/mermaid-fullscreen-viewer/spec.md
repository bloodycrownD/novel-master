---
date: 2026-08-20
---

# Mermaid 图表全屏查看与缩放 技术规格（SPEC）

## 设计目标

mobile 文件预览（rich-document WebView）与聊天（chat-transcript WebView）中渲染成功的 mermaid 图表，点击进入 **WebView 内全屏覆盖层**，支持双指 pinch 缩放、双击缩放、单指拖拽平移，三种方式关闭（点空白/关闭按钮/Android 返回键）。需求来源：`docs/Iterations/mermaid-fullscreen-viewer/prd.md`。

## 总体方案

**WebView 内覆盖层，不回传 RN**（SVG 只能在 WebView 生成，RN 方案需引重依赖，探索已否决）。两管线共享同一实现：

- **共享模块** `src/web/shared/mermaid-fullscreen/`（runtime 逻辑 + Preact 组件 + 样式常量），模式对齐 `mermaid-core.ts` 的共享先例。chat-transcript 有完整覆盖层样板（`#menu-portal` 五件套），照抄结构。
- **点击监听用事件委托**：document 级 `click` → `closest('.mermaid-block__chart')`。两条管线的 DOM 会被 `setDocument`/`renderRows` 整树重建，逐图挂监听会丢；委托一次挂载永久有效。失败态（`.mermaid-failed` 源码回退）不匹配选择器，天然满足「失败不可进全屏」。
- **克隆不移动**：进全屏时 `chart.querySelector('svg').cloneNode(true)`，原图 DOM 零改动——批注文本流（源码 pre 在原位 display:none）与既有渲染不受影响。
- **手势**：touch 事件实现 pinch（双指中点+距离）、双击切换（原始大小↔放大档位）、单指平移；手势进行中直接写 `style.transform`（不经 setState，避免 60fps 被节流），手势结束固化状态。缩放/平移边界 clamp、双击状态机抽成**纯函数**放 `src/web/webview-host/`（照 `menu-overlay-guards` 样板 Jest 直测）。
- **返回键（Android）**：照菜单的对称消息模式——WebView 开全屏 `post('mermaidViewerOpened')`，RN 拦截 BackHandler 后 `postToWeb({type:'closeMermaidViewer'})`，WebView 关闭并 `post('mermaidViewerClosed')`。
  - chat：消息上浮接 `useAndroidChatBackHandler`（现成 `messageMenuOpen` 拦截先例，L83-86），排在 overlay 拦截链最前
  - rich-document：`RichDocumentWebView` 组件内自注册 BackHandler（Platform.OS==='android'，随 focus 注册/注销，注意 `navigation.isFocused()` 判定防吞上层返回），完全内聚不影响使用方
- **主题**：背景 `var(--bg)`、按钮 `var(--surface)`/`var(--text)`（两管线 bridge 的 applyTheme 都写这些变量），深色自动协调。
- **流式边界（已知，无需防护）**：全屏打开时若 `streamCommit` 触发 `renderRows` 重建原图行，覆盖层持克隆 SVG 不受影响；覆盖层挂 body 级 portal（与 `#rows`/`#doc` 平级）不会被冲掉。

## 最终项目结构

```
apps/mobile/
  src/web/shared/mermaid-fullscreen/
    mermaid-fullscreen.ts          # 新增：runtime——事件委托、开关门面、post 通知
    MermaidViewerOverlay.tsx       # 新增：Preact 覆盖层组件（手势、关闭按钮、backdrop）
    mermaid-fullscreen-styles.ts   # 新增：样式常量（.mermaid-fullscreen* 选择器，单源）
  src/web/webview-host/chat-transcript/
    mermaid-viewer-gestures.ts     # 新增：pinch/pan clamp 与双击状态机纯函数（Jest 直测）
  src/web/rich-document/index.html # 改：body 级加 <div id="overlay-portal"></div>
  src/web/rich-document/webview/main.ts        # 改：注册全屏层渲染入口 + 事件委托挂接
  src/web/chat-transcript/index.html           # 改：加 <div id="mermaid-viewer-portal"></div>（与 #menu-portal 平级）
  src/web/chat-transcript/webview/main.ts      # 改：同上注册挂接
  src/web/rich-document/webview/runtime/bridge.ts  # 改：handleHostMessage 加 closeMermaidViewer 分支
  src/web/chat-transcript/webview/runtime/bridge/bridge.ts  # 改：同款分支
  src/web/shared/rich-content-styles.ts        # 改：给 .mermaid-block__chart 加按压态视觉暗示（active 透明度）
  src/components/vfs/RichDocumentWebView.tsx   # 改：收 mermaidViewerOpened/Closed + BackHandler 自注册
  src/components/chat/ChatTranscriptWebView.tsx # 改：收 mermaidViewerOpened/Closed 上浮
  src/hooks/useAndroidChatBackHandler.ts       # 改：加 mermaidViewerOpen 拦截位（最前）
  scripts/build-webview.mjs                    # 改：mermaid-fullscreen 样式注入两包
  __tests__/mermaid-fullscreen.test.ts         # 新增：T-MF1~T-MF5
```

不改动：`mermaid-core.ts` 的既有语句（T-MV2 断言盯着 `insertBefore(block, pre)` 等）、`snapshot.ts` 的 5 处 `scheduleMermaidScan()` 调用（T-MT1 计数断言）、`stream.ts`（T-MT2 红线：不得出现 mermaid 字样）。

## 变更点清单

见上「最终项目结构」。关键约束（探索确认）：

- rich-document `main.ts` 挂接顺序有测试正则钉着（T-MV1）：`setDocument` → render → `renderMermaidBlocks` → `refreshAnnotateAfterDocument`——全屏注册加在**模块初始化处**（一次性），不进该链路
- WebView→RN 消息类型：`RichDocumentBridge.ts` 的 `RichDocumentToHostMessage` 联合（L83-97）与 chat 对应联合各加 `mermaidViewerOpened`/`mermaidViewerClosed`
- 样式注入链：`build-webview.mjs` 的 PACKAGES/injectCss 机制已有 `richCssKey`；全屏样式选择器不带 `.bubble.rich` 前缀，走新常量、新注入位（不塞 `buildRichContentCssRules`）
- SVG 根节点 width/height 属性可能缺失，初始 fit-to-screen 以 `viewBox` 推算为基准，缺两者时回退容器满宽

## 详细实现步骤

- Step 1 — phase-mf-gestures — blocking: yes — qa: auto：`mermaid-viewer-gestures.ts` 纯函数：pinch 缩放 clamp（min/max 档位）、平移边界 clamp（按当前缩放算可达范围）、双击状态机（原始↔放大档位切换，间隔阈值防连触误判）。
- Step 2 — phase-mf-shared — blocking: yes — qa: auto：`mermaid-fullscreen/` 三件套：runtime（document 级 click 委托 + 开关门面 + post 双向通知）、`MermaidViewerOverlay`（Preact：backdrop + 克隆 SVG 容器 + 右上角关闭按钮 + touch 手势接 Step 1 纯函数，手势中写 transform）、样式常量（背景 `var(--bg)`、z-index 对齐 menu-backdrop 量级 9998+）。
- Step 3 — phase-mf-pipelines — blocking: yes — qa: auto：两管线接线——rich-document `index.html` 加 `#overlay-portal`、chat 加 `#mermaid-viewer-portal`；各自 main.ts 注册渲染入口与事件委托；两个 bridge 各加 `closeMermaidViewer` 分支（关覆盖层 + `post('mermaidViewerClosed')`）。
- Step 4 — phase-mf-backkey — blocking: yes — qa: auto：RN 侧返回键——`ChatTranscriptWebView` 收 `mermaidViewerOpened/Closed` 上浮（照 `menuOpened`→`onWebMenuOpenChange` 先例）；`useAndroidChatBackHandler` 加拦截位（返回键先关全屏 return true）；`RichDocumentWebView` 内自注册 BackHandler（Android only、随 focus、判 `navigation.isFocused()`）。
- Step 5 — phase-mf-styles-build — blocking: yes — qa: auto：`build-webview.mjs` 注入全屏样式到两包；`rich-content-styles.ts` 给 `.mermaid-block__chart` 加按压暗示；`npm run build:webview` 重建，dist 断言进 T-MF5。
- Step 6 — phase-mf-regression — blocking: yes — qa: auto：回归红线：`mermaid-webview.test.ts` 全绿（T-MV1-3/T-MT1-3 一条不破）、menu 系测试全绿、`npm run typecheck`。
- Step 7 — phase-mf-qa — blocking: no — qa: manual_user：真机验收 PRD 用例（预览/聊天两入口、pinch/双击/拖拽、三关闭路径、失败态不可点、深色主题）。

## 测试策略

### 测试用例

- T-MF1 — blocking: yes — 共享模块源码契约：runtime 含 `closest('.mermaid-block__chart')` 委托、`cloneNode(true)`、`mermaidViewerOpened`/`mermaidViewerClosed` post、不含 `.mermaid-failed` 匹配（映射 Step 2）
- T-MF2 — blocking: yes — 手势纯函数：pinch clamp 边界（不小于 min、不大于 max）、pan clamp 不出界、双击状态机两档切换与连触防抖（映射 Step 1）
- T-MF3 — blocking: yes — 管线接线契约：两 index.html 含 portal 宿主、两 main.ts 含注册、两 bridge 含 `closeMermaidViewer` 分支（读源码字符串；映射 Step 3）
- T-MF4 — blocking: yes — 返回键契约：`ChatTranscriptWebView` 含两消息上浮、`useAndroidChatBackHandler` 含 mermaid 拦截位且顺序在 menu 前、`RichDocumentWebView` 含 BackHandler 注册（映射 Step 4）
- T-MF5 — blocking: yes — dist 断言：`readWebViewDistFile` 读两包 app.js 含全屏模块标识、app.css 含 `.mermaid-fullscreen` 样式（映射 Step 5）
- T-MF6 — blocking: yes — 回归：`mermaid-webview.test.ts`、menu 系 7 测试全绿（映射 Step 6）

纯函数写法照 `menu-overlay-guards` 样板（Jest 直测）；DOM 契约照 T-MV2「读源码 + dist」惯例。

## 风险与回滚方案

- **风险：pinch 手势与 WebView 原生滚动冲突**——全屏态 `body` 加 `mermaid-viewer-open` class 禁滚动（照 `body.menu-open` 先例），覆盖层内 touch preventDefault。
- **风险：低端机 transform 卡顿**——手势中只写 transform 不触发 Preact 重渲，帧内合并写入；真机验收（Step 7）把关。
- **风险：BackHandler 吞上层屏返回**——rich-document 注册必须判 `navigation.isFocused()`（GlobalTemplateScreen 注释先例）；chat 走既有 hook 的 focus 生命周期。
- **已知边界**：全屏打开时原图行被重建（streamCommit/renderRows），覆盖层持克隆不受影响——写实现注即可。
- **回滚**：main.ts 去掉注册一行即回退（覆盖层代码成死代码不影响运行时）；RN 侧消息分支不收即无效；无数据与协议变更。
