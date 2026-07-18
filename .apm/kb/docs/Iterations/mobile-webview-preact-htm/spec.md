---
date: 2026-07-17
---

# Mobile WebView Preact + TSX 视图层 技术规格（SPEC）

> **PRD**：[`prd.md`](./prd.md)  
> **建议分支**：`feat/mobile-webview-preact-tsx`（或当前功能分支）  
> **代码基线**：bundler + `web-src-layout-cleanup`（`src/web/{pkg}/webview` + `webview-host`）  
> **需求来源**：PRD 定案「Preact + TSX」+ 只读探索（构建 JSX、CT 拼接点、契约测关键字）  
> **前置覆盖**：本迭代 **supersede** layout-cleanup 的「CT webview 七类顶层物理路径」与 **T-WL-07**（见下「与 layout-cleanup 关系」）；职责心智与禁 barrel **保留**。

## 设计目标

1. 双包 WebView 视图主写法统一为 **Preact + TSX**（**禁止** htm / 手拼骨架 HTML 作为新主路径）。  
2. 继承 bundler：**esbuild IIFE**、classic `<script src>`、**`minify: false`**、固定三文件、uri 加载不变。  
3. **目录分层**：每个包 `webview/` 内 **`ui/`（仅 `.tsx`）与 `runtime/`（仅 `.ts`）分离**；`runtime` 仍按职责分子目录（含 **`menu/`、`render/`**），禁止同目录混放 TSX 与非 UI 逻辑 TS。**UI 刷新装配（P0-3）**：`main` 注册 Preact 实现；runtime 仅同名门面。  
4. **RD 整页先行**；CT **menu → render（含 tool）→ stream** 分波；流式热路径保局部 DOM（落在 `runtime/`）。  
5. **信任 HTML** 与明文转义边界可测（统一经 TrustedHtml 边界；RD 含 frontMatterHtml）。  
6. 契约测意图不变；允许按 **三列矩阵**修订关键字。

## 总体方案

### 架构

```text
RN 宿主（桥 / 消毒 HTML / uri）
        │
        ▼
webview-dist/{pkg}/app.js   ← esbuild IIFE（含 preact + ui/*.tsx + runtime/*.ts）
  index.html classic script
        │
src/web/{pkg}/webview/
  main.ts              # 唯一根入口：注册 Preact 实现 + 组装 runtime（本身无 JSX）
  ui/**/*.tsx          # 仅 Preact 组件（结构 UI）
  runtime/**/*.ts      # 仅非 UI：门面/桥/状态/滚动/流式增量 DOM/escape 等
                       # （UI 刷新经已注册实现；禁止 runtime→ui / runtime 内 preact.render）
```

### 与 layout-cleanup 关系（硬定案）

| 项 | 定案 |
|----|------|
| **物理路径** | 本迭代 **supersede** layout-cleanup「CT `webview/` 七类顶层」终局树与验收 **T-WL-07**。终局不再要求 `webview/{bridge,state,scroll,menu,stream,render,util}` 作为顶层；改为 `webview/ui/**` + `webview/runtime/{bridge,state,scroll,menu,stream,render,util}/**`。 |
| **保留** | 七类 **职责心智**（改菜单找 menu、改行找 render、改流式找 stream…）；**禁止** `index.ts` barrel；跨目录显式文件路径。 |
| **T-WL-07** | 在本迭代落地后 **不再作为 CT 目录验收**；改以本 SPEC 的 T-PH-02 / 终局树为准。layout-cleanup SPEC 仅保留历史记录 + 交叉引用一句。 |

### 唯一定案

