---
zone: w8-mobileweb-adv
agent: advocate（辩护人 / 对抗机位）
files_scanned: 93
---

# W8 对抗机位 · 辩护报告（apps/mobile/src/web/ + src/webview-host/）

> 机位立场：为该区域的设计合理性辩护。所有结论带 `file:line` 与原文引文；
> 无法辩护处一律进「让步清单」，不抹平。

## 摘要

四个 WebView 包（chat-transcript / rich-document / code-editor / composer-input）的**页内源码**，
加一层 `webview-host/`（RN 与 web 双端共用的纯函数岛）。页内以 Preact 建壳、
runtime 以命令式 DOM 增量维护流式尾块，跨边界只靠 `{v,type,payload}` JSON 信封。

## 职责与边界

- `src/web/<pkg>/webview/` — 页内实现。`main.ts` 是唯一装配点（挂 ready、注册视图刷新实现），
  其下分 `runtime/`（无 JSX、命令式）与 `ui/`（Preact）。
- `src/web/shared/` — 四包共用：post 出口、host 消息通道、host 主题 token、
  实体解码、富文本 CSS 单源、mermaid 核心与全屏查看器。
- `src/webview-host/` — **双端共用纯函数岛**（RN 侧与 webview 侧都 import 的无 DOM 函数）。
- 明确不做：跨域编排（分片/延时的编排在 `components/chat/ChatTranscriptWebView.tsx`）、
  资产拷贝（`scripts/build-webview.mjs`）、原生侧（`components/*WebView.tsx`）。

## 对外接口

| 符号 | 位置 | 消费方 |
|---|---|---|
| `post(type, payload)` | `web/shared/post.ts:24` | 四包 runtime |
| `createBoundPost(bridgeV)` | `web/shared/post.ts:44` | 四包各一处绑定 |
| `matchHostMessage(raw, v)` | `web/shared/host-message-channel.ts:34` | 四包 bridge |
| `bindHostMessageChannel(handler)` | `web/shared/host-message-channel.ts:47` | 四包 main/boot |
| `applyHostTheme(theme, opts)` | `web/shared/host-theme.ts:47` | transcript / rich-document / code-editor |
| `renderMermaidCodeBlocks(root, cache, opts)` | `web/shared/mermaid-core.ts:164` | 两管线 |
| `createMermaidSourceCache()` | `web/shared/mermaid-core.ts:95` | 两管线各建一份 |
| `splitStreamBlocks(text)` | `web/chat-transcript/stream/block-split.ts:100` | **仅 RN 侧**（`ChatTranscriptWebView.tsx:69`） |
| `TRANSCRIPT_CAPABILITIES` | `web/chat-transcript/transcript-capabilities.ts:17` | RN + webview boot 双向 |
| `layoutAnchoredMenu*` | `webview-host/chat-transcript/anchored-menu-layout.ts:48,65` | RN `MessageActionMenu.tsx` + webview `menu.ts` |
| `getWebViewPackageIndexUri/DirUri` | `webview-host/webview-asset-uri.ts:46,58` | 四个 `*/uri.ts` → 四个 RN WebView 组件 |

## 数据访问

- 不触表 / 不触 KKV / 不触文件系统（`getWebViewPackageIndexUri` 明写「不做存在性探测」，
  `webview-asset-uri.ts:45`）。
- 唯一外部资源读取：mermaid 通过 `await import('mermaid')` 走 **bundle 内联**（`mermaid-core.ts:42`，
  注释「IIFE 无分包」）；`file://` 下无网络。
- CSS 单源走构建期读取：`build-webview.mjs:207` 用 esbuild 动态 import
  `shared/rich-content-styles.ts` 取常量，`:88 injectCss` 注入，注释「禁止在 assemble/build 内再嵌第二份规则」。

## 依赖关系

