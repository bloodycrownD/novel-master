---
zone: mobile-web
agent: domain-survey
files_scanned: 92
---

# W2 · mobile-web（apps/mobile/src/web/ + apps/mobile/src/webview-host/）

基线：`feat/repo-mega-cr` @ `9ca5f5ad`。本区 git 跟踪文件 92 个（其中 2 个 0 字节 `.gitkeep`），
实测 9071 行，**全部通读完毕**，无抽样。

## 摘要

四个打进 APK 的 WebView 页面（chat-transcript / rich-document / code-editor / composer-input）的
WebView 内 JS 源码，加上一份 web↔RN 共用的纯函数真源区 `src/webview-host/`。改这里的代码
**不经过 Metro**，必须走「改 src → build:webview → build:webview:native → gradle → adb install」
三层产物链（RULE:73）。整体质量高：信任边界（TrustedHtml）、窗口化、块级流式、mermaid 双管线
都有成体系的注释与纯函数抽离。

## 职责与边界

| 目录 | 职责 | 边界纪律 |
| --- | --- | --- |
| `web/shared/**` | 四域共用的 post/主题/宿主消息通道/富文本 CSS 单源/mermaid-core/mermaid 全屏查看器 | 无业务依赖，禁 DOM 专用假定之外的 RN 引用 |
| `web/<pkg>/webview/runtime/**` | 命令式内核：bridge 接线、渲染门面、状态 | 禁 import `ui/**`、禁裸 `preact.render`；视图一律经 `register*` 门面由 `main.ts` 装配 |
| `web/<pkg>/webview/ui/**` | Preact 视图层 | CT 仅 `{StreamTail, RowList, MessageRow}` 三个文件可值导入 `state`（README.md:192-201 E2 白名单） |
| `web/<pkg>/{index.html,styles/}` | 壳 HTML + 壳 CSS（`__RICH_CSS__` / `__MERMAID_FULLSCREEN_CSS__` 注入位） | 壳 CSS 不内嵌第二份富文本规则 |
| `webview-host/**` | web 与 RN 共享的纯函数（uri / 滚动 / 菜单布局 / 手势守卫） | 同步、无 DOM、无 RN import（`webview-asset-uri.ts` 除外，它就是 RN 侧入口） |

装配点唯一：`web/<pkg>/webview/main.ts`（README.md:188「唯一装配点是 main.ts」已与代码一致）。

## 对外接口

- `web/chat-transcript/webview/runtime/state/state.ts:5-6` — `SCHEMA_V = 2`（scrollSnapshot 用）、`BRIDGE_V = 1`；另 `VFS_FILE_TOOLS`、`state`（模块级单例 `TranscriptState`）
- `web/chat-transcript/transcript-capabilities.ts:14-19` — `TRANSCRIPT_CAPABILITY_STREAM_BLOCK_COMMIT` / `TRANSCRIPT_CAPABILITIES`，web 与 RN **同时** import 的能力协商标识
- `web/chat-transcript/webview/runtime/render/row-logic.ts:14` — `registerRenderRows`（门面）
- `web/chat-transcript/webview/runtime/menu/menu.ts:37` — `registerRenderContextMenu`；`:235` `openContextMenuFromAnchor`
- `web/chat-transcript/webview/runtime/bridge.ts:31` — `post`（`createBoundPost(1)`）、`:41` `handleHostMessage`
- `web/rich-document/webview/runtime/bridge.ts:27` — `registerSetDocumentView`；`document-model.ts:35` `buildDocumentBody`（纯函数，合约测直测）
- `web/rich-document/webview/runtime/annotate-collect.ts:116` — `reportRecogitoCreateFromSelection`，经 `:154` 挂到 `window.__nmCollectRecogitoSelection` 供 RN `injectJavaScript`
- `web/shared/mermaid-core.ts:95` — `createMermaidSourceCache`（成功/失败/inflight 三态去重）；`:164` `renderMermaidCodeBlocks`
- `web/shared/mermaid-fullscreen/mermaid-fullscreen.ts:43,94,120` — `registerMermaidViewerView` / `attachMermaidViewerDelegation` / `mountMermaidViewerPortal`
- `web/shared/mermaid-fullscreen/mermaid-viewer-gestures.ts` — 纯手势函数（clamp/pinch/双击/烘焙换算），Jest 直测
- `web/shared/rich-content-styles.ts:192,199` — `CHAT_TRANSCRIPT_RICH_CSS` / `RICH_DOCUMENT_RICH_CSS`，**被 `build-webview.mjs:207` 当 data: import 加载**，是富文本样式的唯一真源
- `web/composer-input/webview/runtime/model.ts:64-95` — `HostToComposerInputMessage` / `ComposerInputToHostMessage` 全量消息清单（明文声明「死消息不留」）
- `web/code-editor/webview/runtime/composer-tokens.ts:29` — `COMPOSER_TOKEN_PATH = 'composer.md'`（RN 侧 `PromptEditorScreen` 同值镜像）
- `webview-host/webview-asset-uri.ts:47,60` — `getWebViewPackageIndexUri` / `getWebViewPackageDirUri`，四包共用

