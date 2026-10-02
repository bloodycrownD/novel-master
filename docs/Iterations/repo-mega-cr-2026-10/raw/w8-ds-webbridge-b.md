---
zone: w8-ds-webbridge-b
agent: 独立双扫 B（ds 双扫，不读另一份）
files_scanned: 41
---

# W8 独立双扫 B：apps/mobile WebView 桥协议双侧（w8-ds-webbridge-b）

## 摘要

apps/mobile 有 4 个内嵌 WebView（chat-transcript / code-editor / composer-input / rich-document），
每域两侧各有一套手写的桥：WebView 内 `src/web/<pkg>/webview/runtime/bridge.ts`（收 host 消息 + post 出口）
与 RN 侧 `src/components/{chat,vfs}/<X>Bridge.ts`（类型信封真源 + encode/decode）。
`src/webview-host/` 是两侧共享的宿主侧纯函数（uri 解析、滚动数学、锚定菜单布局、手势守卫）。
协议统一为 JSON 信封 `{v, type, payload}`，WebView 侧一律经 `@web/shared/post` 出口、
`@web/shared/host-message-channel` 入口，两条 bundle 链路（esbuild + Metro）用 `@web` / `@` 双别名对齐。

## 职责与边界

- **协议真源在 RN 侧**：`XxxBridge.ts` 声明 `HostTo*Message` / `*ToHostMessage` 联合类型 + `encode/decode`。
  WebView 侧 `bridge.ts` 的 `switch` 分支是这份联合类型的**手写镜像**，编译器不校验两侧一致（见发现 F-1）。
- **WebView 侧只做三件事**：解析（`matchHostMessage`，坏信封静默丢）、分派到 render 模块、post 出口。
- **`src/webview-host/`** 是「RN 与 web 双端共用的宿主纯函数」目录，被 Metro（`@/` 别名）与
  esbuild（`scripts/build-webview.mjs:69` 的 `alias: {'@': src}`）**双向消费**——这是本区最反直觉的边界。
- 不含：bridge 之上的渲染实现（`render/*`、`stream/*`）、mermaid 渲染内核、批注业务。
  这两块被本报告当作「对端」引用，不做主责判定。

## 对外接口

| 域 | Web 侧入口 | RN 侧类型真源 | RN 侧 WebView 壳 |
|---|---|---|---|
| chat-transcript | `src/web/chat-transcript/webview/runtime/bridge.ts:41` `handleHostMessage` / `:31` `post` | `src/components/chat/ChatTranscriptBridge.ts` | `src/components/chat/ChatTranscriptWebView.tsx:1323` `handleMessage` |
| code-editor | `src/web/code-editor/webview/runtime/bridge.ts:13` | `src/components/vfs/CodeEditorBridge.ts` | `src/components/vfs/CodeEditorWebView.tsx:125` |
| composer-input | `src/web/composer-input/webview/runtime/bridge.ts:27` | `src/components/chat/ComposerInputBridge.ts` | `src/components/chat/ComposerInputWebView.tsx:237` |
| rich-document | `src/web/rich-document/webview/runtime/bridge.ts:52` | `src/components/vfs/RichDocumentBridge.ts` | `src/components/vfs/RichDocumentWebView.tsx:180` |

共享层导出：`@web/shared/post.ts`（`post` / `createBoundPost`）、`@web/shared/host-message-channel.ts`
（`parseHostMessage` / `matchHostMessage` / `bindHostMessageChannel`）、`@web/shared/host-theme.ts`（`applyHostTheme`）、
`@web/shared/code-copy.ts`（`attachCodeCopyDelegation`）、`@web/shared/mermaid-fullscreen/mermaid-fullscreen.ts`
（`closeMermaidViewer` / `attachMermaidViewerDelegation` / `mountMermaidViewerPortal`）。

`src/webview-host/` 导出：`webview-asset-uri.ts`（`getWebViewPackageIndexUri` / `getWebViewPackageDirUri`）、
`*/uri.ts` × 4（薄 re-export）、`chat-transcript/scroll.ts`、`chat-transcript/anchored-menu-layout.ts`、
`chat-transcript/menu-overlay-guards.ts`、`chat-transcript/stream-tail-html-state.ts`。

## 依赖关系

