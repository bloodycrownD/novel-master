---
zone: w8-ds-webbridge-a
agent: 独立双扫 A（domain-survey）
files_scanned: 62
---

# w8-ds-webbridge-a —— apps/mobile WebView 桥协议双侧测绘

> 独立机位 A。禁读 `raw/` 与 `synth/` 下任何文件（含另一份双扫）。本报告全部结论来自
> HEAD `9ca5f5ad`（worktree `D:\Dev\nm-worktree\mcr`）源码实读，行号均现场核对。

## 摘要

四个 WebView 域（chat-transcript / rich-document / code-editor / composer-input）各有一套
**双侧手写镜像**的桥协议：RN 侧 `components/*/*Bridge.ts` 声明信封类型 + encode/decode，
web 侧 `src/web/<pkg>/webview/runtime/bridge.ts` 收 host 消息、各 runtime 模块经
`@web/shared/post` 的 `createBoundPost(BRIDGE_V)` 发 host 消息。`src/webview-host/` 是两侧
共用的纯函数真源（滚动数学 / 锚定菜单布局 / 数值常量）。本区重点做了双侧消息类型对账，
发现协议清单里有 **4 类永不走通的死消息**、**3 个只有测试消费的死导出模块**，以及
**同一 RAF 坑位被 delta/batch 两条 flush 共用**导致的 batch 滞留。

## 职责与边界

- **RN 侧（协议持有方）**：`components/chat/ChatTranscriptBridge.ts`（信封类型 + 4 编解码 +
  `parseScrollSnapshotFromHost`）、`ComposerInputBridge.ts`、`components/vfs/CodeEditorBridge.ts`、
  `RichDocumentBridge.ts`。这 4 个文件是**协议的唯一类型真源**。
- **RN 侧（宿主壳）**：`ChatTranscriptWebView.tsx`（1843 行，桥的所有编排：快照分片、
  流式 RAF、可见性重挂）、`ComposerInputWebView.tsx`、`CodeEditorWebView.tsx`、
  `RichDocumentWebView.tsx`。
- **web 侧（收）**：各包 `runtime/bridge.ts` 的 `handleHostMessage`。
- **web 侧（发）**：`@web/shared/post` 的 `post(type, payload, bridgeV)` / `createBoundPost`；
  `@web/shared/host-message-channel` 的 `parseHostMessage` / `matchHostMessage` /
  `bindHostMessageChannel`（document + window 双注册）。
- **`src/webview-host/`**：与 DOM 无关的纯函数 + 常量真源，被 web bundle 与 RN 两侧共同 import。
  分四块：资产 URI（`webview-asset-uri.ts` + 4 个 `uri.ts`）、锚定菜单布局
  （`anchored-menu-layout.ts`）、滚动数学（`chat-transcript/scroll.ts`）、数值常量
  （转手 `@web/shared/constants`）。
- **不在本区**：mermaid 渲染管线（`shared/mermaid-*`，只按 bridge 消息对账）、composer 高亮/
  原子删算法、transcript 渲染组件（`ui/`）、消息行构造（`message-blocks.ts`，只按行协议对账）。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `CHAT_TRANSCRIPT_BRIDGE_VERSION = 1` | `ChatTranscriptBridge.ts:5` | transcript 协议版本常量 |
