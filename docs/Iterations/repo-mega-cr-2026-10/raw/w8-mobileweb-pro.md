---
zone: w8-mobileweb-pro
agent: 检察官（对抗机位，对抗 w8-mobileweb-def 的辩护报告）
files_scanned: 87（apps/mobile/src/web/** 76 + apps/mobile/src/webview-host/** 11）；另实测构建产物 4 个 webview-dist/*/app.js
---

## 摘要

四个 WebView 包（chat-transcript / rich-document / composer-input / code-editor）的
**WebView 内**侧代码，加上一层薄薄的 `src/webview-host/` 宿主桥。web 侧用 Preact + 原生 DOM
承担渲染与手势，宿主桥只放跨端纯函数（滚动数学、菜单布局、资产 URI）。产物经 esbuild 打成
IIFE 塞进 APK assets，target 锁 es2018。

## 职责与边界

- **web/**：跑在 `file:///android_asset/webview/<pkg>/index.html` 里。无 RN 组件树，
  禁 import RN 组件（`build-webview.mjs` 只允许 `web/shared` + 本包 + 少量 RN 纯函数）。
  每包入口 `webview/main.ts` 是唯一装配点：注册视图门面 → 挂事件 → 发 ready。
- **webview-host/**：跑在 RN 侧，被 `components/**` 消费，同时被 web 侧以 `@/` 别名
  反向 import（见 `src/web/tsconfig.json:20-22` 的 paths 注释）。真源在 webview-host，
  web 与 RN 双端 re-export 消费。
- **三层产物链**：改 src → `build:webview` → `build:webview:native` → gradle → adb install。
  Metro reload 碰不到 webview（RULE.md:73）。

## 对外接口

| 符号 | 位置 | 消费方 |
|---|---|---|
| `post(type,payload,bridgeV)` / `createBoundPost(v)` | `web/shared/post.ts:23,44` | 四包全部 |
| `parseHostMessage` / `matchHostMessage` / `bindHostMessageChannel` | `web/shared/host-message-channel.ts:16,30,44` | 四包 bridge |
| `applyHostTheme(theme,opts)` | `web/shared/host-theme.ts:45` | transcript / rich-document / code-editor |
| `renderMermaidCodeBlocks` / `createMermaidSourceCache` | `web/shared/mermaid-core.ts:95,164` | transcript / rich-document |
| `attachMermaidViewerDelegation` / `mountMermaidViewerPortal` | `shared/mermaid-fullscreen/mermaid-fullscreen.ts:94,120` | transcript / rich-document |
| `attachCodeCopyDelegation(post)` | `web/shared/code-copy.ts:19` | transcript / rich-document |
| `TrustedHtml` / `applyTrustedHtml` | `web/shared/ui/TrustedHtml.tsx:19,32` | 全 ui + runtime |
| `getWebViewPackageIndexUri` / `getWebViewPackageDirUri` | `webview-host/webview-asset-uri.ts:47,60` | 四个 `uri.ts` → 四个 `*WebView.tsx` |
| `layoutAnchoredMenu` / `computeAnchoredMenuWidth` | `webview-host/chat-transcript/anchored-menu-layout.ts:65,139` | web menu.ts + RN MessageActionMenu |
| `scrollTopForOffsetFromBottom` | `webview-host/chat-transcript/scroll.ts:38` | web snapshot.ts:10 |
| `splitStreamBlocks` | `web/chat-transcript/stream/block-split.ts:100` | RN ChatTranscriptWebView.tsx:69 |
| `TRANSCRIPT_CAPABILITIES` / `transcriptCapabilitiesInclude` | `web/chat-transcript/transcript-capabilities.ts:17,25` | web boot + RN |

## 数据访问

本区**不直接访问任何数据源**。所有 IO 都经 postMessage 桥到宿主：
- 文件路径只做字符串归一（`vfs-tool-path.ts:3-31` 纯函数，不 stat 不 readFile）。
- 剪贴板走宿主 `copyCode`（`code-copy.ts:41`），WebView 不碰 `execCommand`/clipboard API
  （iOS WKWebView 不可用，文件头 `:9-10` 自述）。
- 主题读 `getComputedStyle(documentElement).getPropertyValue('--bg')`
  （`mermaid-core.ts:148`），唯一 DOM 读取点。
- 无 KKV、无 SQLite、无网络（IIFE 无分包，mermaid 以依赖形式内联）。

## 依赖关系

**web → 外部**
- `preact`（ui 层）、`mermaid`（懒加载，`mermaid-core.ts:42`）、`@recogito/text-annotator`
  （rich-document 批注）、`@codemirror/*` + `@lezer/highlight`（code-editor）。
- 反向引 RN 侧纯函数 4 处：`snapshot.ts:10`（webview-host scroll）、`menu.ts:6`
  （anchored-menu-layout）、`row-logic.ts:6`（`@novel-master/core/chat`）、
  composer-input `editor.ts:16,20,23`（composer-highlight / atomic-range-delete / prompt-macro-input）。

**被谁消费**
- `src/web/chat-transcript/{stream/block-split.ts, transcript-capabilities.ts}` 是**唯二
  被 RN 直接 import 的 web 文件**（ChatTranscriptWebView.tsx:69,73）——双端共享纯函数。
- `src/webview-host/**` 全部被 `components/**` 消费。
- `src/web/shared/**` 只被 web 内部消费（外加 build 脚本 `loadWebModule` 读两个 CSS 常量）。

---

## 发现清单

### F-w8-mobileweb-pro-01 | P0 | `apps/mobile/webview-dist/composer-input/app.js:164-168`（源：`src/components/agent/prompt-macro-input.ts:1`）

```
164: var BUILTIN_DEFAULT_API_KEY_BY_KEY = Object.fromEntries(BUILTIN_PROVIDER_ROWS.flatMap(...
168: var BUILTIN_UUID_TO_KEY = Object.fromEntries(BUILTIN_PROVIDER_ROWS.map((row) => [row.id, row.key]));
```

composer-input 包为了拿 3 个宏白名单常量（`ALLOWED_DYNAMIC_ROOT_MACROS = ["time","week_cn","filetree"]`），
从 `@novel-master/core/prompt` 桶文件 import，把 core 的 provider 表整块拖进 WebView bundle。
5 处 `Object.fromEntries` 全在 **IIFE 模块顶层**（实测 indent=2，eager，非 `__esm` 惰性块），
且实测位置 `index=4907` **早于** `mountComposerEditor(18778)` 与 `post('ready')(21677)`。

`Object.fromEntries` 是 Chrome 73+（2019-03）。WebView < 73 上 IIFE 顶层直接抛
`TypeError: Object.fromEntries is not a function`，整个脚本死掉——编辑器不挂载、ready 不上报、
宿主永远等不到握手，chat 内联输入框彻底无响应（不是降级，是白屏级）。
`minSdkVersion = 26`（Android 8.0，自带 Chromium 58），WebView 虽可更新但存在大量未更新设备。

同一拖拽把 5 条内置 provider baseUrl + 一个 `defaultApiKey: "public"` 塞进 APK assets，
在 chat 输入框 WebView 里完全无用（webview 全程零网络）。实测 7 个 `BUILTIN_*` 符号
在 bundle 中各只出现 1 次（定义即引用，无消费者）——即 5 个 map 算完就扔。

**建议**：`prompt-macro-input.ts` 的 `ALLOWED_DYNAMIC_ROOT_MACROS` 改从
`@novel-master/core/dist/domain/prompt/logic/validate-dynamic-macros.js` 深层路径直引，
或把三个字符串在本文件内联（宏白名单本身只有 3 项，重复维护成本远低于拖一个桶进来）。
顺带在 `build-webview.mjs` 加门禁：bundle 里出现 `Object.fromEntries` / `replaceAll` /
`.at(` / `Object.hasOwn` 即 fail（见 F-04）。
**置信 confirmed**（产物实测 + 位置实测 + 源码链实测）。

### F-w8-mobileweb-pro-02 | P1 | `apps/mobile/src/web/tsconfig.json:7`

```
"lib": ["ES2018", "DOM"],
```

`lib: ES2018` 是本区唯一的**编译期**兼容闸门（正则 lookbehind 靠人工纪律，见 RULE.md:73）。
实测它**完全失效**：tsconfig 未设 `"types"`，TS 默认拉入 node_modules/@types 全量；
`@types/trusted-types` → `d3-*` → `@iconify/types` → `mermaid/dist/**.d.ts`
→ `type-fest/source/basic.d.ts:1` 的 `/// <reference lib="esnext"/>`，
最终把 `lib.es2019` ~ `lib.es2025` + `lib.esnext` 全部注入 program。

实测 `npx tsc --noEmit -p src/web/tsconfig.json` **零报错**通过，而
`block-split.ts:42` 用的 `line.trimStart()`（ES2019, Chrome 66+）与
`annotate-collect.ts:132-133` 的 `trimStart/trimEnd` 均畅通无阻。
即：写错的东西拿不到任何编译期信号，只能靠人肉 review。

注：`trimStart` 本身危害小于 F-01（Chrome 66 vs 73，且 `annotate-collect` 那两行在
`__nmCollectRecogitoSelection` 回调内、非顶层），但它们是**闸门失效的物证**，
证明纪律靠自觉而非工具。

**建议**：`tsconfig.json` 补 `"types": []`（本区无 jest/node 需求，测试走 `__tests__/`
由 mobile 主 tsconfig 覆盖），并在 CI 加一条「web tsconfig 编译通过」的门禁。
若 mermaid 的 d.ts 无法摘掉，考虑改 `skipLibCheck` + 手写 `webview-shims.d.ts`
显式声明需要的 lib 面。
**置信 confirmed**（`--listFilesOnly` 实测 193 个 node_modules d.ts 入 program，
逐一扫 `reference lib` 只有 preact→dom 与 type-fest→esnext 两处）。

### F-w8-mobileweb-pro-03 | P1 | `apps/mobile/webview-dist/chat-transcript/app.js`（8.6MB）/ `rich-document/app.js`（8.0MB）

```
139614: const afterRePattern = /^after\s+(?<ids>[\d\w- ]+)/;
35079:  ve = d2(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]...
```

两个 WebView 包把 mermaid 整树打进 IIFE（`mermaid-core.ts:42` 注释自述"IIFE 无分包，
动态 import 已内联"）。实测产物里 **正则字面量**含 ES2018 命名捕获组 `(?<name>)`（Chrome 64+）
共 3 处，归属 `marked/lib` × 1、`mermaid/dist` × 2；`chat-transcript` 与 `rich-document`
**各一份**（同源同码）。

命名捕获组是正则**字面量**语法，不像 `?.` 那样被 esbuild 转译（实测 esbuild target es2018
确实把一方的 `?.` 全转成 `_a213 == null ? void 0 :` 形式，产物中仅字符串里残留 `?.`）。
`RefTokenText.tsx:12` 的注释说得很准——"正则字面量在解析阶段直接 SyntaxError"——
而 marked 的 `(?<a>)` 就在同一个 20 万行 bundle 里。`marked` 自己知道危险，
`L35036-35042` 有 lookbehind 特性探测，但**命名组那行是无条件的字面量**。

同一 bundle 还实测到大量 ES2019+ 内建方法（全部在 `__esm` 惰性块内，故非解析期致命，
但运行时命中即炸）：`Array.at(-1)` × 18（`marked/lib` 15 + `@mermaid-js/parser` 3）、
`String.replaceAll` × 17（全 `mermaid/dist`）、`Object.hasOwn` × 12、
`Object.fromEntries` × 6、`.flat()` × 10、`.matchAll` × 4（`zod/v4` 2 + `cytoscape` 1）。
`Array.at` 要 Chrome 92、`Object.hasOwn` 要 93、`replaceAll` 要 85。

叠加 F-01：这套产物对 WebView < 73 是**三重**破坏（顶层 fromEntries 崩 /
命名组 SyntaxError / 运行期 .at/.hasOwn 崩），而 RULE.md:73 只写了"禁 lookbehind"一条。
**建议**：(a) 把 `target: es2018` 从"语法 target"升级为**门禁**——构建后正则扫产物，
命中 `(?<name>` / `(?<=` / `Object.fromEntries` / `.replaceAll(` / `.at(-` / `Object.hasOwn(`
即 fail（脚本已验证可行，见 F-04 建议同款）；(b) 中期评估 mermaid 换轻量渲染器或
把 mermaid 挪到独立 WebView，避免 8MB IIFE 拖累 chat-transcript 首屏。
**置信 confirmed**（产物逐行扫描 + `__esm` 惰性归属判定脚本；`marked`/`mermaid` 归属
按 esbuild `// ../../node_modules/<pkg>/` 注释头归属）。

### F-w8-mobileweb-pro-04 | P2 | `apps/mobile/scripts/build-webview.mjs:107-122`

```
target: ['es2018'],
minify: false,
```

构建脚本对 es2018 纪律**零校验**。实测：跑完 `node scripts/build-webview.mjs` 四包全部
"已生成"，产物里 3 处 `(?<name>` 正则字面量 + 5 处顶层 `Object.fromEntries` 全部静默通过。
`injectCss` 里有 `throw new Error('shell CSS 缺少 ... 占位')` 这样的硬门禁（`:96`），
说明作者知道怎么写门禁，只是没给 JS 兼容面写。

**建议**：加 post-build 扫描（正则命中即 `process.exit(1)`），并把黑名单固化在
`scripts/` 下（照 RULE.md:65「重复使用的调研/验证工具收进 scripts/」的先例）。
**置信 confirmed**。

### F-w8-mobileweb-pro-05 | P2 | `apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts:354-365`

```
354: export function promoteStreamTailToRow(row: TranscriptRow): boolean {
358:   const streamTail = document.getElementById('stream-tail');
359:   if (!streamTail) return false;
362:   // Preact 全量路径：调用方已清 stream 并写入 rows，交由 renderRows 刷新
363:   renderRows();
364:   return true;
```

函数名与注释（"优先 promote #stream-tail"）宣称做 DOM 提升，实际只做两件事：
查 `#stream-tail` 是否存在 + 调 `renderRows()`。它**不 promote 任何东西**——`row` 参数
只用于 kind 检查，`streamTail` 元素只用于判空返回。函数上方还挂着**重复的 JSDoc**
（`:352-353` 与 `:367-370` 逐字相同），后者是 `applyStreamCommit` 的头注释，
复制粘贴残留。

真正需要"提升"语义的场景（流式尾 DOM 变正式行）在 Preact 全量路径下已由
`renderRows()` 天然完成（`state.rows` 已含新行，`#stream-tail` 由 `RowList` 重建），
所以这个函数是 ISD 迁移期的语义化石。调用点 `:421-427`：
```
const promoted = toAppend.length === 1 && toAppend[0].kind === 'message'
  && promoteStreamTailToRow(toAppend[0] as MessageRow);
if (!promoted) renderRows();
```
即"提升成功就不重复 renderRows"——本质是个 `renderRows()` 去重开关，却起了个
描述不存在行为的名字。误导后续维护者以为有 DOM 搬移逻辑。

**建议**：改名为 `renderRowsUnlessStreamTailPresent()` 之类，或直接内联成
`const promoted = toAppend.length === 1 && !!document.getElementById('stream-tail')`，
删掉重复 JSDoc。
**置信 confirmed**（逐行读函数体 + 调用点 + 重复注释比对）。

### F-w8-mobileweb-pro-06 | P2 | `apps/mobile/src/components/chat/ChatTranscriptBridge.ts:189`

```
189: | BridgeEnvelope<'messagePatch', {messageId: string; patch: unknown}>
```

死消息。实测 RN 侧**零发送点**（逐 type 扫 `ChatTranscriptWebView.tsx` 全文件，
`messagePatch` 命中 0；其余 15 个 type 均有发送点），web 侧 `bridge.ts` 的 switch
也**无对应 case**（走 `default: break` 丢弃）。即：类型声明里占位，两端都不实现。

同文件 `:253-256` 的 `log` 更彻底——web 侧无任何 `post('log', ...)`，
RN 侧 `ChatTranscriptWebView.tsx` 无 `message.type === 'log'` 分支。
`composer-input/webview/runtime/model.ts:6` 已经在注释里把这两个点名为
"transcript 的 `log` / `messagePatch` 类死消息"，说明**作者知情**，
但知情后只在下游包留了注释，没回头清上游的协议声明。

**建议**：从 `HostToTranscriptMessage` 摘掉 `messagePatch`，
从 `TranscriptToHostMessage` 摘掉 `log`。RULE.md:73 提到"调试可用 bridge 协议的
`log` 消息通道接 console"——若那是保留意图，则应把它接上（web 侧包一层
`console[level]` → post 的 debug 桥），否则连这条 RULE 也应同步删。
**置信 confirmed**（双向零命中实测）。**争议**：RULE.md:73 提过 `log` 通道，
可能是有意留的调试口——见「争议与存疑」。

### F-w8-mobileweb-pro-07 | P2 | `apps/mobile/src/webview-host/chat-transcript/scroll.ts:11-68`

```
11: export function nearBottom(scrollTop, scrollHeight, clientHeight, threshold = NEAR_BOTTOM_THRESHOLD_PX)
21: export function offsetFromBottom(scrollTop, scrollHeight, clientHeight)
30: export function scrollTopForBottom(scrollHeight, clientHeight)
38: export function scrollTopForOffsetFromBottom(scrollHeight, clientHeight, offsetY)
50: export function scrollTopAfterPrepend(previousScrollTop, previousScrollHeight, nextScrollHeight)
61: export function clampScrollTop(previousScrollTop, scrollHeight, clientHeight)
```

6 个导出，**生产侧只有 1 个被消费**（`scrollTopForOffsetFromBottom`，被
`web/.../render/snapshot.ts:10` import，4 处调用）。其余 5 个（`nearBottom` /
`offsetFromBottom` / `scrollTopForBottom` / `scrollTopAfterPrepend` / `clampScrollTop`）
生产引用数 = 0，仅 `__tests__/chat-transcript-scroll.test.ts` 引用（test=3~4 次/符号）。

更棘手的是**同名不同语义的双实现**：
- `webview-host/.../scroll.ts:21` `offsetFromBottom(scrollTop, scrollHeight, clientHeight)` — 三个数字
- `web/.../runtime/scroll/scroll.ts:10` `offsetFromBottom(el: HTMLElement)` — 一个元素

以及 `clampScrollTop` 同名双实现（宿主版三个数字 `:61`，web 版 `(el, prevScrollTop)` `:24`），
两者生产引用均为 0。这不是"双端共享"，是同名双实现 + 双双死码。

`web/.../runtime/scroll/scroll.ts:54` 还有 `export let scrollTimer: ... = null`——
一个导出的可变模块级绑定，外部无任何读写（test=0），只在同文件 `:72-74` 内部自用。
导出它没有任何意义，且 `let` 导出让"谁能改它"变模糊。

**建议**：删掉 webview-host 侧 5 个零生产引用的导出及其测试（或把测试改成直接测
唯一真源）；`scrollTimer` 去掉 `export`；两处 `clampScrollTop` / `offsetFromBottom`
合并到 webview-host 一份，web 侧包一层取 DOM 属性。
**置信 confirmed**（逐符号 prod/test 计数脚本 + 词边界 grep）。

### F-w8-mobileweb-pro-08 | P2 | `apps/mobile/src/webview-host/chat-transcript/menu-overlay-guards.ts:13,25`

```
13: export function shouldCancelLongPressForMove(deltaX, deltaY, tolerancePx = LONG_PRESS_MOVE_TOLERANCE_PX)
25: export function shouldIgnoreMenuOutsideDismiss(eventType, menuOpenedAtMs, nowMs, targetIsMessageRow)
```

整文件零生产消费。两个导出生产引用数 = 0（仅定义行），test 各 5~6 次。
`shouldIgnoreMenuOutsideDismiss` 的逻辑在 web 侧被**就地重写**了一遍：
`web/.../runtime/menu/menu.ts:194-202` 手写了同样的 grace 判断
（`Date.now() - state.menuOpenedAt < MENU_OPEN_GRACE_MS`），没调这个共享函数。

更根本的是：整个文件服务于"长按开菜单"，而长按路径**已被移除**——
`bind-shell-events.ts:4` 写明"消息菜单由气泡右上角 ⋯ 触发，不再绑定长按开菜单"，
`menu.ts:20` 同样写"长按开菜单主路径已移除"。文件整体是退役功能的化石。
连带 `LONG_PRESS_MOVE_TOLERANCE_PX`（`web/shared/constants.ts:13`）也只被这个死文件消费
（生产引用 3 处全在 menu-overlay-guards.ts 内），实际是死常量。

**建议**：删 `menu-overlay-guards.ts` + 其测试 + `LONG_PRESS_MOVE_TOLERANCE_PX` 常量。
`shouldIgnoreMenuOutsideDismiss` 若要留，应让 `menu.ts:194-202` 改为调它（消除逻辑双写）。
**置信 confirmed**。

### F-w8-mobileweb-pro-09 | P2 | `apps/mobile/src/webview-host/chat-transcript/stream-tail-html-state.ts:5`

```
5: export function nextStreamTailHtmlField(richText: boolean, incomingHtml: string | undefined | null): string | null {
```

整文件零生产消费，生产引用数 = 0，test = 6（`__tests__/stream-tail-html-state.test.ts`）。
一个 16 行的纯函数 + 一个专属测试文件，全是死的。web 侧 `stream.ts` 里
`state.stream.textHtml` 的置位逻辑（`:568-578`、`:653-660`）自己内联做了同样的三元判断。

**建议**：删除文件 + 测试。
**置信 confirmed**。

### F-w8-mobileweb-pro-10 | P2 | `apps/mobile/src/web/shared/mermaid-core.ts:96-98`

```
96:  const svgCache = new Map<string, string>();
97:  const failedCache = new Map<string, unknown>();
98:  const inflight = new Map<string, Promise<string>>();
```

移动端 mermaid 缓存**无上限、无淘汰**。desktop 侧有完整治理：
`MermaidMarkdown.tsx:126` `SVG_CACHE_MAX = 150` + LRU 淘汰（`:148-159`）+
失败占位 TTL（`:134` failedErrorCache + `:181-189` 过期/覆盖/reset 四处连带清理），
`RULE.md:49` 把这套 LRU/TTL 写成了明文决策。移动端三张 Map 只在 `inflight` 上有
`.finally(delete)`（`:130`），`svgCache` / `failedCache` **只 set 从不 delete**。

而 WebView 页面的生命周期 = 整个 chat tab 会话时长（不随会话切换重载，
`applySnapshot` 只换 `state.rows`，页面不重建）。长会话里每张不同源码的图表
（`cacheKey = theme\0source`）永久驻留一份 SVG 字符串 + 失败时驻留一个 Error 对象
（含 mermaid 的 DetailedError，可能持有源码与栈）。桌面端专门为此加过 LRU，
移动端这个洞是同一类问题的未修版本。

**建议**：给 `createMermaidSourceCache()` 加 size 上限（照搬 desktop 的
`SVG_CACHE_MAX = 150` + Map 迭代序 LRU），`failedCache` 加 TTL。
注意 RULE.md:49 只写了 desktop 口径，需在 RULE 补一句「mobile 缓存同样有界」。
**置信 confirmed**。

### F-w8-mobileweb-pro-11 | P2 | `apps/mobile/src/web/rich-document/webview/runtime/annotate-collect.ts:60`

```
57: /** @deprecated 测用 / 工具层残留；MD 新建批注请用 {@link reportRecogitoCreateFromSelection}。 */
60: export function collectAnnotateSelection(mode: AnnotateCollectMode): AnnotateSelectionPayload | null {
```

已标 `@deprecated` + 自述"测用 / 工具层残留"，生产引用数 = 0（仅定义行与文件头注释），
test = 3。作者已经知道它是残留，但没删。

同文件 `getSelectionOffsetsInElement`（`:24`）生产引用 0 / test 2——但它被
`collectAnnotateSelection:75` 与 `reportRecogitoCreateFromSelection:128` 调用，
所以是**内部复用**而非死码（此处 prod 计数只算定义文件外的引用，故显示 0，
实为自引用，非发现项，列此备查）。

**建议**：删 `collectAnnotateSelection` + 其测试分支。
**置信 confirmed**。

### F-w8-mobileweb-pro-12 | P3 | `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen.ts:47`

```
47: export function isMermaidViewerOpen(): boolean {
48:   return _open;
49: }
```

零引用——生产 0（仅定义行），测试 0。`chat-transcript/.../runtime/mermaid.ts:47`
的 `cancelPendingMermaidScanForTests` 同样是零引用零测试（注释写"测试隔离"，
但没有任何测试用它）。`mermaid-core.ts:30` `nextMermaidId` 导出但只在同文件 `:120` 用。

这批"导出了但没人用"的小函数构成一类噪声：`isMermaidViewerOpen` /
`registerMermaidViewerView`（`:43`，只在同文件 `:122` 用）/
`flushStreamRichUpgrade`（`stream-markdown.ts:131`，只在同文件 `:153` 用）/
`destroyEditor`（`code-editor/editor.ts:157`，只在同文件 `:137` 用）/
`scrollCaretIntoView`（同文件 `:61`，内部 3 处用）/
`applyMetrics`（`composer-input/editor.ts:347`，内部 2 处用）。
多为 IIFE 打包早期"模块边界未定"时留下的 export，改完没收回。

**建议**：批量去 export（改成模块内 `function`），或统一加 `// @internal` 标注，
让"导出面 = 公共面"这条隐含约定重新成立。
**置信 confirmed**（词边界逐符号 prod/test 计数）。

### F-w8-mobileweb-pro-13 | P3 | `apps/mobile/src/web/shared/decode-entities.ts:47,54`

```
47: export function decodeForMarkdownInput(text: unknown): string {
54: export function decodeAfterSanitize(text: unknown): string {
```

web 侧零消费（web 目录内只有定义行）。RN 侧有**同形镜像**
`src/components/rich-content/decode-literal-html-entities.ts:43,51`，
且 RN 侧真被用（`prepare-transcript-rich-html.ts:99,102`）。

文件头 `:3` 写着"须与 RN `decode-literal-html-entities.ts` 语义对齐"——对齐的双胞胎
里，web 那一份的两个便利包装是死的。web 侧实际只用 `decodeLiteralHtmlEntities`（`:18`，
被 `html-escape.ts:1` 与 `stream-markdown.ts:1` 消费）。

**建议**：删 web 侧两个未用包装（或反过来：让 RN 侧改从 `@web/shared/decode-entities`
引，消除双份实现——但 RN 侧在 Metro 下、`@web` 别名不可用，故更现实的是删 web 侧包装）。
**置信 confirmed**。

### F-w8-mobileweb-pro-14 | P3 | `apps/mobile/src/web/rich-document/webview/runtime/annotate-recogito-map.ts:48`

```
48: export function recogitoAnnotationToDraftFields(annotation: ...): {...} | null {
```

生产引用 0（仅定义行），test 4。同文件 `draftToRecogitoAnnotation`（`:26`）生产引用 0
但被同文件 `:119` `draftsToRecogitoAnnotations` 调用（自引用，非死码）。
`recogitoAnnotationToDraftFields` 是**反向映射**（Recogito → draft），
生产链路 `annotate.ts:141 onSelectionChanged` 只取 `id` 走 `knownDraftIds`，
不走这个函数——所以它确实只服务测试。

**建议**：标 `@internal` 或降为测试内 helper（移进 `__tests__/`）。
**置信 confirmed**。

### F-w8-mobileweb-pro-15 | P3 | `apps/mobile/src/web/chat-transcript/webview/runtime/state/state.ts:109`

```
109:   ready: boolean;
```

`state.ready` 只在 `boot-transcript.ts:29` 被写 `true`，全仓**零读取**。
`sessionKey` / `hasMore` / `nearBottom` / `loadOlderArmed` / `menuOpenedAt` 都有读者，
只有 `ready` 是纯写字段。boot 顺序本身由 `startTranscriptBoot` 的
`document.readyState` 判断保证（`:35-39`），`ready` 标记没有兜底用途。

同文件 `:104-106` 的三个展开态 map（`thinkingExpanded` / `toolGroupExpanded` /
`attachGroupExpanded`）在**会话切换时不清理**——`snapshot.ts:240-251` 的
`sessionChanged` 分支只重置 `state.stream` 与关闭菜单，不动这三个 map。
它们以 `msg:<id>` / `attach:<id>` 为键，随浏览过的会话单调增长（每条消息一个小 bool，
量级可控但无上界）。`state.rows` 同理只增不减（`:328`/`:414` concat、`:470` prepend），
不过 rows 由窗口化只渲染切片，内存里仍是全量——这可能是刻意的（窗口化省的是渲染不是内存），
但没有任何注释说明，属未言明的取舍。

**建议**：删 `state.ready`；三个展开态 map 在 `sessionChanged` 时清空（或加注释说明
「跨会话保留展开态是有意为之」）。`state.rows` 的全量驻留若为有意，需在 state.ts 注明。
**置信 confirmed**（`ready` 零读取实测）；rows 驻留的**意图**见「争议与存疑」。

### F-w8-mobileweb-pro-16 | P3 | `apps/mobile/src/web/chat-transcript/webview/runtime/render/row-windowing.ts:71`

```
71: export function getRowWindowAvgSlotPx(): number {
```

注释自述"测试 / 调试窥视"。生产 0，test 8。同类还有 `:20` `ROW_WINDOW_ROWS` /
`:22` `ROW_WINDOW_BUFFER_ROWS` 两个常量——生产 0、测试 0（连测试都没引，只在同文件内用）。

严格说这不算"死代码"（模块内自用），但 `export` 让它们看起来是公共契约。
**建议**：去 export 或标 `@internal`。**置信 confirmed**。

### F-w8-mobileweb-pro-17 | P3 | `apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts:352-353` 与 `:367-370`

```
352: /**
353:  * streamCommit: 流式结束单次提交 — 清 stream 状态、追加落库行；优先 promote #stream-tail。
...
367: /**
368:  * streamCommit: 流式结束单次提交 — 清 stream 状态、追加落库行；优先 promote #stream-tail。
```

逐字重复的 JSDoc 块——第一块挂在 `promoteStreamTailToRow` 上（其描述的"优先 promote"
行为见 F-05 并不存在），第二块才是 `applyStreamCommit` 的真实头注释。
ISD 迁移期的复制粘贴残留，会让读者误以为 `promoteStreamTailToRow` 承担了什么。

**建议**：删前一块。**置信 confirmed**。

### F-w8-mobileweb-pro-18 | P3 | `apps/mobile/src/web/chat-transcript/webview/runtime/util/vfs-tool-path.ts:60-65`

```
60: export function vfsToolFilePath(
61:   name: string, input: Record<string, unknown> | null | undefined,
62: ): string | null {
63:   return resolveVfsToolFilePath(name, input);
64: }
```

纯别名转发，零逻辑。`resolveVfsToolFilePath`（`:44`）本身生产被
`ToolGroup.tsx:10` 经这个别名消费——即调用方可以直接引 `resolveVfsToolFilePath`。
同款别名在 RN 侧也存在（`components/chat/message-blocks.ts:298`），而那里
**同名不同签名**（web 版收 `name, input` 两个参，RN 版收一个 `tool` 对象），
跨端对读代码的人是真陷阱。

**建议**：web 侧删别名，`ToolGroup.tsx` 直接引 `resolveVfsToolFilePath`。
**置信 confirmed**。

### F-w8-mobileweb-pro-19 | P3 | `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts:19-23, 41-44`

模块级可变单例两块：`streamBlockRender`（`:19`，含 `active` 布尔 + 两个 parts 数组）与
`streamDisplayParts`（`:41`）。两者由 `resetStreamBlockRenderState`（`:65`）统一复位，
调用点在 `bridge.ts:81,93`（`streamReset` / `streamCommit`）。复位链路完整。

但 `streamBlockRender.tailTextParts` 的**增长无上界**：`:613` 每个 delta 都
`streamBlockRender.tailTextParts[kind].push(delta)`，而 `materializeStreamDisplay`（`:46`）
只清 `streamDisplayParts`，不清 `tailTextParts`——后者只在块提交（`:546`）或
整体复位（`:67-68`）时重置。单轮流式期间 `tailTextParts.text` 累积整段流文本，
每 350ms 的轻量升级（`getStreamActiveTailText`，`:74-81`）都 `join('')` 全量一次。
长回复（几万 token）下这是 O(n) 字符串 + O(n) join 每 350ms。

不是泄漏（轮次结束会清），是流式期的 CPU/内存放大。`state.stream.text` 本来也在
累积同样长度（`:54`），所以是双份驻留。

**建议**：`tailTextParts` 改用单个 string 累加（`+=`）而非 parts 数组，
或在 `materializeStreamDisplay` 里同步清 parts（若语义允许）。
**置信 suspected**（未在真机长回复下实测耗时；逻辑上界清楚但实际影响取决于回复长度分布）。

### F-w8-mobileweb-pro-20 | P3 | `apps/mobile/src/web/chat-transcript/webview/runtime/boot/bind-shell-events.ts:12-22`

```
11: /** 绑定滚动与行区 click；可重复调用时依赖浏览器同函数引用去重行为，boot 只调一次。 */
16:    scroller.addEventListener('scroll', onScroll, {passive: true});
19:    rows.addEventListener('click', onRowsClick);
21:    attachCodeCopyDelegation(post);
```

注释自承"依赖浏览器同函数引用去重"——即**没有显式幂等守卫**，
正确性寄托在 `onScroll` / `onRowsClick` 是模块级单例函数引用。
`attachCodeCopyDelegation` 反倒有真守卫（`code-copy.ts:18-23` 的 `attached` 布尔）。
`mermaid-fullscreen.ts:97-100` 的 `_delegationAttached` 也有。三种写法三种口径。

实测 `bindShellEvents` 生产调用点唯一（`boot-transcript.ts:21`），`bootTranscript`
由 `startTranscriptBoot` 调一次——所以当下**不会重复挂**。但 WebView 里
`visibilitychange` 触发宿主重挂 WebView（RULE.md / `bridge.ts:33-39` 的注释描述了
"隐藏期间有改画推送时强制重挂 WebView"）时若走的是软重挂而非重载，
这里就是唯一漏守卫的地方。

**建议**：照 `attachCodeCopyDelegation` 加 `let bound = false` 守卫，三处口径统一。
**置信 suspected**（未确认重挂是重载页面还是保留 JS 上下文）。

---

## 争议与存疑

1. **`log` 消息是否该保留（F-06）**——`RULE.md:73` 明写"调试可用 bridge 协议的 `log`
   消息通道接 console"，这**可能**是有意保留的调试口（只是当前 web 侧没接 console）。
   若如此，正确的处置是"把 web 侧 console 桥接实现出来"而不是删类型。
   我倾向保留类型 + 实现桥接，但这条我拿不准 RULE 那句是描述现状还是描述计划，
   交主代理裁决。同文件 `messagePatch` 则无此争议——RULE 只提 `log`，`messagePatch`
   在 `composer-input/model.ts:6` 被明确点名为"死消息"。

2. **`state.rows` 全量驻留是否为有意（F-15）**——窗口化（`row-windowing.ts`）
   省的是**渲染**不是**内存**，rows 全量驻内存是窗口化方案的前提（`getRowWindowRange`
   按总行数算占位）。所以我倾向"有意"，但代码里没有任何注释说明这一点，
   下一个读者可能误判为泄漏。不作为发现上报，仅记此存疑。

3. **`markStreamPlainTarget` / `setStreamTailPlainClass` 的复杂度（F-19 邻域）**——
   stream.ts 里有大量围绕 `.rich` / `.stream-tail-plain` 类名切换的分支
   （B-1 注释解释"目标即尾块容器时不动 body 的 .rich"）。这套逻辑正确但极难验证，
   我没有能力在本次 CR 里证明它无 bug，只能说**它没有可读的测试覆盖**
   （stream.ts 生产 0 / 我未在 `__tests__` 找到针对 block-commit + plain-class
   组合的行为级测试）。列为存疑而非发现。

4. **F-01 的实际影响面**——`minSdkVersion = 26`（Android 8.0）下 WebView 可独立更新，
   绝大多数活跃设备 WebView 版本远高于 73。所以 F-01 的**现实触发率**可能很低。
   我仍定 P0，理由是：它是**无声的整包失败**（无降级、无日志、宿主侧只表现为
   "ready 一直不来"，排查成本极高），且 RULE.md:73 已经把 webview 的老环境兼容
   写成明文纪律——纪律存在但门禁缺失，这类问题的代价不对称。

5. **本区与 `w3-xc-proto` / `w2-mobile-web` 的重叠**——我在检索 RULE 与
   `docs/Iterations` 时命中了 `raw/w2-mobile-web.md`、`raw/w3-xc-proto.md`、
   `synth/core-misc.md` 的行（F-02 在 `synth/core-misc.md:712` 已被记为 M-26）。
   按对抗纪律我未读这些报告正文，上述发现均为我从代码与产物独立重推；
   但**结论重合本身是独立双扫的一致性信号**，主代理可据此给 F-02 更高置信权重。