**WebView 侧 import 谁**（实测 `rg "post\('"` 覆盖 4 个 runtime 全部 post 出口）：
`@web/shared/*`（4 域全用）、`@web/shared/constants`（`NEAR_BOTTOM_THRESHOLD_PX` 等）、
`@web/shared/host-theme`（chat-transcript / rich-document / code-editor）、
`../../../../../webview-host/chat-transcript/scroll`（`src/web/chat-transcript/webview/runtime/render/snapshot.ts:10`，
**web 代码反向 import RN 侧目录**）。
`@/` 别名只在 `webview-host/*` 内部用（`menu-overlay-guards.ts:5`、`scroll.ts:7`），
由 esbuild 的 `'@': join(mobileRoot,'src')` 兜住（`scripts/build-webview.mjs:68-69`）——**不是 bug，是被文档化的设计**。

**被谁消费**：
`ChatTranscriptBridge.ts` ← `ChatTranscriptWebView.tsx` / `message-blocks.ts` / `enrich-transcript-rows.ts` /
`ChatTabProvider.tsx` / `useChatTabStream.ts`；
`ComposerInputBridge.ts` ← `ComposerInputWebView.tsx` / `ComposerAtPathInput.tsx` / `PromptMacroTextInput.tsx`；
`CodeEditorBridge.ts` ← `CodeEditorWebView.tsx`；`RichDocumentBridge.ts` ← `RichDocumentWebView.tsx` / `FileMarkdownPreview.tsx`。

## 数据访问

本区**不触碰任何表 / KKV 域 / 磁盘数据**，唯一的 IO 面是 WebView 资产路径解析：

- Android：`file:///android_asset/webview/<pkg>/index.html`（`src/webview-host/webview-asset-uri.ts:49,62`）
- iOS：`file://<MainBundleDir>/WebViewDist/<pkg>/index.html`（同文件 `:52,65`）
  —— `MainBundleDir` 经 `react-native-blob-util` 的 `fs.dirs` 取（`webview-asset-uri.ts:14-24,28`），
  **只读目录常量，不做文件存在性探测**（`:44-45` 注释显式声明）。
- 滚动快照唯一状态载体：`services/chat-transcript-scroll-cache.ts` → `createScopeKeyCache`，
  纯内存 `Map` LRU（`services/scope-key-cache.ts:24-70`），上限 500，无 AsyncStorage/MMKV 落盘。
- WebView 安全姿态（4 域一致，`ChatTranscriptWebView.tsx:1816-1824` / `CodeEditorWebView.tsx:223-231` /
  `RichDocumentWebView.tsx:375-383` / `ComposerInputWebView.tsx:440-447`）：
  `originWhitelist={['file://']}` + `allowFileAccess` + `allowFileAccessFromFileURLs` +
  `allowingReadAccessToURL=<包目录>` + `onShouldStartLoadWithRequest` 前缀守卫（sec/D-1）+ `onOpenWindow` 外跳。
  未开 `allowUniversalAccessFromFileURLs`。

## 发现清单

### 消息类型对账表（实测得出，非照抄文档）

**chat-transcript · host → web**（RN 发送点 `ChatTranscriptWebView.tsx` 15 处 `type:`，全部命中联合类型）：
`init` / `sessionSnapshot` / `prependPage` / `appendTailRows` / `streamCommit` / `streamDelta` /
`streamBatch` / `streamBlockCommit` / `streamReset` / `streamToolInvoking` / `themeUpdate` /
`flagsUpdate` / `closeMenu` / `closeMermaidViewer` / `stickIfNearBottom` = 15 条，
web 侧 `bridge.ts:45-142` 的 switch **恰好 15 个 case**，一一对齐。

**chat-transcript · web → host**（web 发送点 13 处，RN `handleMessage` 处理 15 个 `message.type ===`）：
`ready` / `scrollSnapshot` / `loadOlder` / `openMessageMenu` / `messageMenuAction` / `menuOpened` /
`menuClosed` / `openToolFile` / `linkClick` / `openSubagentSession` / `openSkillDetail` /
`mermaidViewerOpened` / `mermaidViewerClosed` / `copyCode` / `visibility` = 15 条，双侧齐平。

**code-editor**：host→web 4（`init`/`themeUpdate`/`setDocument`/`blur`）↔ web 4 case；web→host 5 ↔ RN 5 handler。全对齐。
**composer-input**：host→web 6 ↔ web 6 case；web→host 6，RN 只处理 4（`focus`/`blur` 显式丢弃，见 F-6）。
**rich-document**：host→web 7 ↔ web 7 case；web→host 8，RN 处理 6（3 条 `@deprecated` 保留兼容，见 F-7）。