| 项 | 定案 |
|----|------|
| 视图栈 | **Preact + TSX**；不上 `htm` 主路径；不上 `preact/compat` |
| **ui / runtime 分层** | 每个包 `webview/` **必须**含：`ui/`（**仅** `.tsx`）与 `runtime/`（**仅** `.ts`，禁止 JSX）。根级除 `main.ts` 外 **不得**再放业务 `.ts`/`.tsx`。 |
| 依赖方向 | **`ui` → `runtime` / `shared`（非 ui）允许**；**`runtime` → `ui/**` 禁止**。**例外**：`runtime` **仅允许** import `shared/ui/TrustedHtml`（组件供 ui；同文件可导出 `applyTrustedHtml` 等非 JSX API 供 runtime imperative）。禁止 import 其它任何 `ui/**` 或 `shared/ui` 下非 TrustedHtml 模块。`main.ts` 可同时 import 两侧。 |
| **UI 刷新装配（P0-3）** | 见下「runtime 触发 UI 刷新的装配契约」——结构在 `ui/*.tsx`；`runtime` 仅同名门面；**禁止** runtime 直接 import `ui/**` 或在 runtime 内 `preact.render(<…/>)` |
| JSX 编译 | esbuild **automatic**：`jsx: 'automatic'` + `jsxImportSource: 'preact'`；`.tsx` **不**再为 JSX 显式 `import { h }`。显式 `h(...)` **仅**用于非 JSX 手写（`main.ts` 装配） |
| tsconfig | `tsconfig.webview-boot.json`：`jsx: 'react-jsx'` + `jsxImportSource: 'preact'`；`include` 含 `**/*.{ts,tsx}`；**不** extends RN tsconfig |
| deps | `preact`（建议 `^10`）；类型用包内；不装 `@types/preact` / htm |
| 构建 | 保持 `format:'iife'`、`minify:false`、`packages:'bundle'`；入口 **`webview/main.ts`** |
| 信任 HTML | 见下「TrustedHtml 边界」 |
| 流式所有权 | 见下「流式 Preact ↔ imperative DOM」 |
| 菜单 measure（P1-4） | **mount 后、对用户可见前**完成 measure + `layoutContextMenu`；允许 `useLayoutEffect` 或等价同步回调 |
| barrel | 继续 **禁止** `index.ts` barrel；跨目录显式文件路径 |
| 契约测 | 继续读 dist；**禁止**开 minify 救测；修订矩阵见下（意图不变；三列：必须保留 / 可改为 token / 允许删除） |

### runtime 触发 UI 刷新的装配契约（P0-3）

> 闭合「结构在 `ui/*.tsx`」×「`renderRows` / `renderContextMenu` 落 runtime」×「runtime ✗→ ui」三者互斥：由 **bootstrap 注册** 解耦。

| 角色 | 职责 |
|------|------|
| **`main.ts`（或等价 bootstrap）** | 注册 Preact 实现：CT 的 `renderRows`、`renderContextMenu`；RD 的 `setDocument` 视图刷新（或等价 `renderDocument`）。该注册点是 **唯一** 允许同时触及 `ui/**` 与 `runtime/**` 并调用 `preact.render` / `render` 的地方（除 TrustedHtml 例外外）。`main.ts` 本身可保持无 JSX（用 `h(…)`，或 `import` 薄 `ui/*Bootstrap.tsx` 完成注册）。 |
| **`runtime` 同名门面** | 保留契约测依赖的符号名（如 `renderRows`、`renderContextMenu`、RD `setDocument`）；内部 **只** notify / 调用已注册实现，**不**持有 JSX、**不** `import` `ui/**`、**不**在 runtime 内写 `preact.render(<RowList/>)` 等。 |
| **`ui/*.tsx`** | 结构组件；由注册实现 mount / update。 |

**禁止**：`runtime/**` 直接 `import` 任意 `ui/**`（TrustedHtml 例外除外）；`runtime/**` 内执行 `preact.render(<…/>)` / `h(…)` 组装视图树。

伪代码（注册 → 门面调用）：