## 数据访问

本区**不直接触碰任何表 / KKV 域 / 文件路径**，全部经 postMessage 桥由 RN 侧落到 core。实测证据：

- 唯一的本地文件路径常量在 `webview-host/webview-asset-uri.ts:49`（`file:///android_asset/webview/<pkg>/index.html`）与 `:52`（iOS `MainBundleDir/WebViewDist/...`），且注释明写「不做磁盘 exists 探测」（`:3`、`:45`）
- 唯一的业务数据入口是 `bridge.ts` 的 `handleHostMessage`（CT:41 / RD:52 / composer:27 / code-editor:13），全部经 `shared/host-message-channel.ts:30` `matchHostMessage` 做 `v` + `type` 校验，坏消息静默丢弃
- 业务数据出口统一 `shared/post.ts:23` `post` → `createBoundPost(BRIDGE_V)`，四包 `BRIDGE_V` 实测全为 1
- KKV / SQLite 表：本区零引用（`git grep` 在 `web/`+`webview-host/` 下无 `select|insert|update|session_kkv` 等命中）

## 依赖关系

**向外 import（web → 区外）**：

| 依赖 | 落点 | 备注 |
| --- | --- | --- |
| `@novel-master/core/chat` | `chat-transcript/.../row-logic.ts:6` | `formatStatusChipLabelFromAttachment`；见 F-5 |
| `@novel-master/core/prompt`（间接） | `composer-input/.../editor.ts:23` → `@/components/agent/prompt-macro-input.ts:1` | `ALLOWED_DYNAMIC_ROOT_MACROS` |
| `@/`（RN src） | `composer-input/.../editor.ts:18,22`、`code-editor/.../composer-tokens.ts:23` | `composer-highlight` / `atomic-range-delete` / `prompt-macro-input`，被 esbuild alias `@`→`src` 打进 webview |
| `../../../../../webview-host/chat-transcript/scroll` | `chat-transcript/.../snapshot.ts:10` | 区内的真源复用 |
| `../../../../../webview-host/chat-transcript/anchored-menu-layout` | `chat-transcript/.../menu/menu.ts:4-6` | 同上 |
| `mermaid` / `@recogito/text-annotator` / `@codemirror/*` / `preact` | 各自 runtime | 全部 `packages:'bundle'` 打进 IIFE（`build-webview.mjs:120`） |

**被谁消费（本区是数据源）**：
`components/chat/ChatTranscriptWebView.tsx`、`components/chat/ComposerInputWebView.tsx`、
`components/chat/ComposerInputBridge.ts`、`components/vfs/CodeEditorWebView.tsx`、
`components/vfs/RichDocumentWebView.tsx`、`services/session-stream-webview-adapter.ts`，
以及 `transcript-capabilities.ts` / `web/shared/constants.ts`（RN 侧 re-export 数值单源）。