---

**F-w8-ds-webbridge-b-1 | P2 | `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:820-830` + `apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts:46-54,107-126`**

```ts
// RN: sendInit 的依赖含 uiRunning / flags?.richText / tokens
const sendInit = useCallback(() => { ... postToWeb({v:1, type:'init', payload:{theme, flags: resolvedFlags}}) },
  [flags?.richText, postToWeb, tokens, uiRunning]);
```

> web 侧 `init` 分支：`applyHostTheme(p.theme); if (p.flags) { state.flags = {...} }`——**无条件覆写，不比对**。
> `flagsUpdate` 分支才有差分逻辑：`if (flagsEqual(state.flags, nextFlags)) break; ... if (state.flags.menuDisabled) closeContextMenu(true);`

**描述**：RN 侧 `sendInit` 的 `useCallback` 依赖 `uiRunning` 与 `flags?.richText`，而它的 effect 声明在
`ChatTranscriptWebView.tsx:1486-1491`（`[webReady, sendInit]`），**早于** `flagsUpdate` effect（`:1495-1515`）。
同一 commit 内 React 按声明序跑 effect，于是**任何一次 flags 变化都先发 `init`**，web 侧 `state.flags` 已被写成新值；
紧随其后的 `flagsUpdate` 必然命中 `flagsEqual` 而 `break`。

后果有二：
1. `flagsUpdate` 的整段差分逻辑（`richToggledOn` 判定 + `renderRows()`）**不可达**——已是死代码；
2. `if (state.flags.menuDisabled) closeContextMenu(true)` 这条**唯一**的「run 开始时收起已展开的消息菜单」防线失效。
   web 侧 `menu.ts:240` 只拦「新开菜单」，不关「已开菜单」；RN 侧 `closeMessageMenu`
   （`ChatTabProvider.tsx:397`）只在用户点菜单项 / `dismissAllOverlays` 时调用，**没有 run 启动的补偿路径**。

**可达性评估（重要）**：`handleMenuOverlayEvent`（`menu.ts:204`）在 document 捕获阶段对任何外部点击调
`closeContextMenu(true)`，所以「点发送键触发 run」这条路会先把菜单关掉，**手点路径基本不可达**。
但 `handleMessageMenuAction`（`useChatTabMessageActions.ts:474-502`）**无 `agentRunning` 守卫**，
一旦命中就是 run 流式期间执行 `edit`/`fork`/`rollback`——所以这条不按「纯死代码」放过。

**建议**：二选一并加契约测。（a）把 `sendInit` 的 `useCallback` 依赖从 `uiRunning` / `flags?.richText` 上摘掉
（init 语义是「ready 后一次快照」，注释 `ComposerInputWebView.tsx:200` 已有同款口径），
让 flags 变化只走 `flagsUpdate`；或（b）在 web `init` 分支里补齐 `flagsEqual` + `closeContextMenu` 逻辑，
使两条消息语义对称。

**置信**：confirmed（依赖序与代码已逐行核对；可达性评估为 reasoning，已如实标注）

---

**F-w8-ds-webbridge-b-2 | P2 | `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx`（15 处）、`apps/mobile/src/components/vfs/RichDocumentWebView.tsx`（8 处）、`apps/mobile/src/components/vfs/CodeEditorWebView.tsx`（5 处）**

```ts
// ChatTranscriptWebView.tsx:1511
postToWeb({ v: 1, type: 'flagsUpdate', payload: {flags: resolvedFlags} });
```

**描述**：这三个壳的**全部** host→web 消息都硬编码字面量 `v: 1`，**一次都没引用**同名导出常量
`CHAT_TRANSCRIPT_BRIDGE_VERSION` / `RICH_DOCUMENT_BRIDGE_VERSION` / `CODE_EDITOR_BRIDGE_VERSION`
（`rg BRIDGE_VERSION` 在这三文件零命中）。同仓的 `ComposerInputWebView.tsx:284,307,331,348,364,386,403`
用的是 `COMPOSER_INPUT_BRIDGE_VERSION`——**四域里三域没跟上**。