```
RN 侧（ChatTranscriptWebView / ComposerInputWebView / CodeEditorWebView / RichDocumentWebView）
   ├─ import ──> webview-host/**            （纯函数 + 资产 URI）
   ├─ import ──> web/chat-transcript/stream/block-split.ts、transcript-capabilities.ts
   └─ import ──> components/chat/ChatTranscriptBridge.ts（信封类型真源，RN 侧）

webview 侧（IIFE bundle）
   ├─ @web/shared/**            （四包共用）
   ├─ ../../../../../webview-host/**   （menu.ts / snapshot.ts 反向引纯函数）
   └─ @novel-master/core/chat  （仅 row-logic.ts:6 一处）
```

依赖方向**双向但只经纯函数**：webview 引 `webview-host/` 用相对路径（`menu.ts:6`、
`snapshot.ts:10`），RN 侧用 `@/webview-host/*`（`components/chat/anchored-menu-layout.ts:6` 是
`export *` 再导出）。构建别名 `@` → `apps/mobile/src` 在 `build-webview.mjs:69` 显式配好，
不是巧合。

---

# 一、辩护理由清单

## D-w8-1 按源码去重（mermaid 缓存）是正确取舍 —— 辩护成立

**主张**：`createMermaidSourceCache` 用 `${theme}\u0000${source}` 做键、成功/失败/在途三张表，
是「渲染代价高、输入可精确哈希、结果确定」的教科书形态。

证据：

```ts
// web/shared/mermaid-core.ts:95-136
const svgCache = new Map<string, string>();
const failedCache = new Map<string, unknown>();
const inflight = new Map<string, Promise<string>>();
```

三个设计点各自有独立理由：

1. **键含 theme**：mermaid 的 `initialize` 是全局单例（`mermaid-core.ts:54`
   `mermaid.initialize({startOnLoad:false, theme, ...})`），主题参与渲染结果，
   不同主题的同一份源码 SVG 不同 → 必须进键。若只按 source 去重，主题切换后会拿错缓存。
2. **失败也缓存**：`isFailed` + `getOrCreate` 的 failed 分支（`:112-115`）让同一份坏源码
   第二次直接 reject，不再重复触发 mermaid 的解析异常。失败态在 DOM 上有可见表达
   （`code.setAttribute('data-mermaid-error', ...)`，`:206`），用户看得见，不是静默失败。
3. **inflight 合并**：`:117-120` 同键并发只渲染一次。同一份源码在一次
   `renderMermaidCodeBlocks` 循环里出现两次时（历史消息重复贴同一图），
   没有这层会重复调 mermaid.render。

「懒加载 + 150ms 防抖 + 流式期不触发」三点与去重是配套的，不是重复劳动：
`web/chat-transcript/webview/runtime/mermaid.ts:18` `SCAN_DEBOUNCE_MS = 150`，
`:41-43` 只扫 `#rows` 且 `skip: code => !!code.closest('#stream-tail')`。
**置信：confirmed。**

## D-w8-2 rAF 整段替换 → 块级 append-only 的演进，取舍方向正确 —— 辩护成立

**主张**：「每 rAF 整段替换 innerHTML」是**旧形态**；当前实现已改成
「完成块 insertAdjacentHTML append + 活跃尾块局部替换」，这是对旧取舍的修正而非重复。

证据（提交即设计意图）：`afdf9736 feat(mobile): 流式 richText 渲染块级化——块提交 append-only 根治每帧全量重渲`。

```ts
// web/chat-transcript/webview/runtime/stream/stream.ts:517-521
// 完成块 append：插在尾块容器之前，已提交块区只增不改
tailEl.insertAdjacentHTML(
  'beforebegin',
  blockHtml ? blockHtml : escapeHtml(blockText),
);
```

配套的三处守门也都到位：

- 活跃尾块单独容器：`:126-139 ensureStreamActiveTail`，注释「已渲染 DOM 节点原样迁移，不重建（增量岛约束）」。
- 显示态数组化、物化收敛到读点：`:41-58`（`streamDisplayParts` + `materializeStreamDisplay`），
  出口 `appendStreamDelta:623` 与批尾 `applyStreamBatch:655-656` 各物化一次。
- Preact 壳防 wipe：`:39-42` `StreamBodyHost.shouldComponentUpdate(): false`
  （`ui/stream/StreamTail.tsx`），保证壳重渲不销毁 runtime 写入的 body DOM。