| `HostToTranscriptMessage`（16 个 type） | `ChatTranscriptBridge.ts:105-196` | RN→web 全量清单 |
| `TranscriptToHostMessage`（16 个 type） | `ChatTranscriptBridge.ts:207-258` | web→RN 全量清单 |
| `encode/decodeHostToTranscript`、`encode/decodeTranscriptToHost` | `:263-295` | 信封编解码；decode 走抛错口径 |
| `parseScrollSnapshotFromHost` | `:297-308` | 滚动快照 schema 门闸（v2） |
| `COMPOSER_INPUT_BRIDGE_VERSION = 1` | `ComposerInputBridge.ts:8` | composer-input 协议版本 |
| `HostToComposerInputMessage`（6）/ `ComposerInputToHostMessage`（6） | `:66-81` | |
| `CODE_EDITOR_BRIDGE_VERSION = 1` | `CodeEditorBridge.ts:4` | code-editor 协议版本 |
| `HostToCodeEditorMessage`（4）/ `CodeEditorToHostMessage`（5） | `:28-50` | |
| `RICH_DOCUMENT_BRIDGE_VERSION = 1` | `RichDocumentBridge.ts:5` | rich-document 协议版本 |
| `HostToRichDocumentMessage`（7）/ `RichDocumentToHostMessage`（9） | `:68-105` | |
| `ChatTranscriptWebViewHandle`（7 方法） | `ChatTranscriptWebView.tsx:92-117` | imperative 流式入口 |
| `ComposerInputWebViewHandle`（`setText` / `blur`） | `ComposerInputWebView.tsx:90-101` | 程序化写入 |
| `CodeEditorWebViewHandle`（`setText` / `blur`） | `CodeEditorWebView.tsx:48-55` | |
| `post` / `createBoundPost` / `BoundPost` | `@web/shared/post.ts:23,44,39` | web→RN 唯一出口 |
| `parseHostMessage` / `matchHostMessage` / `bindHostMessageChannel` | `@web/shared/host-message-channel.ts:16,30,44` | host→web 唯一入口 |
| `getWebViewPackageIndexUri` / `getWebViewPackageDirUri` | `@/webview-host/webview-asset-uri.ts:47,60` | 平台 URI（android_asset / MainBundle） |
| `layoutAnchoredMenu` / `layoutAnchoredMenuForHeight` / `computeAnchoredMenuWidth` | `anchored-menu-layout.ts:65,48,139` | 双端共用布局数学 |
| `TRANSCRIPT_CAPABILITIES` / `transcriptCapabilitiesInclude` | `@web/chat-transcript/transcript-capabilities.ts:17,25` | B-2 能力协商真源（双端共用同一文件） |

## 数据访问

本区**不触碰任何表 / KKV 域**，唯一的"存储"是 WebView 侧的进程内模块单例：

| 数据 | 位置 | 性质 |
|---|---|---|
| `state`（transcript 全量渲染态：rows / stream / flags / menu / 窗口） | `web/chat-transcript/.../state/state.ts:112-135` | 模块级单例，页面 reload 清零 |
| `streamBlockRender` / `streamDisplayParts` | `.../stream/stream.ts:19-23, 41-44` | 模块级，块级渲染态 |
| `editor`（composer 输入框 DOM 单实例） | `web/composer-input/.../editor.ts:229` | 模块级 |
| `annotator` / `knownDraftIds`（Recogito） | `web/rich-document/.../annotate.ts:30,33` | 模块级 |
| `_renderView` / `_post` / `_open`（mermaid 全屏） | `shared/mermaid-fullscreen/mermaid-fullscreen.ts:37-40` | 模块级 |
| `attached`（code-copy 委托幂等标志） | `shared/code-copy.ts:18` | 模块级 |
| `appliedSnapshotGeneration` / `pendingChunkAcc` / `pendingChunkActions` | `.../render/snapshot.ts:64-78` | 模块级，快照分片对账 |
| `snapshotGenerationCounter` | `ChatTranscriptWebView.tsx:250` | **RN 模块级**，跨所有会话单调递增 |
| 滚动快照缓存（schema v2，maxEntries 500） | `services/chat-transcript-scroll-cache.ts:23` | 内存 LRU，唯一 KKV 之外的状态 |
| WebView 资产 | `file:///android_asset/webview/<pkg>/`（Android）/ `<MainBundle>/WebViewDist/<pkg>/`（iOS） | 打进 APK/Bundle 的静态资产，**dist 不进 git** |

构建链（改 `src/web/**` 必须走）：`npm run build:webview`（esbuild → `webview-dist/`）
→ `build:webview:native`（拷 android assets + iOS bundle）→ gradle/真机。脚本
`apps/mobile/scripts/build-webview.mjs`，`target: ['es2018']`（:114），web 侧禁新正则特性。
web bundle 的路径别名 `@web` → `src/web`、 `@` → `src`（:69），这就是 web 侧能 import
`@/webview-host/**` 的原因。

## 依赖关系

- **web → RN 侧**：只 import `src/webview-host/**`（`anchored-menu-layout`、
  `chat-transcript/scroll`）与 `src/web/shared/**`。`menu.ts:6` 与 `snapshot.ts:10` 用的是
  **五级相对路径** `'../../../../../webview-host/...'` 而非 `@/` 别名——与其它 web 文件
  （`@web/shared/*`）风格不一致，但 esbuild alias 两条都通。
- **RN → web 侧**：`ChatTranscriptWebView.tsx:69` / `:72` 直接 import
  `@/web/chat-transcript/stream/block-split` 与 `@/web/chat-transcript/transcript-capabilities`
  —— web 与 RN **共用同一份源码文件**，非镜像。这是本区唯一的"单源"设计。