版本号一改（协议 v2），这三域会编译通过、类型全绿，但 web 侧 `matchHostMessage(raw, BRIDGE_V)`
（`host-message-channel.ts:35`）会**静默丢弃全部下行**（无 throw、无 console）。这是最难排查的一类断链。

**建议**：三域统一改引用导出常量；在 `__tests__/code-editor-bridge.test.ts` 那种契约测里加一条
「壳内不得出现 `v: 1` 字面量」的静态断言（现有 `code-copy.test.ts:74` 已经是这个套路）。

**置信**：confirmed

---

**F-w8-ds-webbridge-b-3 | P2 | `apps/mobile/src/webview-host/chat-transcript/menu-overlay-guards.ts:13-35`**

```ts
export function shouldCancelLongPressForMove(deltaX, deltaY, tolerancePx = LONG_PRESS_MOVE_TOLERANCE_PX)
export function shouldIgnoreMenuOutsideDismiss(eventType, menuOpenedAtMs, nowMs, targetIsMessageRow)
```

**描述**：**生产代码零消费者**。`rg` 全仓（含 `__tests__`）只有两处命中：文件自身与
`__tests__/menu-overlay-guards.test.ts`。原因写在 web 侧注释里——长按开菜单已下线
（`src/web/chat-transcript/webview/runtime/boot/bind-shell-events.ts:4-5`「消息菜单由气泡右上角 ⋯ 触发，
不再绑定长按开菜单」），且 `docs/apm/RULE.md:11` 记录了 2026-09-28 四轮调查后用户拍板**不做长按划词菜单**。

`shouldIgnoreMenuOutsideDismiss` 的语义被**手写内联**在 `web/chat-transcript/webview/runtime/menu/menu.ts:194-202`：

```ts
if (rowEl && event.type === 'touchend' && state.menuOpenedAt &&
    Date.now() - state.menuOpenedAt < MENU_OPEN_GRACE_MS) return;
```

**连带的死常量**：`LONG_PRESS_MOVE_TOLERANCE_PX`（`web/shared/constants.ts:13`）只被这个死文件消费。
另外 `ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT`（`constants.ts:21`）只被 `anchored-menu-layout.ts:12` re-export，
无任何消费方。

**建议**：删 `menu-overlay-guards.ts` 及其测试、删 `LONG_PRESS_MOVE_TOLERANCE_PX` 与
`ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT`；把 `menu.ts:194-202` 换成对共享 guard 的调用（若要保留单源），
或反过来把共享文件删掉、接受内联。**二选一，别两处都不动。**

**置信**：confirmed（用户拍板记录见 `docs/apm/RULE.md:11`，属「已接受的退役项」，但代码还没清）

---

**F-w8-ds-webbridge-b-4 | P2 | `apps/mobile/src/components/chat/ChatTranscriptBridge.ts:189` + `apps/mobile/src/components/chat/ChatTranscriptBridge.ts:254` + `apps/mobile/src/components/vfs/RichDocumentBridge.ts:88`**

```ts
| BridgeEnvelope<'messagePatch', {messageId: string; patch: unknown}>   // :189
| BridgeEnvelope<'log', {level: string; message: string; fields?: ...}> // :254
```

**描述**：`messagePatch` 与 `log` 是**双向死协议项**——
- `messagePatch`：RN 侧 15 个发送点无它；web 侧 `bridge.ts:45-142` 的 switch **无此 case**（落到 `default: break`）。全仓仅 3 处文本命中（声明处 + 两处注释）。
- `log`：web 侧 13 个 `post('...')` 发送点无它；RN 侧 `handleMessage` 15 个 `type ===` 无它。`RichDocumentBridge.ts:88` 同款。

**已知**（不算误报）：`docs/apm/RULE.md:73` 写「WebView JS 报错/宿主环境问题：bridge 协议里的 `log` 消息通道接 console」——
但代码里这条通道**从未接线**。同仓 `composer-input/webview/runtime/model.ts:5-6` 明确写了
「本文件是 host↔web 双向消息的**全量**清单（死消息不留：不照抄 transcript 的 `log` / `messagePatch`）」，
说明另两域是有意清理过的，只剩 transcript 没清。

**建议**：要么删（推荐，与 composer/rich 口径对齐），要么把 RULE:73 描述的 console→`log` 通道真接上。
现状是 RULE 与代码互相矛盾，下一个读 RULE 的人会以为有兜底通道。