**产物链**（`apps/mobile/scripts/build-webview.mjs`）：四包各出 `webview-dist/<pkg>/{index.html,app.js,app.css}`；
`--copy-native` 拷到 `android/app/src/main/assets/webview/` 与 `ios/NovelMaster/WebViewDist/`（`:136-153`）。
`app.css` 由 `injectCss`（`:88`）把 `CHAT_TRANSCRIPT_RICH_CSS` / `RICH_DOCUMENT_RICH_CSS` /
`MERMAID_FULLSCREEN_CSS` 注入壳 CSS 的占位；rich-document 额外内联 Recogito 官方 CSS（`:186-194`，file:// 不能走 CDN）。
`target: ['es2018']`（`:113`）——RULE:73「禁 lookbehind」的落点。

## 发现清单

### F-mobile-web-1 | P2 | apps/mobile/src/web/tsconfig.json:8

```json
"lib": ["ES2018", "DOM"],
```

`compilerOptions` 没有设 `types`，TypeScript 会自动纳入 `node_modules/@types/*` 全集，而
`node_modules/@types/node/index.d.ts:28` 写着 `/// <reference lib="es2020" />` —— ES2020 的 lib
被无条件拉进来，`lib: ["ES2018"]` 的限制**完全失效**。实测：`npx tsc --noEmit -p apps/mobile/src/web/tsconfig.json`
对 `rich-document/webview/runtime/annotate-collect.ts:132-133` 的 `trimStart()` / `trimEnd()`（ES2019 API）
零报错。

后果：RULE:73 立的「webview 内 JS 按老浏览器环境写」纪律**没有任何类型层兜底**，全靠人肉 review。
`RefTokenText.tsx:12` 特意为 lookbehind 写了「勿用 lookbehind」并手工实现 `hasWordBoundaryBefore`
（`:16-19`），说明这条纪律是真的在守——但它目前是纯约定。

建议：在 `web/tsconfig.json` 加 `"types": []`（本区不依赖 Node 全局），让 lib 限制真正生效；
加完后 `annotate-collect.ts:132-133` 会立即报红，就地换成 `replace(/^\s+/, '')` / `replace(/\s+$/, '')`。
置信：**confirmed**（tsc 实测 + @types/node 源码行已核对）

### F-mobile-web-2 | P2 | apps/mobile/src/web/chat-transcript/stream/block-split.ts:42

```
 * - es2018 兼容：禁 lookbehind 等新正则特性（esbuild target es2018
 *   不转译正则）；本文件只用普通正则与字符扫描。      ← 18-19 行自述
...
  const matched = FENCE_OPEN_RE.exec(line.trimStart());   ← 42 行，ES2019
```

同一文件在文件头声明「es2018 兼容」，函数体却用了 ES2019 的 `String.prototype.trimStart`。
esbuild 不做 API polyfill，所以在 Chrome < 66 的内核上这行会直接抛 `TypeError`（而 lookbehind 是
**解析期** SyntaxError、整包挂掉，性质不同——本文件防的是后者，漏了前者）。

建议：改 `line.replace(/^\s+/, '')`。本文件是 RN 侧 `ChatTranscriptWebView` 也 import 的双端共用纯函数，
RN（Hermes）侧同样受益。置信：**confirmed**

### F-mobile-web-3 | P2 | apps/mobile/src/webview-host/chat-transcript/{scroll.ts, menu-overlay-guards.ts, stream-tail-html-state.ts}

这三个文件的头注释都自称「真源」/「数值常量真源：web/shared/constants.ts」，但**生产代码零消费**——
webview 侧各自长出了自己的实现：