**代价是真实的、但已被承认**：块边界切分是「视觉近似」（`block-split.ts:9-12`
「段落内懒惰延续等极端形态的视觉近似可接受，与 streaming-markdown 等流式渲染库的通行取舍一致」）。
这类取舍在流式渲染领域是共识，不是本仓独创。**置信：confirmed。**

## D-w8-3 桥协议信封形态 `{v, type, payload}` 合理，且双端校验强度不对称是刻意设计 —— 辩护成立

**主张**：信封三字段、web 侧静默丢弃 / RN 侧抛错，这种不对称不是疏忽，是两侧失败语义不同。

证据：

| 侧 | 校验 | 失败行为 | 位置 |
|---|---|---|---|
| web | `msg.v !== bridgeV \|\| !msg.type` | `return null` 静默丢 | `shared/host-message-channel.ts:38-41` |
| RN | `parsed.v !== VERSION` / `typeof type !== 'string'` | `throw new Error` | `ChatTranscriptBridge.ts:277-283` |

理由链：webview 跑在设备 WebView 里，一次 `throw` 会打断整页脚本；RN 侧 throw 会被
`try/catch` 静默丢弃（`components/chat/ComposerInputBridge.ts:5-6`：
「decode 走抛错口径…由宿主 try/catch 静默丢弃」）。强度倒挂是**对齐各自失败域**。

更关键的一点：**能力协商用能力清单而非版本号字符串**——

```ts
// web/chat-transcript/transcript-capabilities.ts:3-7
// 口径：webview 在 ready 上报 `capabilities` 数组，RN 侧据此启用对应渲染
// 路径（默认用能力声明而非版本号字符串，版本号仅作辅助信息）。
```

RN 侧消费点 `ChatTranscriptWebView.tsx:470-475` 写明动机：旧 dist（打进 APK 的 assets）
不声明 `streamBlockCommit` 时 RN 必须退回全量路径，否则「webview 静默丢弃块提交导致
流中只剩尾块」。这是 dist 与 JS 不同步的真实故障（dist 不进 git）催生的设计，
不是过度设计。**置信：confirmed。**

## D-w8-4 es2018 目标的约束是真的，且在源码里有可查的纪律痕迹 —— 辩护成立（但门禁有洞，见 C-w8-5）

**主张**：`es2018` 不是随手写的 target。

证据链完整：

- 构建：`build-webview.mjs:113` `target: ['es2018']`，`:110` `format: 'iife'`，`:120` `packages: 'bundle'`。
- 类型：`web/tsconfig.json` `"target": "ES2018"` / `"lib": ["ES2018", "DOM"]`。
- 纪律落到注释：`ui/render/RefTokenText.tsx:12`
  > `// 勿用 lookbehind（(?<!\S)）：老安卓 WebView 不支持，正则字面量在解析阶段直接 SyntaxError`

  并且**给了替代实现**，不是只写禁令：`:15-19` 手工判前字符 `hasWordBoundaryBefore`。
- `block-split.ts:18-19` 同样把约束写进文件头：「es2018 兼容：禁 lookbehind 等新正则特性
  （esbuild target es2018 不转译正则）；本文件只用普通正则与字符扫描」，
  并在 `:66-88 isTableDelimiterRow` 用字符扫描替代正则。
- `composer-input/webview/runtime/editor.ts:12-13`：
  > `老 Android WebView 解析期即报 SyntaxError，禁用 lookbehind 等 ES2018 之后的正则/语法特性；target es2018`

实测：全 `src/web` 递归 grep `(?<=` / `(?<!`，命中 2 处，**全部在注释里**（`RefTokenText.tsx:12,15`），
无一处真实正则使用。**置信：confirmed。**

## D-w8-5 四包 post/theme/消息通道三份平行已收敛到 shared —— 辩护成立

2026-08-30 全仓 CR 的 P1 `web/C-orch-1/2/3`（`docs/Iterations/mobile-cr-dedup-abstraction/cr-fix-spec.md:148-173`）
针对的正是这三个重复。现状：