```ts
// main.ts 或 ui/ctBootstrap.tsx（唯一装配点）
import { h, render } from 'preact';
import { RowList } from './ui/render/RowList';
import { ContextMenu } from './ui/menu/ContextMenu';
import { registerRenderRows, registerRenderContextMenu } from './runtime/render/row-logic';
registerRenderRows((rows, root) => { render(h(RowList, { rows }), root); });
registerRenderContextMenu((model, root) => { render(h(ContextMenu, { … }), root); });
// RD：registerSetDocumentView((payload) => { render(h(DocumentApp, { … }), docRoot); });

// runtime/render/row-logic.ts（门面；无 ui import）
let _renderRowsImpl: ((…) => void) | null = null;
export function registerRenderRows(fn) { _renderRowsImpl = fn; }
export function renderRows(…) { _renderRowsImpl?.(…); }  // 契约测可保留符号
```

### TrustedHtml 边界（P1-2）

| 内容类型 | 写法 |
|----------|------|
| **宿主已消毒 HTML**（含 RD `doc-body`、**RD `frontMatterHtml`**、CT bubble / thinking / stream rich 片段） | **必须**经 TrustedHtml 边界：`ui` 用 `<TrustedHtml html={…} />`；`runtime` imperative 用同模块导出的 `applyTrustedHtml(el, html)`（或等价命名）。**禁止**对消毒字段裸 `innerHTML =` / 手拼进骨架而不经该边界。RD `frontMatterHtml` 与 body 富片段同规，**一律**走 TrustedHtml（P2 顺带钉死）。 |
| **明文 / 用户文本 / delta 明文** | **只**走 Preact text children，或 `runtime/util` 的 `escapeHtml` 后再写入。**禁止**明文走 TrustedHtml / `dangerouslySetInnerHTML`。 |

### 流式 Preact ↔ imperative DOM（P0-2）

1. **所有权**：Preact **只**拥有壳与相位（如 `#stream-tail` 外层、`waiting-first` / `idle-after-content` 等相位 UI）。text / thinking **body 子树**由 `runtime/stream` 写入后，壳组件 **re-render 不得销毁或替换**这些节点（稳定挂载点；不得因相位无关 props 变化而 remount 内容根）。  
2. **取节点（默认定案）**：runtime **继续** `getElementById` / `querySelector` + 稳定 `id` / `data-*`（与现网一致，如 `#stream-tail`、`data-text-shell`）。**若**改用 Preact ref，须在本 SPEC 实现注中写明注册点（谁持有 ref、何时挂上）；本期默认 **不**强制 ref。  
3. **验收**：delta 热路径 **不得**调用会重建 `#stream-tail` 内容根的整表 Preact `render` / 整列表 remount。全量 vs 增量边界与现网 `appendStreamDelta` 一致：优先 `appendStreamDeltaIncremental`；仅在增量失败或现网已规定的非 text 回退等条件下走 `renderRows` / 全量壳更新。符号名 **`appendStreamDeltaIncremental`**、**`appendStreamDelta`** 须保留（契约测依赖）。

### Context Bundle

```yaml
iteration_name: mobile-webview-preact-htm
requirement_path: Iterations/mobile-webview-preact-htm/prd.md
spec_path: Iterations/mobile-webview-preact-htm/spec.md
explore_summary: |
  Preact+TSX；ui/ 与 runtime/ 强制分离；supersede layout 七类顶层；
  P0-3 装配（main 注册 / runtime 门面）；流式壳/增量所有权；
  TrustedHtml（含 RD frontMatter）；契约测三列矩阵；菜单 measure 时序。
impact_files:
  - apps/mobile/package.json
  - apps/mobile/scripts/build-webview.mjs
  - apps/mobile/tsconfig.webview-boot.json
  - apps/mobile/src/web/rich-document/webview/**
  - apps/mobile/src/web/chat-transcript/webview/**
  - apps/mobile/__tests__/chat-transcript-boot-script.test.ts
  - apps/mobile/__tests__/rich-document-boot-script.test.ts
  - apps/mobile/README.md
constraints:
  - iife + classic script + minify false
  - ui only tsx; runtime only ts; no mix in same dir
  - runtime must not import ui except shared/ui/TrustedHtml
  - main registers renderRows/renderContextMenu/setDocument view; runtime facade only
  - no preact.render inside runtime
  - no htm primary path
  - no per-delta full list / stream-tail content-root remount
  - menu measure+layout before visible (useLayoutEffect ok)
  - no RN deps under src/web
  - no barrel index.ts
  - supersede layout-cleanup T-WL-07 physical seven-dir
blocking_steps: [1, 2, 3, 4, 5, 6, 7, 8, 9]
```

