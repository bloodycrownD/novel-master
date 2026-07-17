---
date: 2026-07-17
dependency:
  - Iterations/mobile-webview-boot-bundler/prd.md
---

# Mobile WebView 真源与 Host 分区 PRD

> **平台**：Mobile（Android + iOS）  
> **性质**：工程可维护性；终端用户可见行为不变  
> **定案摘要**：将 **RN 宿主胶水**（URI、包根纯函数）从 `apps/mobile/src/web/` **整棵迁出**到独立 `webview-host` 树；`src/web/` 仅保留 **可进 esbuild 的 WebView 真源**（两包 + shared）。加载媒介、产物路径、桥协议、用户可见交互均不变。

## 背景

父迭代 [`mobile-webview-boot-bundler`](../../prd.md) 已落地：esbuild 双入口、`source.uri`、原生 assets/bundle、契约测读 dist。真源仍混放两类模块：

- **WebView boot**：`{pkg}/src/**`、短 `index.html`、styles — 进 IIFE；
- **RN host**：包根 `uri.ts` / `scroll.ts` / guards、以及挂在 `src/web/webview-asset-uri.ts` 的平台 URI（依赖 `react-native`）— 进 Metro。

同名文件（如双份 `scroll.ts`）与「web 根下却是 RN」的摆放，使开发者难以一眼区分边界。本期只清目录心智，不改运行时契约。

## 目标（含成功指标）

1. **边界可读**：打开 `src/web/` 不应再遇到 `react-native` 依赖；RN 加载与可测纯函数集中在 `webview-host`。  
2. **两包对称**：chat-transcript / rich-document 在 web 侧结构对称（`webview/` 真源 + 壳）；chat-transcript boot **按职责分子目录**可读，且 **禁止** 子目录 `index.ts` barrel；host 侧按包对称。  
3. **行为零回归**：URI 字符串、产物布局、WebView 加载与桥语义相对 bundler 基线不变。  
4. **开发路径可跟**：README / 文档中的真源路径与终局树一致；`build:webview` 与相关测仍绿。

**成功指标**

- `src/web/**` 无对 `react-native` / `react-native-blob-util` 的直接依赖。  
- 新人能从目录区分「改 boot」vs「改宿主 URI/纯函数」；改 CT boot 时能从子目录定位 menu/stream/render。  
- 终端用户：聊天 Transcript + Markdown 预览核心交互无回归（相对合并前）。  
- 自动门禁：`build:webview` + 既有 WebView 相关 Jest 意图保持通过。

## 用户与场景

| 角色 | 场景 |
|------|------|
| 开发者 | 改 WebView 页面逻辑时只进 `src/web/`；改加载 URI / RN 侧纯函数时只进 `webview-host`。 |
| 终端用户 | 无感知。 |

## 范围

### 包含范围

1. 将 `webview-asset-uri`、两包 `uri.ts`、chat-transcript 包根纯函数（`scroll` / `menu-overlay-guards` / `stream-tail-html-state` 等）迁入 **`apps/mobile/src/webview-host/`**（目录名以 SPEC 终局树为准）。  
2. `src/web/` 内将原 `{pkg}/src` 真源收拢为明确的 **`webview/`** 子树；**chat-transcript 的 `webview/` 再按职责分子目录**（`bridge` / `state` / `scroll` / `menu` / `stream` / `render` / `util`，非独立 npm 包），且 **禁止** 子目录使用 `index.ts` barrel（跨模块显式文件路径）；保留 `shared/`、短 HTML、styles。`rich-document` 不强制对称硬拆。  
3. 更新 RN 组件、Jest、构建入口、boot tsconfig、README 路径说明。  
4. 删除不再需要的兼容 shim（如根级 `rich-content-styles` re-export），测试改指 `shared/`。

### 不包含范围

1. 改桥协议、菜单集合、流式产品 UX、URI 定案串、原生落点路径语义。  
2. 改 esbuild 产物文件名 / `minify` / IIFE 策略（沿用 bundler）。  
3. **强制消双份实现**（boot DOM `scroll` vs host 数值 `scroll`；decode 双份等）——本期默认 **只搬家**；消双份可另开。  
4. Desktop；强制拆 npm workspace 包。  
5. 真机以外的产品功能新增。

## 核心需求（3–7 条）

1. **`src/web/` = 仅 Web 真源**：两包 webview 真源 + shared；无 RN 运行时依赖。  
2. **`webview-host/` = RN 宿主胶水**：平台 URI + 原包根可测纯函数 + 薄包级 uri API。  
3. **构建仍只打包 web 真源**：入口路径随搬家更新；产物与原生拷贝语义不变。  
4. **消费方 import 更新**：WebView 组件、相关单测指向新 host 路径。  
5. **文档树与 README 对齐终局结构**。

## 验收标准

- [ ] Given 仓库终局树，When 检视 `src/web/**` 的依赖，Then 无 `react-native` / `react-native-blob-util` 直接引用。  
- [ ] Given 更新后的构建脚本，When 执行 `build:webview`，Then 仍产出两套 `webview-dist/{pkg}/{index.html,app.js,app.css}`。  
- [ ] Given URI / boot / rich-styles 等既有相关 Jest，When pretest 构建后跑测，Then 意图保持通过（路径已改仍绿）。  
- [ ] Given `ChatTranscriptWebView` / `RichDocumentWebView`，When 静态检视，Then 仍 `source.uri` + 既有必配读权 props；URI 来自 host 模块。  
- [ ] Given README「最短开发路径」，When 对照终局树，Then 真源路径描述与目录一致，且仍写明仅 `npm start` 不足以更新真机 WebView。  
- [ ] Given 合并后真机（可选手工），When 聊天列表/流式/菜单 + Markdown 预览，Then 无「永不 ready」类回归。

## 约束与依赖

- **硬依赖**：[`mobile-webview-boot-bundler`](../../prd.md) 终局（产物、URI 语义、IIFE、gitignore）。  
- 不以 boot-resources 的 `shell/`/`boot/`/`assembled.html` 为布局基线。

## 风险与待确认项

- 包根纯函数与 boot 同名逻辑（如 `scroll`）本期 **只搬家不合并**；是否另开「消双份」待确认。  
- `webview-host` 顶层命名（`webview-host` vs `native/webview-host`）由 SPEC 钉死一版。  
- 全量 `npm run lint` 环境缺插件等与本期无关的基建问题不阻塞本 PRD。