- post：`shared/post.ts` 一个工厂 + `createBoundPost(bridgeV)`；chat-transcript 的内联实现已删
  （`runtime/bridge.ts:31` `export const post = createBoundPost(BRIDGE_V)`），
  另两域是 8 行薄封装（`code-editor/webview/runtime/post.ts:8`、`rich-document/.../post.ts:8`）。
- theme：`shared/host-theme.ts:30-39` 一张 `THEME_VARS` 映射表覆盖四域，
  code-editor 的 `--editor-*` 派生走 `opts.extraVars`（`theme.ts:85-93`），不再自算色。
- 消息通道：`shared/host-message-channel.ts:47` 一个 `bindHostMessageChannel`，
  注释说明 Android 走 document、iOS 走 window 故双注册——
  **这一点经实测成立**：`node_modules/react-native-webview/android/.../RNCWebViewManagerImpl.kt:335`
  是 `document.dispatchEvent(event)`，iOS 侧
  `node_modules/react-native-webview/apple/RNCWebViewImpl.m:1115` 是
  `window.dispatchEvent(new MessageEvent('message', %@))`。双注册有据，不是冗余。**置信：confirmed。**

## D-w8-6 `webview-host/` 作为双端纯函数岛的设计成立 —— 辩护成立（但落地不完整，见 C-w8-3）

**主张**：`src/webview-host/` 的存在理由是「同一份布局/滚动数学被 RN 的 Modal 与 WebView 的
overlay 同时用」，且必须是 Jest 可直测的纯函数。

依据是 P1 `web/C-orch-4`（cr-fix-spec.md:175-182）判定「同一路径菜单布局算法在 WebView 域与
RN 域双源维护，改一边漏一边」。落地形态正确：

- `anchored-menu-layout.ts` 文件头自述双端口径，RN 侧 `components/chat/anchored-menu-layout.ts:6`
  是纯 `export *` 再导出（不是复制），**引用同一份函数对象**——
  `__tests__/anchored-menu-layout-parity.test.ts:22-25` 用 `toBe` 断言两者同一函数（不是深比较）。
  这类「同一性」断言比「行为等价」断言强一档，是好测试。
- `menu.ts:54-56` WebView 侧只留 DOM 取值 wrapper（`window.innerWidth` /
  `document.documentElement.clientHeight`），布局计算全部委托。

**置信：confirmed（设计层）。**

## D-w8-7 TrustedHtml 是页内唯一的 HTML 信任边界 —— 辩护成立

```ts
// web/shared/ui/TrustedHtml.tsx:29-34
/**
 * runtime 命令式写入：等价于组件路径的信任边界。
 */
export function applyTrustedHtml(el: Element, html: string): void {
  el.innerHTML = html;
}
```

实测全 `src/web` 的 HTML sink 只有 5 处，全部可归因：

| 位置 | 用途 | 是否过信任边界 |
|---|---|---|
| `TrustedHtml.tsx:24` | Preact `dangerouslySetInnerHTML` | 是（组件路径） |
| `TrustedHtml.tsx:33` | 命令式 `el.innerHTML` | 是（runtime 路径） |
| `mermaid-core.ts:197` | `chart.innerHTML = svg` | 否（mermaid `securityLevel:'strict'` 的产物，`:54`） |
| `composer-input/.../editor.ts:265` | 高亮层 | 否（自产、转义过 `:52 escapeHtml`） |
| `stream.ts:216, 518` | 转义 append / 已消毒块 append | 否（前者 `escapeHtml(delta)`，后者宿主消毒 html） |

注释也标了刻意的例外：「`body` 子树的 createElement / insertAdjacentHTML 为刻意增量岛屿，
禁止本迭代迁 Preact」（`stream.ts:151-152`）。这类「为什么不做」的注释密度在本区很高，
是可维护性的正面信号。**置信：confirmed。**

## D-w8-8 行窗口化（row-windowing）用估算 + EWMA 替代全量 vnode，是合理的性能取舍 —— 辩护成立