## 最终项目结构

```text
apps/mobile/
  package.json
  scripts/build-webview.mjs
  tsconfig.webview-boot.json
  src/web/
    shared/
      constants.ts
      decode-entities.ts
      rich-content-styles.ts
      ui/
        TrustedHtml.tsx              # 双包共用：组件 + applyTrustedHtml（runtime 例外可 import）
    rich-document/webview/
      main.ts                        # 注册 DocumentApp 视图刷新 + 桥监听（无 JSX）
      ui/
        DocumentApp.tsx              # 主题 + 文档结构；富片段 / frontMatter 走 TrustedHtml
      runtime/
        bridge.ts                    # post / handleHostMessage；setDocument 门面（可单文件）
        document-model.ts            # 可选：payload 归一
    chat-transcript/webview/
      main.ts                        # 注册 renderRows / renderContextMenu + 绑事件（无 JSX）
      ui/                            # ★ 仅 .tsx
        menu/
          ContextMenu.tsx            # 菜单结构（替代手拼 menu HTML 骨架）
        render/
          RowList.tsx
          MessageRow.tsx
          ToolGroup.tsx
          …
        stream/
          StreamTail.tsx             # 壳/相位 UI only；不拥有 body 子树内容
      runtime/                       # ★ 仅 .ts；职责子目录保留七类心智
        bridge/
          bridge.ts
        state/
          state.ts
        scroll/
          scroll.ts
        menu/
          menu.ts                    # 布局/overlay/测量/开关；取 #context-menu 等
        render/
          snapshot.ts
          rows-click.ts
          row-logic.ts               # flagsEqual、renderRows 编排、非 JSX 行逻辑等
          tool-logic.ts              # 原 tool-render 中非 JSX 逻辑
        stream/
          stream.ts                  # appendStreamDelta / appendStreamDeltaIncremental 等
          stream-markdown.ts
        util/
          html-escape.ts
          vfs-tool-path.ts
  webview-host/                      # 不变；不进 Preact
```

### CT 现网 → 本迭代终局映射

| 现网（layout 七类顶层） | 终局 |
|-------------------------|------|
| `webview/main.ts` | `webview/main.ts`（不变） |
| `webview/bridge/bridge.ts` | `runtime/bridge/bridge.ts` |
| `webview/state/state.ts` | `runtime/state/state.ts` |
| `webview/scroll/scroll.ts` | `runtime/scroll/scroll.ts` |
| `webview/menu/menu.ts` | **拆**：结构 → `ui/menu/ContextMenu.tsx`；布局/overlay/测量门面 → `runtime/menu/menu.ts`（`renderContextMenu` 经 main 注册） |
| `webview/render/snapshot.ts`、`rows-click.ts` | `runtime/render/` |
| `webview/render/row-render.ts`、`tool-render.ts` | **拆**：结构组件 → `ui/render/*`；`flagsEqual` / `renderRows` 门面 / 非 JSX → `runtime/render/`（Preact 实现由 main 注册） |
| `webview/stream/stream.ts`、`stream-markdown.ts` | **拆**：壳/相位 UI → `ui/stream/StreamTail.tsx`；增量 DOM / 相位逻辑 → `runtime/stream/` |
| `webview/util/*` | `runtime/util/` |

### 分层规则（验收）