| 声称的共享真源 | webview 实际用的 | 状态 |
| --- | --- | --- |
| `menu-overlay-guards.ts:25` `shouldIgnoreMenuOutsideDismiss` | `runtime/menu/menu.ts:194-201` 逐字重写了同一段判断 | 分叉，测试只测前者 |
| `scroll.ts:21/61` `offsetFromBottom` / `clampScrollTop` | `runtime/scroll/scroll.ts:10-27` 同名、签名改成吃 DOM 元素 | 分叉，测试只测前者 |
| `stream-tail-html-state.ts:5` `nextStreamTailHtmlField` | `runtime/stream/stream.ts:566-579` 内联重写 | 分叉，测试只测前者 |
| `menu-overlay-guards.ts:13` `shouldCancelLongPressForMove` | 无（长按开菜单主路径已按 `menu.ts:20` 移除） | 纯死代码 |
| `scroll.ts:30/50` `scrollTopForBottom` / `scrollTopAfterPrepend` | 无 | 纯死代码 |
| `scroll.ts:38` `scrollTopForOffsetFromBottom` | `render/snapshot.ts:10,261,272,340,435` | **唯一真被用的** |

实测（`git grep` 全 apps+packages，排除 `__tests__`）：`shouldCancelLongPressForMove` 与
`shouldIgnoreMenuOutsideDismiss` 的非测试命中只有定义文件自身。

后果：三个模块合计约 150 行「共享真源」+ 三份单测，测的都是**没人在跑的那份**。一旦有人按
「真源」的口径去改共享文件以为两端同步了，实际零效果；反过来 webview 内联那份改了，测试照样全绿。
这是本区最值得处理的一条。

建议：二选一并写进注释——① 删掉三个死函数、让 webview 侧 import 真源（`menu.ts` 的
grace 判断、`scroll.ts` 的 DOM 版改成调用共享纯数）；② 若刻意保留 DOM 版作「webview 侧适配」，
把文件头「真源」措辞改成「RN 侧历史实现，webview 已改用 DOM 版」，并给死函数标 `@deprecated`。
置信：**confirmed**

### F-mobile-web-4 | P2 | apps/mobile/src/web/chat-transcript/styles/transcript.css:311, 402, 475-482

```
.tool-phase-bar { margin-top: 6px; ... }                     ← 311-316
.row.user.vfs-turn-row .bubble.bubble--fill-width { ... }     ← 402-406
.row.user.vfs-turn-row .vfs-turn-bubble { ... }               ← 475-482
```

全仓 `git grep` 实测：`.tool-phase-bar` 在**生产代码里零产出方**，只有 `apps/mobile/e2e/pageobjects/chat-transcript.page.ts:180,214`
与 `apps/mobile/e2e/specs/chat.tool-phase-and-order.e2e.ts:45,52` 在轮询它；`.vfs-turn-row` /
`.vfs-turn-bubble` 连 e2e 都没有，纯 CSS 孤儿。`vfs-turn-row` 对应的是 user ops 操作日志行，
RULE:12 记载「chat-fixes-2026-08 已整体拆除（store/flush 链路、偏好键、设置开关、清推全删）」。
本区 Preact 侧 `MessageRow.tsx:119` 只产出 `row message <role>`，`TranscriptRow = MessageRow`（`state.ts:57`），
结构上不可能再冒出 `.row.tool` / `.vfs-turn-row`。

顺带：`transcript.css:38` 的 `.row.tool` 同样零产出方。

e2e 那条虽然有 `if (hasPhaseBar)` 软守卫不会红，但 `expectToolPhaseBarVisible(true)` 分支永远进不去，
等于一段永不执行的断言（与 RULE:82「恒真的断言是废断言」同类气味）。

建议：删 transcript.css:311-316、402-406、475-482 与 `.row.tool`；e2e spec 的 phase-bar 段整体移除。
置信：**confirmed**（git grep 全仓实测）

### F-mobile-web-5 | P3 | apps/mobile/src/web/chat-transcript/webview/runtime/render/row-logic.ts:6

```ts
import {formatStatusChipLabelFromAttachment} from '@novel-master/core/chat';
```

与同包 `rows-click.ts:87-88` 的注释直接矛盾：

> 识别与路由在宿主侧单源完成（**webview bundle 不依赖 core**，且 iOS 导航守卫与 DOM 事件时序不可靠）