**置信**：confirmed

---

**F-w8-ds-webbridge-b-5 | P3 | `apps/mobile/src/webview-host/chat-transcript/stream-tail-html-state.ts:5-16` + `apps/mobile/src/webview-host/chat-transcript/scroll.ts:30,50,61`**

**描述**：`webview-host/chat-transcript/` 下 8 个导出函数里 **5 个只有测试消费者**：

| 导出 | 生产消费者 |
|---|---|
| `nextStreamTailHtmlField`（`stream-tail-html-state.ts:5`） | 无（仅 `__tests__/stream-tail-html-state.test.ts`） |
| `scrollTopForBottom`（`scroll.ts:30`） | 无（仅 `__tests__/chat-transcript-scroll.test.ts`） |
| `scrollTopAfterPrepend`（`scroll.ts:50`） | 无（同上） |
| `clampScrollTop`（`scroll.ts:61`） | 无（同上）——web 侧 `runtime/scroll/scroll.ts:24` 有 DOM 版同名函数在真跑 |
| `offsetFromBottom`（`scroll.ts:21`） | 无——web 侧 `runtime/scroll/scroll.ts:10` 有 DOM 版同名函数在真跑 |
| `nearBottom`（`scroll.ts:11`） | 无 |
| `scrollTopForOffsetFromBottom`（`scroll.ts:38`） | **有**：`runtime/render/snapshot.ts:10,261,272,340,435` |
| `MESSAGE_ACTION_MENU_ITEM_COUNT`（经 anchored-menu-layout re-export） | **有**：`web/.../ui/menu/MenuOverlay.tsx:49` |

`offsetFromBottom` / `clampScrollTop` 出现**数值版（死）与 DOM 版（在跑）同名双实现**，是最容易误读的一处。

**建议**：`stream-tail-html-state.ts` 整文件退役；`scroll.ts` 收缩到只剩 `scrollTopForOffsetFromBottom`
（或把那两个 DOM 版反 dead-code 化、删数值版，择一）。

**置信**：confirmed

---

**F-w8-ds-webbridge-b-6 | P3 | `apps/mobile/src/components/chat/ComposerInputWebView.tsx:272` + `apps/mobile/src/components/chat/ComposerInputBridge.ts:79-81`**

```ts
// focus / blur：键盘链路由 keyboard-controller insets 驱动，当前无消费，丢弃。
```

**描述**：composer-input 的 web→host 联合类型含 `focus` / `blur`（`ComposerInputBridge.ts:79-80`），
web 侧确实在发（`web/composer-input/webview/runtime/editor.ts:519,524`），RN 侧**显式丢弃**。
每键入/失焦多跨一次桥。同型对照：`CodeEditorWebView.tsx:146-152` 消费了 `focus`/`blur`，
所以这是**两域行为不一致**，不是全局约定。

注释已写明「当前无消费」——**不按 bug 报**，按协议冗余报。

**建议**：要么删协议项 + web 侧发送点（省两次跨桥/焦点周期），要么接上
（`ComposerInputWebView` 有 `onFocusChangeRef` 模式可抄 `CodeEditorWebView.tsx:146`）。
参照 `code-editor/webview/runtime/editor.ts:33-37` 的注释——那里已经把「无消费方就不发」的
`composerTokenEnabled(currentPath)` 条件写进代码了，composer-input 缺同款短路。

**置信**：confirmed（丢弃行为）／intentional（协议保留，注释已声明）

---

**F-w8-ds-webbridge-b-7 | P3 | `apps/mobile/src/components/vfs/RichDocumentBridge.ts:47,92,96`**

**描述**：`selectionAnnotate` / `selectionCollect` / `log` 三条 web→host 消息，
标注为 `@deprecated … 仅保留解码兼容；MD 主路径已改 recogitoCreate`。
实测 web 侧唯一的批注发送点是 `web/rich-document/webview/runtime/annotate-collect.ts:139` 的 `recogitoCreate`。
**与 `docs/apm/RULE.md:11` 记录的拍板一致（MD 主路径走 recogitoCreate）**，属有意保留的迁移兼容层。

**建议**：不删。在类型上补 `@deprecated` 的 ts 编译期标注（目前只是 JSDoc 注释，无 tsc 层面的
`@deprecated` 提示），让未来 IDE 能给出删除提示。