| 规则 | 要求 |
|------|------|
| 扩展名 | `ui/**` 只有 `.tsx`；`runtime/**` 只有 `.ts` |
| 禁止 | 在 `ui/` 写无 JSX 的「假 tsx」堆逻辑；在 `runtime/` 写 JSX 或 `preact.render(<…/>)`；根级散落业务文件（仅允许 `main.ts`）；长期保留 layout 七类**顶层**混放 `.ts`+`.tsx` |
| import | `ui` → `runtime` / `shared`；`runtime` ✗→ `ui/**`（**仅例外** `shared/ui/TrustedHtml`）；`main` → 两侧并 **注册** UI 刷新实现 |
| 装配（P0-3） | `renderRows` / `renderContextMenu` / RD `setDocument` 视图刷新：符号可留在 runtime 门面；Preact 实现只在 `main` 注册；见上「装配契约」 |
| runtime 子目录 | **必须**含 `menu/`、`render/`（及 bridge/state/scroll/stream/util），承接原七类逻辑落点 |
| 菜单 measure（P1-4） | mount 后、对用户可见前完成 measure + `layoutContextMenu`；允许 `useLayoutEffect` 或等价同步回调 |

> 验收：「双包 Preact+TSX」+ **ui/runtime 分离** + **P0-3 装配** + **runtime 含 menu/render** + RD 闭环 + CT 三波 + 流式局部更新（P0-2）+ TrustedHtml 边界 + 菜单 measure 时序。

## 变更点清单

| 区域 | 变更 |
|------|------|
| 依赖/构建 | `preact`；esbuild JSX automatic（`jsxImportSource: 'preact'`）；webview-boot tsconfig |
| 目录 | 建立 `ui/` + `runtime/`（含 menu/render）；**supersede** layout 七类顶层；迁入并分离扩展名 |
| RD | UI → `ui/`；桥/`setDocument` 门面 → `runtime/`；富 HTML + **frontMatterHtml** → TrustedHtml；视图刷新经 main 注册 |
| CT menu/render | 组件 → `ui/…`；门面/逻辑 → `runtime/menu`、`runtime/render`；**main 注册** Preact 实现（P0-3） |
| CT stream | 壳 → `ui/stream`；增量 DOM → `runtime/stream`；遵守 P0-2 所有权 |
| 测试 | 按三列矩阵修订 CT-01/03/06；保留 ASM/CSS/SYNC/桥 case |
| 文档 | README：Preact+TSX + ui/runtime + 装配契约；layout-cleanup 交叉引用一句 |

## 兼容性与迁移

1. **行为**：桥、菜单项、流式 UX、URI、产物名不变。  
2. **顺序**：工具链 → **目录分层（可与 RD 同波）** → RD → CT menu → render → stream → 契约/文档。  
3. **过渡**：允许短时组件与旧字符串并存；每波结束该域不得新增拼串骨架，且不得新增「混目录」文件；过渡期可暂留 layout 七类顶层，**终局必须**落到本 SPEC 树。  
4. **回滚**：revert 本迭代。

## 契约测修订矩阵（意图不变 · P1-1 三列）

> 三列：**必须保留**（符号/意图不可因栈变删）／**可改为 token**（弱匹配 class/id/`data-*`/等价证据）／**允许删除（改断言）**（脆弱整行或已迁入 TSX 的壳函数名）。

### T-BR-CT-01（菜单）

| 必须保留 | 可改为 token | 允许删除（改断言） |
|----------|--------------|-------------------|
| `layoutContextMenu`、`menuOverlayHandler`、`handleMenuOverlayEvent`、`resolveMenuAnchor`、`attachMenuNativeTextBlock`、`menu-open`、`MENU_OPEN_GRACE_MS` | `context-menu`、`menu-backdrop`、稳定 `data-*` / class（结构可由 TSX 产出） | 整段手拼 `html += '…context-menu…'` / 菜单项拼接串；**`document.addEventListener("click", state.menuOverlayHandler, true)`** 整行精确字面（可改为含 `menuOverlayHandler` + `addEventListener` 的弱断言，或等价注册证据） |

**意图**：菜单 overlay / grace / 布局。

### T-BR-CT-03（流式等待 / 增量 / rich）