webview bundle 确实依赖 core，且不止一处。`build-webview.mjs:120` 是 `packages: 'bundle'`，
core 的 barrel 会被打进 IIFE。更要紧的是 `packages/core/package.json` 的 exports 全部指向
`./dist/**`（`"./chat": {"import": "./dist/public/chat.js"}`），所以 **webview 资产消费的是 core 的
编译产物而非 src**——RULE:68「改 dist 消费的包必须重建 dist」在这里成立，但 RULE:73 又说
「metro reload 碰不到它」，两者叠加意味着：改了 core 的 `formatStatusChipLabelFromAttachment`
又忘了 `npm run build -w @novel-master/core`，附件 chip 标签会以旧文案静默烧进 APK，没有任何报错。

实测佐证：本 worktree `packages/core/dist` **不存在**，`npx tsc --noEmit -p apps/mobile/src/web/tsconfig.json`
因此报 `row-logic.ts(6,51): error TS2307: Cannot find module '@novel-master/core/chat'`（同批还有
`prompt-macro-input.ts(1,43)` 同样报错）。CI 侧顺序是对的（`release.yml:91` 先 build core、
`:99` 再 `build:webview:native`），所以这是**本地开发链路**的问题，不是发版问题。

建议：① 修 `rows-click.ts:87-88` 的注释，改成「webview 只在附件 chip 标签一处引 core（纯函数）」；
② 在 `apps/mobile/package.json` 的 `build:webview` 前挂 `prebuild:webview` 先 build core（与
`prestart`/`preandroid` 现有钩子并列），把「忘重建」从静默变响亮。置信：**confirmed**（tsc + dist 缺失 + package.json 三处实测）

### F-mobile-web-6 | P3 | apps/mobile/src/web/code-editor/webview/runtime/language-for-path.ts:5-14

```ts
export function languageExtensionForPath(path: string): Extension[] {
  const lower = path.toLowerCase();
  if (/\.(md|markdown)$/.test(lower)) return [markdown()];
  if (/\.json$/.test(lower)) return [json()];
  return [];                                    // ← 其余全部无高亮
}
```

VFS 里的 `.ts` / `.py` / `.yaml` / `.txt` 用内置 code-editor 打开时**完全没有语法高亮**。
`apps/mobile/package.json:84-85` 只装了 `@codemirror/lang-json` 与 `@codemirror/lang-markdown`
（无 lang-javascript/python），所以这是依赖层面的取舍、不是漏配。对一个小说写作工具
（正文 md + 配置 json）大概率是刻意的，但**代码里没有任何注释声明这是范围决定**，下一个改这里的人
会以为 `.ts` 高亮是漏了。

建议：在函数头补一行「仅 md/markdown/json 有语言包，其余走无高亮兜底；扩语言需先加
`@codemirror/lang-*` 依赖」。置信：**suspected**（依赖侧确认为事实，取舍动机无出处，按 RULE「拿不准的明说」处理）

### F-mobile-web-7 | P3 | apps/mobile/src/web/code-editor/styles/editor.css:33-58

`.cm-gutters` / `.cm-gutter.cm-lineNumbers .cm-gutterElement` / `.cm-activeLineGutter` /
`.cm-activeLine` / `.cm-cursor, .cm-dropCursor` / `cm-focused .cm-selectionBackground`
这一整组规则，在 `runtime/theme.ts:31-53` 的 `EditorView.theme({...}, {dark: false})` 里
**又完整写了一遍**，值逐条相同。两处都没有「另一处是同源镜像」的单源注释。

今天两处值一致所以无视觉差异，但这是典型的双源漂移点：改 `theme.ts` 忘了改 css（或反过来），
`EditorView.theme` 注入的 style-mod 与静态 css 的层叠结果取决于 CM 的注入顺序，排查成本高。

建议：给 `theme.ts:7` 的 `editorTheme` 加注释「与 styles/editor.css 的 `.cm-*` 段同源，改一处必须改另一处」；
或干脆让 theme.ts 只保留 CM 必需项、视觉项全交给 css。置信：**confirmed**（两处逐条比对）