- **测试 → web 侧**：`composer-input-bridge.test.ts:9` import `@web/composer-input/.../model`
  做双端 `BRIDGE_V` 一致性断言（唯一一处）。其余三域**没有**双端 BRIDGE_V 一致性断言
  （`code-editor-bridge.test.ts` / `rich-document-bridge.test.ts` /
  `chat-transcript-bridge.test.ts` 只断言 RN 常量自洽）。
- **测试 → webview-host**：`chat-transcript-scroll.test.ts`、`menu-overlay-guards.test.ts`、
  `stream-tail-html-state.test.ts`、`anchored-menu-layout-parity.test.ts`。
- **被消费方**：`ChatTranscriptWebView` ← `ChatConversationPanel.tsx:232`；
  `ComposerInputWebView` ← `ComposerAtPathInput.tsx:229`（chat 链）与
  `PromptMacroTextInput.tsx:157`（宏链）；`CodeEditorWebView` ← `FileEditorScreen.tsx:322` +
  `PromptEditorScreen.tsx:397/444`；`RichDocumentWebView` ← 文件预览链。

## 发现清单

### F-w8-ds-webbridge-a-1 | P2 | `apps/mobile/src/components/chat/ChatTranscriptBridge.ts:189`

```ts
| BridgeEnvelope<'messagePatch', {messageId: string; patch: unknown}>
```

**描述**：`messagePatch` 是**双向死协议项**——RN 侧全仓 0 个发送点（`apps/` + `packages/`
grep `'messagePatch'` 仅 3 处命中，全是声明与注释）；web 侧 `runtime/bridge.ts:45-142` 的
switch **无此 case**，落到 `:140 default: break`。它只在最初的迭代 spec 里被规划过
（`docs/Iterations/mobile-webview-chat-transcript/spec.md:95`），从未落地。
**建议**：删除该 union 成员，或补齐实现（RN 侧发 + web 侧 case）。按当前形态它对
`postToWeb` 的调用方是纯噪音——类型允许发、web 静默丢弃，是典型的"误以为生效"陷阱。
**置信**：confirmed。

### F-w8-ds-webbridge-a-2 | P3 | `apps/mobile/src/components/chat/ChatTranscriptBridge.ts:253-256`

```ts
| BridgeEnvelope<
    'log',
    {level: string; message: string; fields?: Record<string, unknown>}
  >
```

**描述**：`log` 声明在 transcript 的 web→RN 清单里，但 web 侧**从不发**——全仓
`post('log'` / `type: 'log'` 在 `src/web/**` 下 0 命中；RN 侧 `ChatTranscriptWebView.handleMessage`
也没有 `log` 分支（走到 `:1435` 的 visibility 判断后直接 return）。同样的 `log` 也挂在
`RichDocumentBridge.ts:87-90`，两侧同样无发送方。
**建议**：二选一——删掉声明，或在 web 侧接 console（AGENTS.md 记忆条目里提过
"调试可用 bridge 协议的 `log` 消息通道接 console"，但代码里没有这个接线）。
**置信**：confirmed。

### F-w8-ds-webbridge-a-3 | P3 | `apps/mobile/src/components/vfs/RichDocumentBridge.ts:91-96`

```ts
/** @deprecated 不再作为主通道；保留解码兼容。 */
| BridgeEnvelope<'selectionAnnotate', {text: string}>
/** @deprecated 生产不再发送；仅解码兼容。 */
| BridgeEnvelope<'selectionCollect', RichDocumentSelectionCollectPayload>
```

**描述**：`selectionAnnotate` / `selectionCollect` 两条已标 `@deprecated`，web 侧对应实现
`annotate-collect.ts:60 collectAnnotateSelection` 也标了 `@deprecated` 且注释自陈
"仅测用 / 工具层残留，不挂 window"（生产新建批注走 `reportRecogitoCreateFromSelection`）。
**建议**：维持现状（解码兼容有历史消息价值），但 `collectAnnotateSelection` 的生产可达性
为零，只剩测试在跑，可评估一并退役。
**置信**：intentional（代码与注释均显式声明退役意图）。

### F-w8-ds-webbridge-a-4 | P2 | `apps/mobile/src/components/chat/ChatTranscriptBridge.ts:112-114`

```ts
/** @deprecated Stream tail is owned by streamDelta/streamReset only. */
readonly stream?: TranscriptStreamState;
```

**描述**：`sessionSnapshot.stream` 字段 RN 侧 0 发送点（`sendSessionSnapshotNow` 的
payload 构造 `:898-917` 不含它），web 侧 `snapshot.ts` 的 `SnapshotPayload`（`:30-41`）
**根本没有这个字段**，`applySnapshot` 自己重置 `state.stream`（`:240-248`）。声明标了
`@deprecated` 但仍在必填位之外的可选位上，属于"看起来能用其实两侧都不认"。
**建议**：删除字段（连同 `TranscriptStreamState` 的引用面评估）。
**置信**：confirmed。