```ts
// web/chat-transcript/webview/runtime/render/row-windowing.ts:20-28
export const ROW_WINDOW_ROWS = 60;
export const ROW_WINDOW_BUFFER_ROWS = 20;
const ROW_WINDOW_SHRINK_HYSTERESIS_ROWS = 20;
const ROW_WINDOW_FALLBACK_SLOT_PX = 120;
const ROW_WINDOW_AVG_ALPHA = 0.25;
```

四个设计点各有对应故障模式，且注释写明：

- 滞回带（`:23`）「防估算抖动来回拉扯」；
- 贴底守卫（`:263-270`）「打字时的突然抖动」——修的是「视口高度变化（输入框换行长高 /
  键盘弹收把 webview 挤矮）引发的 scrollTop 钳制会把视口行估算推高、误判为用户上滚并触发上端收缩」；
- 上端读位锚定用行坐标重映射而非 scrollHeight 差值（`:211-220`）「扩窗会把视口下方的占位
  估算行换成真实行，差值里混入视口下方的高度差，污染补偿量」；
- prepend 后的占位漂移扣除（`:341-366`，对应 P2 `web/C-1`）。

纯函数出口（`desiredRowWindow` / `planRowWindowMove` / `notePrependHeightDelta`）
使这一整套能在 Jest 里以 fake DOM 直测（`__tests__/chat-transcript-row-window.test.ts`
实测 31 处 `describe|it`）。**置信：confirmed。**

## D-w8-9 「web 引 core」只有一处，且不是权宜之计 —— 辩护成立（附代价说明）

`web/chat-transcript/webview/runtime/render/row-logic.ts:6` 是全 `src/web` 唯一的
`@novel-master/*` import：

```ts
import {formatStatusChipLabelFromAttachment} from '@novel-master/core/chat';
```

附件 chip 的中文文案必须与 core 单源（否则同一 attachment 在 core 与 web 两处渲染出
不同标签）。构建侧 `packages: 'bundle'`（`build-webview.mjs:120`）显式允许打包依赖，
注释「仅允许解析 web/shared 与本包；禁止拉进 RN 组件树」。

实测 bundle 体积构成（`webview-dist/chat-transcript/app.js`，8,866,225 字节）：
`mermaid` 出现 540 次、`novel-master` 字面量 2 次（都在一个 UA 字符串里），
`formatStatusChipLabelFromAttachment` 存在、`vfs-revision` 存在。**8.8MB 的主因是 mermaid，
不是 core 那一处 import。** 所以「为省体积而镜像 core 逻辑」的收益不成立，
维持 import 是对的。**置信：confirmed（体积归因实测）。**

## D-w8-10 `tsconfig.webview-boot.json` 退役后 include 已补齐，code-editor 不再脱离类型检查 —— 辩护成立

P1 `web/A-1`（cr-fix-spec.md:184-191）判「code-editor/webview 目录未被任何被执行的
typecheck 覆盖，类型错误静默漏检」，决议是补 include + 退役该配置（2026-08-30 拍板）。

实测：

- `web/tsconfig.json` include 已含 `code-editor/webview/**/*.ts` 与 `composer-input/webview/**`；
- `apps/mobile/package.json:21`
  `"typecheck": "tsc --noEmit -p tsconfig.build.json && tsc --noEmit -p src/web/tsconfig.json && npm run e2e:tsc"`
  —— web 项目在门限里；
- 实跑 `npx tsc --noEmit -p src/web/tsconfig.json`：**零输出零错误**。

**置信：confirmed。**

---

# 二、让步清单（辩护不成立或需承认的部分）

## C-w8-1 mermaid.ts 的头部注释已与实现脱节 —— P2 / confirmed

```ts
// web/chat-transcript/webview/runtime/mermaid.ts:6-7
 * 流式期（streamDelta/streamBatch）不触发：流式 rich 路径每 rAF 整段替换
 * bubble-body innerHTML，图表会被冲掉；流式尾保留源码占位（共享 CSS 弱化展示）。
```