| 必须保留 | 可改为 token | 允许删除（改断言） |
|----------|--------------|-------------------|
| **函数名**：`appendStreamDeltaIncremental`、`appendStreamDelta`、`ensureStreamTextBody`、`updateStreamBubble`、`applyStreamBatch`、`renderStreamingMarkdown`、`scheduleStreamRichUpgrade`；**相位/DOM 逻辑**：`getStreamTailPhase`、`streamHasContent`、`setStreamToolInvokingDom` | `stream--waiting-first`、`data-text-shell`、`case "streamBatch"`、`waiting-first` / `idle-after-content` 相位证据；rich paint → `applyTrustedHtml` / TrustedHtml | **`renderStreamWaitingFirstRow`、`renderStreamBubbleInner`、`renderAssistantBubbleInner`**（纯返回 HTML 字符串的壳函数——TSX 化后结构在 `ui/stream` / `ui/render`，**允许删符号、改断言为 token**）；`if (!incremental && kind !== "text")` 整行字面；`streamTextBody.insertAdjacentHTML("beforeend", escapeHtml(delta))` 整行字面；`if (state.flags.richText && !html)` / 裸 `body.innerHTML = html` 等脆弱拼串 |

**定案（壳函数）**：`renderStream*` / `renderAssistantBubbleInner` 等 **HTML 壳拼接函数**在 TSX 化后 **可删**；相位判定与增量写入函数（上表「必须保留」列）**不可因壳迁 TSX 而删**。

**意图**：等待首包 / 增量 / rich+noHtml。

### T-BR-CT-06（文本壳 / fill-width）

| 必须保留 | 可改为 token | 允许删除（改断言） |
|----------|--------------|-------------------|
| （意图级）文本壳与 fill-width 行为仍可检；若仍导出则保留相关 runtime 辅助名 | `data-text-shell`、`bubble--fill-width`、`hasThinking` / `hasTools` 等稳定 token；壳可由 TSX 产出 | `` html += '<div class="bubble-body' + richShellBubble + '" data-text-shell="1"></div>'; `` **整行**；`const richShellBubble = state.flags.richText && textHtml ? " rich" : ""` **整行**；`const showIdleBar = getStreamTailPhase() === "idle-after-content"` **整行**（`getStreamTailPhase` 本身属 CT-03 必须保留；此赋值字面可删） |

**意图**：文本壳 / fill-width；**禁止**删意图。

### 其它 Case（摘要）

| Case | 必须保留 | 可改为 token | 允许删除（改断言） |
|------|----------|--------------|-------------------|
| **T-BR-CT-04** | `streamCommit`、`applyStreamCommit`、`promoteStreamTailToRow` | — | — |
| RD 富注入 | `setDocument`（门面符号可留 runtime） | `doc-body` / `rich` / TrustedHtml（含 **frontMatterHtml**） | `'<div class="doc-body rich">'+` 手拼整段 |
| 桥 / 生命周期 | `bootTranscript` / `post("ready"` / `setDocument` / case 名 | — | — |
| shell + CSS | shell id + classic script + CSS padding | — | — |
| SYNC | `var NAME = N`（依赖 minify:false） | — | — |

**禁止**：删 waiting-first / streamCommit / 菜单 grace / **`appendStreamDeltaIncremental`** / `getStreamTailPhase` / `streamHasContent` / `setStreamToolInvokingDom` 等意图却声称「栈变了」；为绿测而开 minify。

## 详细实现步骤