### F-w8-ds-webbridge-a-5 | P2 | `apps/mobile/src/components/chat/ChatTranscriptBridge.ts:70-74`

```ts
| {
    readonly kind: 'stream';
    readonly text: string;
    readonly thinking: string;
  };
```

**描述**：`TranscriptRow` 的 `kind:'stream'` 变体在**两侧对不上账**——
（a）生产侧唯一能产出它的入口是 `message-blocks.ts:527-536`（`buildTranscriptRows` 的
stream 分支），而唯一生产调用者 `ChatTranscriptWebView.tsx:1302-1309 sendPrependPage`
第二个参数传的是 `undefined`，`buildTranscriptRowsWithContext`（`:547-555`）压根没有
stream 参数；
（b）web 侧 `state/state.ts:57` 的 `TranscriptRow = MessageRow`（只有 `kind:'message'`），
`RowList.tsx:59` 只渲染 `kind==='message'`、`snapshot.ts:391` 的 `applyStreamCommitNow`
只收 `kind==='message'`。即便真发一条 stream 行，web 侧会**静默丢弃**。
**建议**：删掉该变体，或让 web 侧显式支持。当前形态是"类型允许、运行时丢"。
**置信**：confirmed。

### F-w8-ds-webbridge-a-6 | P2 | `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:571`

```ts
postToWeb({
  v: 1,
  type: 'streamToolInvoking',
```

**描述**：**三域的 RN 宿主把协议版本写成字面量 `v: 1` 而不用已导出的常量**——
`ChatTranscriptWebView.tsx` 15 处、`RichDocumentWebView.tsx` 8 处（`:174` 等）、
`CodeEditorWebView.tsx` 5 处（`:94` 等）；只有 `ComposerInputWebView.tsx` 8 处正确用
`COMPOSER_INPUT_BRIDGE_VERSION`。三个 `*Bridge.ts` 都导出了 `*_BRIDGE_VERSION` 常量却
在自家壳里一个都不用。协议升版时这三域会漏改，而漏改的表现是 web 侧
`matchHostMessage`（`host-message-channel.ts:35`）**静默丢弃全部消息**——无任何报错。
**建议**：三域统一替换为常量（与 composer-input 对齐）；`decode*` 的抛错口径已是好的
fail-fast，缺的只是发送侧的一致性纪律。
**置信**：confirmed。

### F-w8-ds-webbridge-a-7 | P2 | `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:670`

```ts
if (streamRafRef.current != null) {
  return;
}
streamRafRef.current = requestAnimationFrame(() => {
```

**描述**：`flushPendingStreamDeltas`（`:664`）与 `flushPendingStreamBatch`（`:722`）
**共用同一个 `streamRafRef` 坑位**，且两者的早退分支都是"坑位被占就直接 return、不排期"。
时序：`queueStreamDelta` 先占坑 → 同一帧内 `queueStreamBatch` 把 segments 追加进
`pendingStreamSegmentsRef` 后调 flush → **坑位被占、直接 return、不排期** → 该 RAF 只发
delta。batch 的 segments 只能等下一次 batch/delta 到来时 piggyback；若此后流式结束，
它们会一直滞留到 `commitStreamTail` → `clearLocalStreamBuffers`（`:496-509`）被清空。
**影响**：不丢最终数据（`streamCommit` 的行由 DB 消息构造），但流式尾块会出现**短暂缺字**
（最后一批 wire 片段没上屏）。service 层 `session-stream-unit.ts:19` 的注释也提到
"pushStreamBatch / pushStreamDelta 恰好一次"的注入语义，这条路径会让该保证打折。
**建议**：让 delta RAF 回调在发完 delta 后检查 `pendingStreamSegmentsRef` 非空则续排一次
batch flush（或用两个独立 RAF 槽）。
**置信**：confirmed（读码推导，未在真机复现；建议补一条"同帧先 delta 后 batch"的用例）。

### F-w8-ds-webbridge-a-8 | P2 | `apps/mobile/src/components/agent/PromptMacroTextInput.tsx:79`

```ts
function maxHeightFromStyle(style: StyleProp<TextStyle>): number | null {
  const flat = StyleSheet.flatten(style) as {maxHeight?: unknown} | undefined;
  const value = flat?.maxHeight;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
```