块级渲染（`afdf9736`）之后，**流式 rich 路径不再整段替换 `bubble-body`**——
`stream.ts:145-147 streamRenderTarget` 把目标收敛到 `.stream-active-tail`，
`stream.ts:517-521` 已完成块走 `insertAdjacentHTML('beforebegin')`。
「整段替换」这个前提已不成立。

结论仍对（流式期确实不扫 mermaid、确实只扫 `#rows` 跳过 `#stream-tail`），
但**理由陈述的是旧机制**。这类注释漂移在本仓有前科——记忆 `20260830-mobile-cr-dedup-abstraction`
第 135 段记录的 `web/C-2` 折叠头 class 派生事故、以及「注释与实现漂移」被单列为第 ③ 个问题面。
建议改注释而非改行为。**置信：confirmed。**

## C-w8-2 `VFS_FILE_TOOLS` 用 `Record<string, number>` 查表，命中对象原型链 —— P3 / confirmed

```ts
// web/chat-transcript/webview/runtime/state/state.ts:7-11
export const VFS_FILE_TOOLS: Record<string, number> = {
  read: 1,
  write: 1,
  edit: 1,
};
```

```ts
// web/chat-transcript/webview/runtime/util/vfs-tool-path.ts:50
if (!VFS_FILE_TOOLS[name]) return null;
```

`name` 来自 `tool.name`（LLM 产出的 tool_use 名，经 RN 行数据透传）。
实测（node）：`{read:1,write:1,edit:1}['constructor']` → truthy，`['toString']` → truthy。
即工具名恰为 `constructor` / `toString` / `valueOf` 时会被误判为「可打开文件的 VFS 工具」，
进而走 `openToolFile` 上抛一个任意 `path`。当前 core 工具名表里没有这些名字，
所以**不可达**；但这是靠上游巧合而非本层防御成立的。改成
`Object.prototype.hasOwnProperty.call(VFS_FILE_TOOLS, name)` 或 `Set` 即可。
**置信：confirmed（行为），影响面 suspected（需上游出现同名工具）。**

## C-w8-3 `webview-host/` 三个模块的实际生产消费方为零，只剩测试在用 —— P2 / confirmed

设计意图（D-w8-6）是「RN 与 web 双端共用」，但落地后：

| 模块 | 生产消费方 | 仅有 |
|---|---|---|
| `chat-transcript/menu-overlay-guards.ts` | **无** | `__tests__/menu-overlay-guards.test.ts` |
| `chat-transcript/stream-tail-html-state.ts` | **无** | `__tests__/stream-tail-html-state.test.ts` |
| `chat-transcript/scroll.ts` | 仅 `scrollTopForOffsetFromBottom`（`snapshot.ts:10`） | 其余 5 个导出仅测试 |

而 web 侧**另有一套自己的实现**：`web/chat-transcript/webview/runtime/scroll/scroll.ts:10`
`offsetFromBottom(el)`、`:24 clampScrollTop(el, prev)`——同名不同签名（DOM 版 vs 纯数值版），
与 `webview-host/chat-transcript/scroll.ts:21,61` 的同名纯函数**并存**。

也就是说 D-w8-6 想消灭的「双源」在这个子域**仍然存在**，只是换了个位置：
`shouldIgnoreMenuOutsideDismiss`（webview-host）与 `menu.ts:196-201` 内联的
`Date.now() - state.menuOpenedAt < MENU_OPEN_GRACE_MS` 是同一判据的两份代码，
后者仍直接 import `MENU_OPEN_GRACE_MS` 常量而非调用前者。

`runtime/scroll/scroll.ts:24` 的 `clampScrollTop` 更彻底——全仓 grep 只有定义处，
**既无生产消费也无测试消费**。**置信：confirmed。**

## C-w8-4 同名同义的 DOM / 纯函数双轨，签名不同，误用风险实在 —— P3 / confirmed

除 C-w8-3 所列，同区还有：