- Step 1 — phase-toolchain — blocking: yes — qa: auto：加 `preact`；`build-webview.mjs` 钉 `jsx: 'automatic'` + `jsxImportSource: 'preact'`；`tsconfig.webview-boot` 支持 tsx；冒烟空组件可打进 IIFE。  
- Step 2 — phase-ui-runtime-layout — blocking: yes — qa: auto：双包建立 `ui/` + `runtime/`（CT `runtime` **含 menu/render**）；按映射表迁入；修正 import；保证 `runtime` 仅例外 import TrustedHtml；**预留 register 钩子**（P0-3）；`build:webview` 绿。  
- Step 3 — phase-rd-preact — blocking: yes — qa: auto：RD `ui/DocumentApp.tsx` + TrustedHtml（**含 frontMatterHtml**）；`main` 注册视图刷新；runtime `setDocument` 门面；行为：富/纯/过限；修订 RD boot-script。  
- Step 4 — phase-ct-menu — blocking: yes — qa: auto：`ui/menu` TSX + `runtime/menu` 门面；`main` 注册 `renderContextMenu`；**P1-4**：mount 后、对用户可见前完成 measure + `layoutContextMenu`（允许 `useLayoutEffect` 或等价同步回调）；CT-01 三列意图绿。  
- Step 5 — phase-ct-render — blocking: yes — qa: auto：`ui/render` + `runtime/render` 门面；`main` 注册 `renderRows`；去掉该域拼串主路径；消毒 HTML 经 TrustedHtml。  
- Step 6 — phase-ct-stream — blocking: yes — qa: auto：`ui/stream` 壳；`runtime/stream` 保增量 DOM；遵守 P0-2；壳函数可按三列删改断言；修订 CT-03/04/06。  
- Step 7 — phase-contract-matrix — blocking: yes — qa: auto：三列矩阵落地；契约意图全绿；`minify:false` 仍在。  
- Step 8 — phase-docs — blocking: yes — qa: auto：README（Preact + ui/runtime + 装配）；layout-cleanup 交叉引用（若尚未加）。  
- Step 9 — phase-device-qa — blocking: no — qa: manual_user：Android+iOS 聊天流式/菜单 + 文档预览。

## 测试策略

- **自动**：`build:webview`；boot-script（修订后）；路径/分层抽检；相关回归。  
- **手工**：Step 9。

### 测试用例

| ID | Step | blocking | 说明 |
|----|------|----------|------|
| T-PH-01 | 1 | yes | 双包 build 含 preact；仍 IIFE + classic + minify:false |
| T-PH-02 | 2 | yes | 存在 `ui/`+`runtime/`；`runtime` 含 `menu/`+`render/`；`ui` 无 `.ts` 业务文件；`runtime` 无 `.tsx`；runtime ✗import ui（TrustedHtml 例外除外）；**无** runtime 内 `preact.render(<…/>)` |
| T-PH-03 | 3 | yes | RD 富/纯/过限；TrustedHtml 边界可检（含 frontMatterHtml）；`setDocument` 门面 + main 注册视图刷新 |
| T-PH-04 | 4 | yes | 菜单在 `ui/menu` + `runtime/menu`；main 注册 `renderContextMenu`；**P1-4** measure 在可见前完成；布局/关闭意图绿 |
| T-PH-05 | 5 | yes | 行/工具在 `ui/render` + `runtime/render`；main 注册 `renderRows`；无新增拼串骨架主路径 |
| T-PH-06 | 6 | yes | 流式增量在 `runtime/stream`；壳在 `ui/stream`；P0-2 所有权与全量/增量边界可检；`appendStreamDeltaIncremental` 仍在 |
| T-PH-07 | 7 | yes | CT/RD 契约意图绿；**三列矩阵**已更新 |
| T-PH-08 | 1–8 | yes | 无 RN 进 web；无 htm 主路径；无 barrel；P0-3 装配可检；不再以 T-WL-07 七类顶层为验收 |
| T-PH-09 | 9 | no | 真机双 WebView smoke |

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 分层搬家漏改 import / 漏 `runtime/menu|render` | Step 2 立刻 build；T-PH-02 |
| runtime 直接 import ui / 内嵌 preact.render | P0-3 装配契约；T-PH-02 / T-PH-08；CR 拒收 |
| 契约测整段拼串假红 | 三列矩阵修订；意图句优先；保留关键符号 |
| 流式闪烁 / 壳 remount 毁掉 body | Step 6 强制 P0-2；真机验收 |
| 菜单闪一下再定位 | P1-4：可见前 measure + layoutContextMenu |
| RN/Preact 双 JSX | webview-boot 独立 jsx |
| 体积增大 | 接受；禁 minify |
| 与 layout T-WL-07 验收冲突 | 明文 supersede；layout-cleanup 交叉引用 |

**回滚**：git revert；临时恢复字符串渲染模块。