**描述**：composer-input 协议**没有 `setMetrics`**（`ComposerInputWebView.tsx:14` 注释
"metrics 为挂载期静态参数"），`init` 只在 `webReady` 时发一次（`:276-294`）。而宏链的
`metrics` 是从 props style 派生的 `useMemo`（`:105-108`），style 变化 → metrics 变化 →
**新 metrics 永不下发**，web 侧继续用首次 init 的值。当前生产 style 来自
`ExpandablePromptInput.tsx:137` 的静态 `styles.inlineInput`（maxHeight 176），恒定，
所以暂无实害；但这是一条**协议缺口**，不是"设计上就是静态"——协议层根本没给更新通道。
**建议**：要么把"metrics 挂载期静态"提升为显式契约（在 `ComposerInputBridge.ts` 的
`ComposerInputInitPayload` 上写死并在类型层禁止后续变更的误用），要么补 `setMetrics`。
**置信**：confirmed（缺口确认）/ intentional（当前无实害）。

### F-w8-ds-webbridge-a-9 | P3 | `apps/mobile/src/webview-host/chat-transcript/scroll.ts:11`

```ts
export function nearBottom(scrollTop, scrollHeight, clientHeight, threshold = NEAR_BOTTOM_THRESHOLD_PX)
```

**描述**：该文件 6 个导出里，**只有 `scrollTopForOffsetFromBottom` 有生产消费方**
（`web/chat-transcript/.../render/snapshot.ts:10` 唯一一处 import）。另外 5 个
（`nearBottom` / `offsetFromBottom` / `scrollTopForBottom` / `scrollTopAfterPrepend` /
`clampScrollTop`）**只被 `__tests__/chat-transcript-scroll.test.ts` 消费**。
同时 web 侧另有一套 DOM 版等价实现（`runtime/scroll/scroll.ts:10 offsetFromBottom(el)` /
`:24 clampScrollTop(el, prev)`），二者数值口径相同但 API 形态不同（数值三元组 vs HTMLElement）。
**建议**：要么让 web 侧统一走数值版（删 DOM 版），要么把 `webview-host/scroll.ts` 里无消费
的 5 个导出删掉——当前形态是"测试覆盖度看起来很高，实际测的是没人跑的代码"。
**置信**：confirmed。

### F-w8-ds-webbridge-a-10 | P3 | `apps/mobile/src/webview-host/chat-transcript/menu-overlay-guards.ts:13`

```ts
export function shouldCancelLongPressForMove(
  deltaX: number, deltaY: number,
  tolerancePx: number = LONG_PRESS_MOVE_TOLERANCE_PX,
): boolean {
```

**描述**：两个导出**都只被 `__tests__/menu-overlay-guards.test.ts` 消费**，生产 0 引用。
`shouldCancelLongPressForMove` 对应的长按路径已整体退役（`menu.ts:20` 注释
"长按开菜单主路径已移除"，入口改为气泡 ⋯ 按钮 `openContextMenuFromAnchor`）；
`shouldIgnoreMenuOutsideDismiss` 的逻辑被 `menu.ts:194-202` **内联重写**了一份
（同样的 `MENU_OPEN_GRACE_MS` + `.row.message` + touchend 判定）。
**建议**：删除该模块及测试，或反过来让 `menu.ts` 改为 import 它消除重复实现。
**置信**：confirmed。

### F-w8-ds-webbridge-a-11 | P3 | `apps/mobile/src/webview-host/chat-transcript/stream-tail-html-state.ts:5`

```ts
export function nextStreamTailHtmlField(
  richText: boolean, incomingHtml: string | undefined | null,
): string | null {
```

**描述**：唯一消费方是 `__tests__/stream-tail-html-state.test.ts`；生产实现是
`web/chat-transcript/.../stream/stream.ts:566-579` 的**内联同款判定**
（`if (html) … else if (state.flags.richText) …`）。该文件放在 `webview-host/` 下
（按"双侧共用真源"的定位）却只有测试在跑，是**定位与实际用途不符**的死文件。
**建议**：删除，或让 `stream.ts` 改为 import 它。
**置信**：confirmed。

### F-w8-ds-webbridge-a-12 | P3 | `apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts:35`

```ts
if (msg.type === 'init') {
  applyHostTheme(p.theme);
  if (p.flags) { state.flags = {…}; }
```