**置信**：intentional（引 `docs/apm/RULE.md:11`）

---

**F-w8-ds-webbridge-b-8 | P3 | `apps/mobile/src/components/vfs/CodeEditorWebView.tsx:100-123`**

```ts
useImperativeHandle(ref, () => ({
  blur: () => { postToWeb({v: 1, type: 'blur', payload: {}}); },
  setText: (text, selection) => { postToWeb({v: 1, type: 'setDocument', payload: {...}}); },
}), [postToWeb, path]);
```

**描述**：命令式 `setText`/`blur` **无 `webReady` 守卫**，而同款实现
`ComposerInputWebView.tsx:373-407` 明确做了守卫并留了理由注释：

```ts
setText(text, nextSelection) { if (!webReady) { /* 未就绪不写基线：ready 后 value 差分 effect 会补齐全量写入 */ return; } ... }
```

`CodeEditorWebView` 缺的正是这条兜底：`useEffect([webReady, value, path])` 的 `setDocument` effect
（`:176-185`）会在 ready 后补发全量，所以**丢的是选区**（`selectionStart/End`）不是文本——
`PromptEditorScreen.tsx:226` 的 `commitDraft` 靠 `setText` 的 `selection` 落光标，光标会退到文末。
同文件 `:319` 的 `codeEditorRef.current?.blur()` 也会在未就绪时静默丢。

**可达性**：需在 WebView ready 之前触发 typeahead 点选（用户交互路径基本不可能）；
WebView 被系统回收重建（`onShouldStartLoadWithRequest` 白名单不变，通常不重载）时才现实。
**故定 P3**，但同仓已有正确写法，属明确的不一致。

**建议**：照抄 `ComposerInputWebView` 的守卫与注释；或把四个壳的 `postToWeb` 统一收敛到一个
带 `webReady` 守卫的 hook（`ChatTranscriptWebView.tsx:523-533` 的 `webReadyRef` 版本是最完整的）。

**置信**：confirmed（代码）；reachable-in-practice 存疑，已标注

---

**F-w8-ds-webbridge-b-9 | P3 | `apps/mobile/src/components/vfs/RichDocumentWebView.tsx:244-260` + `apps/mobile/src/components/vfs/CodeEditorWebView.tsx:158-174`**

```ts
const sendInit = useCallback(() => { postToWeb({v:1, type:'init', payload:{theme: themeFromTokens(tokens)}}); }, [postToWeb, tokens]);
useEffect(() => { if (!webReady) return; sendInit(); }, [webReady, sendInit]);   // :158-163
useEffect(() => { if (!webReady) return; postToWeb({v:1, type:'themeUpdate', ...}); }, [webReady, tokens, postToWeb]);  // :165-174
```

**描述**：`sendInit` 依赖 `tokens`，而它的 effect 依赖 `sendInit`——于是**每次主题变化都发一次 `init` + 一次
`themeUpdate`**，两条消息的 theme 内容完全相同。`ChatTranscriptWebView.tsx:820-830` 是同一形状（且更甚，
`init` 覆盖 flags，见 F-1）。

三域都没有 `composer-input` 那样的去重基线（`ComposerInputWebView.tsx:281,302` 的 `lastThemeJsonRef`）。

**影响**：单次冗余几十字节，无正确性后果（web 侧 `applyHostTheme` 幂等）。仅在切主题/切亮暗时发生。
**建议**：`sendInit` 从 useCallback 依赖里摘掉 `tokens`，或直接删掉独立的 `themeUpdate` effect
（`init` 已覆盖）。属清理项，不阻塞。

**置信**：confirmed

---

**F-w8-ds-webbridge-b-10 | P3 | `apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts:35-39` + `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:529-531,1435-1451`**

```ts
// web: 模块 import 期即注册
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { post('visibility', {hidden: document.hidden}); });
}
```

**描述**：`visibility` 是 4 域里唯一的**反向生命周期信号**（web 主动上报，RN 据此强挂重绘）。
设计意图在 `bridge.ts:33-34` 写得很清楚（「规避 Android WebView 恢复显示后仍渲染摘除前的旧帧」），
**标 intentional**。但有两点值得记账：