- `MenuAnchor` 类型在 `runtime/state/state.ts:78-82` 与
  `webview-host/chat-transcript/anchored-menu-layout.ts:32-35` 各声明一次
  （字段同：`x/y/width/height`）。`menu.ts:39-45` 显式做了一次手工搬运
  （`const anchor: MenuAnchor = {x: rect.x, ...}`），说明两者确实不共享身份。
- `escapeHtml` 在 `web/chat-transcript/webview/runtime/util/html-escape.ts:5` 与
  `web/composer-input/webview/runtime/editor.ts:52` 各有一份。后者与前者的
  `escapeHtmlRaw` 逐字符等价（都是 `& < > "` 四 replace），但前者多一步
  `decodeLiteralHtmlEntities`——语义**不同**。composer 那份注释未说明为何不复用。

**置信：confirmed。**

## C-w8-5 `web/tsconfig.json` 的 `lib: ES2018` 门禁被 `@types/node` 击穿 —— P3 / confirmed（实测）

`web/tsconfig.json` 声明 `"lib": ["ES2018", "DOM"]`，但实跑
`tsc --noEmit -p src/web/tsconfig.json --listFiles` 的输出里出现了
`lib.es2019.string.d.ts`、`lib.es2020.*`、`lib.es2025.*` 等**远超 ES2018 的 lib 文件**。

根因：`node_modules/@types/node/index.d.ts:28` 有 `/// <reference lib="es2020" />`，
triple-slash 引用会把后续 lib 传递拉进来。后果：

```ts
// web/rich-document/webview/runtime/annotate-collect.ts:132-133
const leadingWs = normalized.length - normalized.trimStart().length;
const trailingWs = normalized.length - normalized.trimEnd().length;
```

`String.prototype.trimStart/trimEnd` 是 **ES2019**（Chrome 66+），在名义 ES2018 的
配置下编译通过。同样出现在 `block-split.ts:42` `line.trimStart()`。

客观缓解：`block-split.ts` **从不进 webview bundle**（全仓 grep 消费方只有
`ChatTranscriptWebView.tsx:69` 与测试），跑在 RN/Hermes 侧，`trimStart` 无风险。
`annotate-collect.ts` 确实进 rich-document bundle，但 `minSdkVersion = 26`
（`android/build.gradle:4`）+ WebView 可更新，Chrome 66 的门槛在实践中基本跨过。

所以这是**门禁可靠性问题而非现网故障**：想守住 es2018 只能靠人工注释纪律（D-w8-4），
编译器不再兜底。可选修法：`web/tsconfig.json` 加 `"types": []` 断掉 `@types/node` 的
lib 引用（需评估是否影响其他引用）。**置信：confirmed（门禁），实际故障 suspected。**

## C-w8-6 `block-split.ts` 的「双端安全」自述有一半是空头 —— P3 / confirmed

```ts
// web/chat-transcript/stream/block-split.ts:15-19
 * - 纯函数零依赖：同时被 RN（ChatTranscriptWebView 块感知渲染）与 Jest
 *   直测引用，禁止 import DOM / @web / Preact——RN tsconfig 与 webview
 *   es2018 双端安全。
```

事实：该文件**不在 `web/tsconfig.json` 的 include 名单里**（include 只列
`chat-transcript/webview/**`、`rich-document/webview/**`、`code-editor/webview/**`、
`composer-input/webview/**`、`shared/**`）。实测 `--listFiles` 输出中
**无 `block-split.ts`**（对照组：`transcript-capabilities.ts` 与 `annotate-collect.ts`
均在输出中）。它只被 RN 的 `tsconfig.build.json` 覆盖（`lib: ES2022`）。

所以「webview es2018 双端安全」里的 webview 那一半**从未被 es2018 检查器验证过**，
且因它不进 bundle 而无实际风险。注释的意图（保持纯函数以便双端引用）是对的，
只是措辞让人以为有两道检查。**置信：confirmed。**

## C-w8-7 mermaid 缓存无上界，长会话下随图表数量线性增长 —— P3 / confirmed