**描述**：web 侧对 `init.payload.flags` 做**存在性守卫**（缺省则保留模块初值
`{richText:false, menuDisabled:false}`），而 RN 侧类型把 `flags` 声明为**必填**
（`ChatTranscriptBridge.ts:106` `payload: {theme: TranscriptTheme; flags: TranscriptFlags}`）。
两侧宽严不一致本身无害，但叠加 F-6 的"发版漏改"风险后，含义是：一旦 RN 侧漏发 flags，
web 会**保留上一轮的值**而不是复位——切会话时可能残留旧的 richText/menuDisabled。
**建议**：web 侧改成无条件写（`flags` 已是必填），缺失时显式复位到默认，避免"继承上一轮"。
**置信**：suspected（缺 flags 的具体触发路径未构造出来，属防御性加固建议）。

### F-w8-ds-webbridge-a-13 | P3 | `apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts:42`

```ts
const msg = matchHostMessage(raw, BRIDGE_V);
if (!msg) return;
```

**描述**：协议版本不匹配时 `matchHostMessage` 返回 null、此处静默 return，**无任何日志**。
四域全部如此（`host-message-channel.ts:35` 是唯一判定点）。配合 F-6 的字面量 `v: 1`，
一次漏改升版的表现是"chat 区域整块空白且无任何线索"。
**建议**：`matchHostMessage` 在 v 不匹配时 `console.warn` 一次（webview 内 console 可经
logcat 看到），把静默失败变成可诊断失败。
**置信**：confirmed。

### F-w8-ds-webbridge-a-14 | P3 | `apps/mobile/src/components/vfs/RichDocumentWebView.tsx:181`

```ts
const handleMessage = useCallback((event: WebViewMessageEvent) => {
  try {
    const message = decodeRichDocumentToHost(event.nativeEvent.data);
    if (message.type === 'copyCode') { … }
```

**描述**：rich-document 的 `handleMessage` 把 **decode + 全部业务分支**包在同一个
`try { … } catch { /* ignore malformed messages */ }` 里（`:181-241`）；另外三域只把
`decode*` 包在 try 内（`ChatTranscriptWebView.tsx:1326-1331`、
`ComposerInputWebView.tsx:239-244`、`CodeEditorWebView.tsx:126-131`）。
后果：`onRecogitoCreateRef.current?.(…)`（`:212`）或 `onAnnotateOpenRef.current?.(ids)`
（`:228`）内部若抛错，会被这个 catch 静默吞掉，表现为"批注点了没反应"且无日志。
**建议**：收窄 try 到 decode 一行，与另外三域对齐。
**置信**：confirmed（结构差异确认；回调抛错的实际发生率未验证）。

### F-w8-ds-webbridge-a-15 | P3 | `apps/mobile/src/components/chat/ComposerInputWebView.tsx:97`

```ts
/**
 * 外部要求失焦（照 code-editor）。
 * 当前无调用方，留作发送后收键盘等未来需求。
 */
blur: () => void;
```

**描述**：`blur` 在四域里只有它没有生产调用方——`apps/mobile/src` 全量 grep `.blur(`
只有 `FileEditorScreen.tsx:208` / `PromptEditorScreen.tsx:319` 两处，都是
**codeEditor** 的 ref。composer-input 的 `blur` 从未被调。协议本身是通的
（web 侧 `composer-input/.../editor.ts:489 blurComposerInput` 有实现），只是无人发。
**建议**：保留（注释已自陈意图），记为已知空档；不要在 CR 里当 bug 提。
**置信**：intentional。

### F-w8-ds-webbridge-a-16 | P3 | `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:42`

```ts
const STATE_PAINTING_HOST_MESSAGES: ReadonlySet<string> = new Set([…]);
import {
  buildTranscriptRows,
```

**描述**：模块级 `const` 声明**夹在两条 import 语句中间**（上 `:37` 结束 import，
`:42-53` 是 const，`:54` 又 `import {...} from './message-blocks'`）。语法合法
（import 会被提升），但可读性差且容易让后来者以为 import 不完整。
**建议**：把该常量移到所有 import 之后。
**置信**：confirmed（风格项，非缺陷）。

### F-w8-ds-webbridge-a-17 | P3 | `apps/mobile/src/webview-host/webview-asset-uri.ts:54`

```ts
throw new Error(`WebView 资产 URI 不支持平台: ${Platform.OS}`);
```

**描述**：非 android/ios 平台**同步 throw**，而调用点在组件 render 期
（`ChatTranscriptWebView.tsx:1817 source={{uri: getChatTranscriptUri()}}`，
composer-input / code-editor / rich-document 同款）。mobile 当前只发双端，
macOS/Windows 复用该壳会在 render 直接崩。
**建议**：若将来要支持 macOS，需改成惰性降级。当前形态**与"只发双端"的既定范围一致**，
不是 bug。
**置信**：intentional。