1. 监听器在**模块 import 期**注册而非 boot 期，从不 `removeEventListener`。单页 WebView 生命周期内无害，
   但它使 `bridge.ts` 有了「import 即产生副作用」，`__tests__` 里直接 import 该模块会往 jsdom 的
   `document` 上挂监听（现有测试靠 `typeof document !== 'undefined'` 短路侥幸没炸）。
2. RN 侧 `statePushSinceResumeRef`（`:530`）在 `postToWeb` 里对 `STATE_PAINTING_HOST_MESSAGES`
   无条件自增——包括**后台期间**的推送。所以「切后台时正在流式」→ 回前台必然触发一次
   WebView 整棵重挂（`:1445-1447`），哪怕只是滚了几行。这是有意的保守取舍，但成本不低。

**建议**：不改行为。若要收敛，把监听注册挪进 `bootTranscript()`（与 `bindShellEvents` 同生命周期），
并给 `STATE_PAINTING_HOST_MESSAGES` 的计数加「仅 document.hidden 时不计」的判断——需先确认
「后台期间推送也算脏」是不是有意为之（倾向于是）。

**置信**：intentional（主）／P3（监听器注册时机）

---

**F-w8-ds-webbridge-b-11 | P3 | `apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts:451-458` + `apps/mobile/src/components/chat/ChatTranscriptBridge.ts:132-135`**

```ts
| BridgeEnvelope<'prependPage', {rows: readonly TranscriptRow[]; prependedCount: number}>
// web 侧 applyPrependPage 全文只用 payload.rows，prependedCount 从不读
```

**描述**：`prependedCount` 是 RN 发了、web 从不读的载荷字段（web 用 `newRows.length`，`snapshot.ts:474`）。
两值当前恒等，所以无正确性后果；但这是**协议里唯一一处「发送方以为对端在用、实际没在用」的字段**，
是未来双侧漂移的种子。

**建议**：要么 web 侧改用 `payload.prependedCount`（显式化语义），要么从联合类型里删掉。

**置信**：confirmed

---

**F-w8-ds-webbridge-b-12 | P3 | `apps/mobile/src/components/vfs/CodeEditorBridge.ts:79`**

```ts
if (typeof record.type !== 'string' || typeof record.payload !== 'object') { throw ... }
```

**描述**：`decodeCodeEditorToHost` 用 `typeof record.payload !== 'object'` 判形，**放行 `payload: null`**；
另三域（`ChatTranscriptBridge.ts:280`、`ComposerInputBridge.ts:106`、`RichDocumentBridge.ts:126`）
统一用 `isRecord`（`value != null && !Array.isArray`），会拒 `null` 与数组。
`null` payload 通过后，`CodeEditorWebView.tsx:133` 的 `message.payload.text` 抛 TypeError，
被 `:153` 的 `catch {}` 吞掉——行为上等价于丢弃，但依赖的是「异常」而非「校验」，
且四域解码口径不一致。

**建议**：code-editor 改用与另三域同形的 `isRecord` 辅助函数。

**置信**：confirmed

---

**F-w8-ds-webbridge-b-13 | P3 | `apps/mobile/src/scripts/build-webview.mjs:2`**

```
 * 用 esbuild 双入口打包 WebView 资源（chat-transcript / rich-document）。
```

**描述**：`PACKAGES` 实际是 **4** 个（`:28-57`，含 code-editor / composer-input），文件头注释写「双入口 /
chat-transcript / rich-document」。文档漂移，会让后来者以为新域打包要改别的地方。

**建议**：改成「四域」，并列出包名。同文件 `:68` 的注释（`@/` → `src/`，webview bundle 可引用 RN 侧共享
纯函数 `src/webview-host`）**是准确且关键的**，别一起删。

**置信**：confirmed

---

**F-w8-ds-webbridge-b-14 | P3 | `apps/mobile/src/components/chat/ComposerInputWebView.tsx:165,221-235`**

```ts
const [currentHeight, setCurrentHeight] = useState(() => metrics.minHeight);
const applyHeight = (height) => { setCurrentHeight(height); ... heightAV.value = withTiming(height, {...}); };
```

**描述**：`currentHeight` 被 `applyHeight` 每次测高都写，但**渲染路径不读它**
（`:433` 只读 `heightAV`；`animatedHeightStyle` 依赖的是 `heightAV` 这个 shared value）。
每次 `heightChange` 都会因此多一次 React 重渲染 + 一次 Animated 无用更新。注释 `:220` 说
「目标值进 state（测试/无障碍可见）」——`rg currentHeight` 全文件仅 `:165,:174,:224` 三处，
**测试也没断言它**。