`mermaid-core.ts:96-97` 两张 `Map` 均无 LRU / TTL / 容量上限。
对比：desktop 侧同类缓存按记忆记载有 LRU + TTL + 四处连带清理
（`docs/apm/RULE.md` mermaid 条：`failedErrorCache`「key 同 svgCache，LRU 淘汰/TTL 过期/
成功覆盖/reset 四处连带清理」）。mobile 侧无对应处理。

实际风险：一张会话里的 mermaid 图表数量有限（小说正文场景通常个位数），
每份 SVG 是 KB 级字符串。**影响面小**，但两侧口径不一致本身是个不对称，
值得记一笔以免日后被当成「mobile 特有缺陷」重复排查。**置信：confirmed（无上界），影响 suspected。**

## C-w8-8 `applyHostTheme` 条件式写入 + CSS 兜底，会留下陈旧变量 —— P3 / suspected

```ts
// web/shared/host-theme.ts:63-66
for (const {key, cssVar} of THEME_VARS) {
  const value = theme[key];
  if (!value) continue;
  root.style.setProperty(cssVar, value);
```

「缺字段不写、由消费侧 `var(--x, fallback)` 兜底」是 2026-08-30 拍板的
（cr-fix-spec.md:162）。代价：一次**部分字段**的主题下发（如只带 `background`+`text`）
之后，若上一次下发写过 `--danger`，`--danger` 会保留旧值——`continue` 不清理。
当前四个 RN 侧下发方都发全量字段（`TranscriptTheme` 七个字段全 required，
`ChatTranscriptBridge.ts:76-84`），所以不可达。标 suspected。**置信：suspected。**

---

# 三、争议与存疑（不抹平）

1. **C-w8-3 的处置方向存在分歧**：一方主张「`webview-host/` 里未被消费的模块应删」，
   一方主张「保留作纯函数测试床 + 未来 RN Modal 复用的预留」。本机位不裁决——
   判据应是 `menu-overlay-guards` 的两个函数在 `menu.ts:196-201` 有内联等价实现，
   若确认未来无第二个消费方，删除比保留更诚实；但这需要 mobile 侧路线决策，不是纯技术判断。

2. **`state.ts` 的 `VFS_FILE_TOOLS` 用 `Record<string, number>` 而非 `Set<string>`**：
   写法上更可能是有意的「值语义占位」（未来或许要按工具分权重），也可能是随手写。
   我按行为缺陷报（C-w8-2），但**不主张它的意图**。

3. **块级渲染的「视觉近似可接受」是产品决策不是工程决策**（`block-split.ts:9-12`）。
   记忆里 llm-stream-native 那轮的验收硬指标（10 万字不掉帧）覆盖的是性能，
   **没有覆盖「块边界处段落延续的视觉等价」**。若用户报过流式排版错位，
   该近似需要重新评估——本区无任何测试能捕获这类视觉差异。

---

## 附：本机位核对过的实测项

- `npx tsc --noEmit -p src/web/tsconfig.json` → 零输出（通过）。
- `tsc --noEmit -p src/web/tsconfig.json --listFiles` → 确认 lib 越界 + `block-split.ts` 缺席。
- `webview-dist/*/app.js` 体积：chat-transcript 8,866,225 / rich-document 8,145,635 /
  code-editor 1,004,952 / composer-input 21,826 字节；chat-transcript bundle 内
  `mermaid` 命中 540、`formatStatusChipLabelFromAttachment` 命中。
- 全 `src/web` grep `(?<=` / `(?<!` → 2 处，均在注释。
- 全 `src/web` grep ES2020+ 内建（`replaceAll` / `Object.fromEntries` / `.flat(` / `.at(` /
  `matchAll` / `structuredClone` / `??=` / `||=`）→ 零命中；`trimStart/trimEnd` 2 处（C-w8-5）。
- 全 `src/web` grep HTML sink → 5 处（D-w8-7 表）。
- 全仓 grep `webview-host/` 消费方 → 12 处，无遗漏点。
- node 实测 `{read:1,write:1,edit:1}['constructor']` → truthy（C-w8-2）。
- 读 `node_modules/react-native-webview` 源码确认 Android `document.dispatchEvent` /
  iOS `window.dispatchEvent`（D-w8-5）。