### F-mobile-web-8 | P3 | apps/mobile/src/web/chat-transcript/webview/ui/stream/StreamTail.tsx:11

```
 * E2 allowlist：本文件（含 StreamBodyHost）可值导入 `state`；
 * 新 ui 组件禁直读——见 apps/mobile/README.md「E2：ui 禁值导入 state」、
 * scripts/check-ct-ui-no-state.mjs。
```

`apps/mobile/scripts/` 实测只有 `build-webview.mjs` / `generate-app-icons.mjs` / `run-gradlew.mjs`
——**`check-ct-ui-no-state.mjs` 不存在**。`README.md:201` 早已把话改成「纪律保留为代码约定
（原 `check:ct-ui-no-state` 脚本已删，需要时从 git 历史找回）；新直读靠 CR 把关」。
同目录的 `MessageRow.tsx:5` / `RowList.tsx:10` 用的就是修正后的措辞（「原门禁脚本已删，纪律见 README」）。

即：StreamTail 是三个白名单文件里唯一一个还引用已删脚本的。事实层面无影响（README 已兜住），
但三份并排的注释互相矛盾，读的人得自己去核脚本在不在。

建议：把 StreamTail.tsx:11 的 `scripts/check-ct-ui-no-state.mjs` 一行删掉，与另两份对齐。
置信：**confirmed**（目录 listing + README 行号实测）

### F-mobile-web-9 | P3 | apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts:240-248

`applySnapshot` 在会话切换 / 非 preserve 时整体重置了 `state.stream`：

```ts
if (intent !== 'preserve' || sessionChanged) {
  state.stream = { text: '', thinking: '', textHtml: '', thinkingHtml: '', toolInvoking: false };
}
```

但**没有**调 `resetStreamBlockRenderState()`。`streamBlockRender.active` 与
`streamBlockRender.tailTextParts`（`stream/stream.ts:19-23`）是 `stream.ts` 的模块级单例，
只有 `streamReset` / `streamCommit` 两条桥消息会复位（`bridge.ts:81,94`）。而 RN 侧只在
「上一轮流确实处于 active」时才发 `streamReset`（`ChatTranscriptWebView.tsx:1255-1259`：
`if (webReady && wasActive)`）。

我顺着把可达路径都走了一遍，**结论是当前没有可复现的缺陷**，理由三条：
① 每一轮流正常结束都必过 `streamCommit` → `resetStreamBlockRenderState()`；
② 首激活那次 `streamBlockCommit` 必带尾块载荷（RN 侧 `postStreamBlockSplits` 只在
`i === lastCommitIndex` 挂 `tailHtml/tailText`，`ChatTranscriptWebView.tsx:646-656`），
于是 `stream.ts:546` 把 `tailTextParts[kind]` 整体覆盖，激活前的累积被洗掉；
③ 同一次 split 内的多个 commit 是同步连发的，中间不可能有 350ms 升级定时器插进来。

所以这条报的是**隐性耦合**而不是活 bug：块级渲染态的复位责任全压在「RN 必须发 streamCommit」这个
跨仓约定上，`applySnapshot` 自己的会话切换路径留了个不设防的口子。哪天 RN 侧为了省一帧、
把某个路径的 `streamCommit` 换成只清 `state.stream`，web 侧会静默带上一轮的块级态。

建议：在 `applySnapshot` 的重置分支里补一次 `resetStreamBlockRenderState()`（幂等、零成本），
把责任收回 web 侧。置信：**suspected**（当前不可复现，属防御性加固）

### F-mobile-web-10 | P3 | apps/mobile/src/web/composer-input/webview/runtime/editor.ts:277-296

```ts
const reported = resolveReportedHeight(state.highlight.scrollHeight, this.metrics);
```

高度链路（RULE 未单列条目，实测口径在 `ComposerInputWebView.tsx:9,164,265` 与
`ComposerInputBridge.ts:20,81` 三处对齐）本身是自洽的：web 侧量高 → clamp 到
`[minHeight, maxHeight]` → `post('heightChange')` → RN 容器跟随，方向单一、无回环（`applyText` 里
RN 收 change 不回写，v1.5.9 的 IME 防线）。