**建议**：删 `currentHeight` state，`applyHeight` 只驱动 `heightAV`；或把它接到真实的
`accessibilityValue` 上以兑现注释。

**置信**：confirmed

---

**F-w8-ds-webbridge-b-15 | P3 | `apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts:354-365`**

```ts
export function promoteStreamTailToRow(row: TranscriptRow): boolean {
  if (!row || row.kind !== 'message') return false;
  const streamTail = document.getElementById('stream-tail');
  if (!streamTail) return false;
  renderRows();   // 与「无 streamTail」分支同一条路径
  return true;
}
```

**描述**：查了 `#stream-tail` 却不使用它——查到与查不到走的是同一条 `renderRows()`。
函数名承诺的「优先 promote #stream-tail」在实现上是空的。（严格说属 render 层，只因它是
`streamCommit` 桥消息的直接落点而记入。）

**建议**：删掉 `streamTail` 查询，或真正实现 promote 语义。

**置信**：confirmed

---

## 争议与存疑

1. **`@web/shared/host-message-channel.ts:50-51` 双通道注册的重复投递风险——判定为无害，但未证伪。**
   `bindHostMessageChannel` 同时在 `document` 与 `window` 上注册 `message`。
   若某平台两条都触发，同一条 host 消息会被 `handleHostMessage` 处理两次。
   对 `chat-transcript` 的**纯 setState 类**消息（`init`/`streamReset`）幂等无害，
   但对 `sessionSnapshot` 会跑两遍分片拼装。实测 `react-native-webview` Android 走
   `document.dispatchEvent`、iOS 走 `window.dispatchEvent`，**不重叠**，故不报。
   但这是「靠平台行为兜底」，不是「靠代码保证」——建议加一行注释固化该假设。

2. **`docs/apm/RULE.md:50` 指向的手势模块路径已漂移。**
   RULE 写 `apps/mobile/src/web/webview-host/chat-transcript/mermaid-viewer-gestures.ts`，
   实际路径是 `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-viewer-gestures.ts`
   （且 `src/web/webview-host/` 这个目录根本不存在，`webview-host` 在 `src/` 下）。
   属文档债，不在本区代码责任内，**上报给 reduce 层归到文档线**。

3. **`docs/apm/RULE.md:73` 关于 `log` 通道「接 console」的描述与代码矛盾**——见 F-4，
   需裁决是补实现还是改文档。

4. **`composer-input` 的 `heightChange` 到底有没有生产消费方，两个注释互相打架。**
   `ComposerInputBridge.ts:20-22` 与 `web/composer-input/webview/runtime/model.ts:16-19` 都写
   「当前无生产消费方，保留为协议能力」，但 `ComposerInputWebView.tsx:265-271` **确实在消费**
   （`applyHeight` → `heightAV` → 容器高度）。实测两处 `ComposerInputWebView` 消费方
   （`ComposerAtPathInput.tsx:229`、`PromptMacroTextInput.tsx:157`）传的都是**限高** metrics。
   我读到的合理口径是：注释说的是「`maxHeight=null` 的不限高分支无消费方」，
   而 `heightChange` 本身有消费方。**但注释文字没写清，容易被后来人当成整体死协议删掉。**
   标 suspected，**未抹平**。

5. **F-1 的可达性判定依赖「点外部必关菜单」这个假设。** 若存在绕过路径
   （自动续跑、队列触发、语音/快捷指令发起 run），则 open-menu-during-run 会被命中并直达无守卫的
   `handleMessageMenuAction`。我没有穷举 `chat-tab` 的所有 run 发起入口，**这一条留给验证机位下钻**。

6. **是否把 4 域桥协议合并成一份共享类型声明**（现在两侧各写一份，编译器零约束）——
   是架构决策不是 bug，我没有按 finding 报，**留给 L3 架构图裁决**。可行的低成本版本是：
   RN 侧 `XxxBridge.ts` 导出类型，web 侧 `runtime/model.ts` 用 `import type` 引它
   （esbuild 的 `@` 别名已支持跨 `src/` 引类型，且 `transcript-capabilities.ts:9-10` 已有
   「RN 侧与 webview 侧同时 import」的先例）。