### F-w8-ds-webbridge-a-18 | P3 | `apps/mobile/src/web/shared/host-message-channel.ts:44`

```ts
document.addEventListener('message', onMessage as EventListener);
window.addEventListener('message', onMessage as EventListener);
```

**描述**：**document + window 双注册是必需的**（不是冗余）——实测 RN WebView 的原生注入：
Android `RNCWebViewManagerImpl.kt:330-335` 走 `document.dispatchEvent(new MessageEvent(...))`，
iOS `RNCWebViewImpl.m:1115` 走 `window.dispatchEvent(new MessageEvent(...))`。
两侧各命中一个监听器，**不会重复触发**（Android 的 `new MessageEvent(type, init)` 未传
`bubbles`，默认 false）。
但 `:332-333` 的**兼容 fallback 分支** `document.createEvent('MessageEvent')` +
`event.initMessageEvent('message', true /*bubbles*/, true, …)` 会让事件从 document
**冒泡到 window**，两个监听器同时命中 → `handleHostMessage` **双跑**。
**影响**：仅在 `new MessageEvent` 抛异常的老内核上触发（现代 Android WebView / WKWebView
都有构造器），实际概率极低；但若触发，chat-transcript 会双跑 `sessionSnapshot` /
`streamDelta`，后者会**重复累加文本**。
**建议**：在 `onMessage` 里加一个"同一 tick 同 payload 只处理一次"的幂等闸，或直接删掉
fallback 分支（现代内核不需要）。
**置信**：suspected（fallback 分支存在且逻辑上会双触发已确认；现代内核是否真走到该分支未验证）。

### F-w8-ds-webbridge-a-19 | P3 | `apps/mobile/src/web/shared/host-message-channel.ts:16`

```ts
msg = typeof raw === 'string' ? JSON.parse(raw) : (raw as HostMessage);
```

**描述**：`parseHostMessage` 的"对象型 raw 直通"分支在生产**不可达**——RN WebView 的
`onMessage` 事件 `data` 永远是字符串（iOS 是 `postMessage(String(data))`，见
`RNCWebViewImpl.m:1782`）。该宽容分支只服务于测试
（`web-host-message.test.ts:26` 断言 `parseHostMessage(raw).toBe(raw)`）。
风险面：一旦有页面内代码调 `window.postMessage(obj)`，对象会被直接当信封消费。
**建议**：保留测试口径但补注释说明"仅 iframe/测试路径"，或在 `matchHostMessage` 里
对对象分支额外校验 `payload` 是 record。
**置信**：intentional（有测试锁定，属刻意宽容）。

### F-w8-ds-webbridge-a-20 | P3 | `apps/mobile/src/web/chat-transcript/transcript-capabilities.ts:25`

```ts
export function transcriptCapabilitiesInclude(
  capabilities: readonly string[] | undefined | null, target: string,
): boolean {
```

**描述**：能力协商（B-2）是本区**唯一做对了双侧版本/能力对齐**的机制——web 与 RN
**import 的是同一个文件**（`boot-transcript.ts:8` 用 `../../../transcript-capabilities`，
`ChatTranscriptWebView.tsx:72` 用 `@/web/chat-transcript/transcript-capabilities`），
web 在 `ready` 上报 `capabilities`，RN 据 `transcriptCapabilitiesInclude` 决定是否发
`streamBlockCommit`（`:1345-1348`），未声明则退回全量 html 路径。
但**其余三域（rich-document / code-editor / composer-input）完全没有这层协商**，
只靠 `BRIDGE_V === 1` 的相等判断；且**只有 composer-input 有双端 BRIDGE_V 一致性测试**
（`composer-input-bridge.test.ts:30-33`）。
**建议**：把 capabilities 模式推广到另外三域（至少 code-editor，它的 `setDocument` 载荷
在迭代中改过），或至少给三域各补一条"RN 常量 === web 常量"的断言测试——现在
`chat-transcript` / `code-editor` / `rich-document` 的 BRIDGE_V 一致性靠人眼维持。
**置信**：confirmed。

### F-w8-ds-webbridge-a-21 | P3 | `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:1437`

```ts
const dirty = statePushSinceResumeRef.current > 0;
```