唯一的小口子：`state.highlight` 的 CSS 是 `overflow: auto`（`composer-input.css:53-65`），
量的是 `scrollHeight`。若出现一条 `word-break: break-word` 也断不开的超长不可断 token
（连续无空格的长 URL / base64），高亮层会出横向滚动条，滚动条高度被计入 `scrollHeight`，
进而虚高上报 → RN 容器变高 → 高亮层变高……理论上构成一个正反馈。目前 `word-break: break-word`
基本堵住了这条路，所以只是理论口子。

建议：量高改用 `state.highlight.clientHeight`（已被 `min/max-height` clamp 过的可视高），
或在 CSS 上给高亮层加 `overflow-x: hidden`。置信：**suspected**

### F-mobile-web-11 | P3 | apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-viewer-gestures.ts:129-134

```ts
export function rebasePanAfterBake(pan: MermaidViewerPan, _scale: number): MermaidViewerPan {
  return {x: pan.x + 0, y: pan.y + 0};
}
```

函数体是恒等映射，`_scale` 参数带下划线前缀（明示不用），注释也自陈「几何上这是恒等映射……
独立成函数是给坐标系锁定断言留挂点」。**这是刻意的测试挂点，不是死代码**——按 RULE「看起来冗余
但写明是故意设计的，标 intentional」处理，列出以免被后续 CR 当冗余删掉。
置信：**intentional**

### F-mobile-web-12 | P3 | apps/mobile/src/web/rich-document/styles/document.css:84-124

`.nm-annotate-anchor` / `.annotate-mark` / `::highlight(nm-annotate)` 三组批注样式，
文件头 80-83 行已明写「非主路径遗留样式……保留仅为 sanitize 允许的存量 class / 旧 HTML 不崩样式；
**禁止新代码依赖**」。主路径已改 Recogito（`runtime/annotate.ts:8-12`）。

另注意 `::highlight(nm-annotate)` 是 CSS Custom Highlight API，Android WebView 92+ 才支持，
在老内核上整条被忽略（降级为无下划线，不崩）——与 RULE「按老浏览器环境写」的宽容降级口径一致。
置信：**intentional**

### F-mobile-web-13 | P3 | apps/mobile/src/web/chat-transcript/webview/ui/render/ToolGroup.tsx:39

```ts
console.warn('[ToolGroup] write/edit/read 卡片无法解析路径', 'tool=', tool.name, ...);
```

本区**唯一**的 `console.log/warn/debugger`（全 `web/`+`webview-host/` grep 实测）。
无 `__DEV__` 门、无频次限制，且它在 **Preact render 期**执行——`CollapsibleSection` 展开时
每行卡片每次 render 都会跑一遍。异常路径（工具 input 字段名与 `vfs-tool-path.ts:51` 期望的
`path`/`file_path` 不符）下会刷屏。注释解释了「file:// 环境无 process.env，所以不加 dev 守卫」，
但守卫完全可以做成模块级计数器（如每类工具只 warn 一次）而不依赖 env。

置信：**intentional**（现状是刻意的诊断手段）——但建议加一次性计数，别按 render 次数刷。

### F-mobile-web-14 | P3 | apps/mobile/src/web/shared/decode-entities.ts:47,54

`decodeForMarkdownInput` / `decodeAfterSanitize` 两个导出在 web 侧**零生产消费**（全仓 grep：
只有 `__tests__/decode-entities-parity.test.ts` 与 `__tests__/decode-literal-html-entities.test.ts`）。
web 侧真正用到的只有 `decodeLiteralHtmlEntities`（`stream-markdown.ts:40`、`html-escape.ts:6`）。
RN 侧的孪生文件 `components/rich-content/decode-literal-html-entities.ts` 则确有生产消费方
（`prepare-transcript-rich-html.ts:99,102`）。

即：web 这份文件存在的理由只是「让 parity 测试能断言两侧语义一致」，而这个理由被文件头
「须与 RN `decode-literal-html-entities.ts` 语义对齐」写明了。按 intentional 处理，
仅记录「多带了两个无人消费的导出」这一事实。置信：**intentional**

### F-mobile-web-15 | P3 | apps/mobile/src/web/chat-transcript/styles/transcript.css:218-224 与 394-396

`.bubble-body { white-space: pre-wrap; word-break: break-word; }`（218-224）与
`.bubble-body.rich { white-space: normal; }`（394-396）声明了两遍——后者在
`/* __RICH_CSS__ */` 注入点（392 行）之后，与注入进来的 `${group} { white-space: normal; }`
（`rich-content-styles.ts:82`）功能重叠。值一致，今天无差异。

建议：删 394-396（`rich-content-styles.ts:82` 已覆盖 `.bubble-body.rich`）。置信：**confirmed**（重复声明事实）

## 争议与存疑

**以下几件我没能下定论，明确列出不做抹平：**

1. **`webview-host` 三个「真源」模块到底是「该接回去」还是「该删掉」**（F-3）。两种修法方向相反：
   接回去 = 让 webview 侧 import 共享纯数；删掉 = 承认它们已是历史实现。我倾向**接回去**（`scroll.ts`
   的 `scrollTopForOffsetFromBottom` 已经证明这条路走得通，snapshot.ts:10 就在用），但 `scroll.ts`
   里那几个是 DOM 形的 webview 版，签名不同、不是纯机械替换，需要改动 `runtime/scroll/scroll.ts` 的调用面。
   这条是本区最需要人拍板的。

2. **core 依赖是「可接受的」还是「该抽出去」**（F-5）。`formatStatusChipLabelFromAttachment` 是个
   纯函数、依赖 core 不算架构污染；但它让 webview 资产绑上了 core 的 dist 编译时点，
   与 RULE:73「webview 是三层产物链、metro reload 碰不到」的组合放大了「忘重建 dist」的静默面。
   要不要在 core 侧开个更轻的子路径（哪怕只是把这个函数挪进 `public/chat` 之外的无依赖模块），
   我没有依据判断，交给主代理裁决。

3. **`.tool-phase-bar` / `.vfs-turn-row` 的删除会不会碰 e2e**（F-4）。我确认了生产侧零产出方，
   但 `apps/mobile/e2e/` 已被 RULE:106 标注「页对象与当前 UI 已多处脱节」，e2e 现状本身不可信。
   删 CSS 不影响 e2e 编译（类名是字符串），但那两条永不执行的断言是否要一并删，属于 e2e 机位的地盘。

4. **code-editor 只给 md/json 上高亮**（F-6）。我只能确认「依赖里就没有别的语言包」这个事实，
   没法确认「这是产品拍板的」还是「早该加只是没加」。RULE 里没有对应条目。

5. **本区没有任何 P0/P1**。我按「会不会丢用户数据 / 会不会让 app 崩 / 信任边界有没有破」三条
   反复筛过：信任边界统一走 `shared/ui/TrustedHtml`（RN 侧消毒后传入，web 侧不再二次拼接），
   `mermaid-core.ts:54` 显式 `securityLevel: 'strict'`，`applyStreamBlockCommit` 的 `blockHtml`
   虽是裸 `insertAdjacentHTML`（stream.ts:518-521）但来源是 RN 侧 `prepareStreamTailHtml` 的消毒产物
   （与 rich-content-styles 同一信任模型）。滚动/窗口化的读位补偿链路我逐条推演过
   （`applyPrependPageNow` 的 `prependSpacerBefore` 采样、`applyRowWindowMove` 的行坐标重映射），
   公式与注释自洽。**我不认为本区存在需要立刻修的缺陷**——上面 15 条里 5 条 P2 全是可维护性/
   一致性问题，没有一条会导致线上故障。这是我读完 9071 行后的真实判断，不为了凑数抬级。