**描述**：`statePushSinceResumeRef` 只在 `postToWeb` 里对
`STATE_PAINTING_HOST_MESSAGES`（`:42-53`，10 个改画类 type）累加（`:529-531`），
唯一的清零点是这个 visibility 分支（`:1438`）。若页面**从未触发过
`visibilitychange` 的 hidden=false 事件**（Android WebView 在 RN 场景下的常见形态），
计数器只增不减；后续任意一次真实的"恢复可见"事件都会判定为 dirty 并触发
**强制重挂 WebView + 全量快照**（`:1439-1447`）。这条重挂路径本身有代价（重建 DOM +
重发快照）。
**建议**：确认 Android 侧 `document.visibilitychange` 的实际触发条件；若不可靠，改为
`onFocus`/`componentDidMount` 之类的宿主侧信号驱动，别依赖页面 visibility 事件。
**置信**：suspected（逻辑推导清晰；visibilitychange 在 RN WebView 下的实际触发率未实测）。

### F-w8-ds-webbridge-a-22 | P3 | `apps/mobile/src/web/code-editor/webview/runtime/bridge.ts:49`

```ts
if (msg.type === 'blur') {
  blurEditor();
}
```

**描述**：code-editor 的 `handleHostMessage` 是四域里唯一**没有 `default: break` 收尾**、
也没有 switch 的（其余用 if 链 + 显式早退）。功能上无差（if 链落到末尾即结束），
但与另外三域形态不一致，且 `blur` 分支后缺 `return` 属风格瑕疵。
同域的 `init` 与 `themeUpdate` 两个分支体**完全相同**（都是 `applyTheme`），
`ChatTranscriptWebView.tsx` / `RichDocumentWebView.tsx` 也有同样的 `sendInit` +
`themeUpdate` 双发（ready 后连发两条主题消息，第二次是冗余的）。
**建议**：合并 code-editor 的两个 theme 分支；四域 init 语义统一（要么 init 只带
能力不带主题，要么接受"ready 后双发主题"并在注释里写明）。
**置信**：confirmed（结构/冗余确认；冗余发消息的开销未实测，量级为一次小 JSON）。

## 争议与存疑

1. **F-7（共用 RAF 坑位）的严重度**。我定为 P2，理由是它会让最后一批 wire 片段滞留到
   `commitStreamTail` 被清空。但**未在真机复现**——若 `session-stream-unit` 的注入路径
   实际上不会出现"同帧先 delta 后 batch"（例如 batch 只在 step 边界注入、delta 只在
   step 内注入，两者天然不同时到），这条就降为 P3。需要读
   `services/session-stream-unit.ts` 的注入时序才能定论，我把它列为存疑而没有当 P1。

2. **F-21（visibilitychange 可信度）**。整个"旧帧强制重挂"机制
   （`ChatTranscriptWebView.tsx:428-448` + `:1434-1451`）都建立在
   `web/.../bridge.ts:35-39` 注册的 `document.visibilitychange` 上。这条链路在
   Android RN WebView 下是否可靠触发，我**没有真机证据**。代码注释把它写成已解决的
   根因（"生成中残留的根因"），但如果该事件在本环境不触发，整套重挂就是死代码。
   这条建议单独立项验证，不要在 CR 里直接判死。

3. **"测试覆盖的是没人跑的代码"这一类问题（F-9 / F-10 / F-11）该算几级**。三处都是
   `webview-host/` 下的模块被自己的单测完整覆盖、但生产 0 引用。严格说它们不产生运行时
   缺陷（死代码不进 bundle 的运行路径——但 `anchored-menu-layout.ts` 是**进**的，
   因为 `menu.ts:6` 与 RN 侧都 import 它，所以那三个文件不进任何 bundle）。
   我按"误导性覆盖度 + 双实现漂移风险"记 P3，而非按缺陷记 P2。若 reduce 阶段认为
   这属于纯清理，可整体降为 P4/合并成一条。

4. **协议死消息（F-1 / F-2 / F-4 / F-5）是否该删**。`messagePatch` 在最初的 spec 里被规划过
   （`mobile-webview-chat-transcript/spec.md:95`），`log` 在 AGENTS 记忆里被描述为
   "可用的调试通道"。也就是说它们是**"规划过但没做完"**而非"做完又删"。删还是补，
   取决于是否还打算做增量行更新（`messagePatch` 若实现，能显著缓解 F-21 的全量重挂压力）。
   这个取舍我不替主代理做，标为待裁决。

5. **未纳入本区但被本区协议触及的两处**：`message-blocks.ts` 的行构造
   （`TranscriptToolView` / `TranscriptAttachmentView` 字段对账）与 `ui/` 渲染组件。
   我只按"协议字段是否两侧对得上"做了抽查（`resultContent` / `subagentSessionId` /
   `skillRef` / `attachments` 四组均两侧有对应消费方，`action` 枚举 9 值两侧一致），
   未做逐字段渲染语义审查——那属于 mobile-chat-ui 域。