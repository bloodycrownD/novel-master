---
date: 2026-07-17
dependency:
  - Iterations/mobile-webview-chat-transcript/prd.md
  - Iterations/mobile-vfs-markdown-webview/prd.md
---

# Mobile WebView Boot 资源化与源码拆分 PRD

> **平台**：Mobile（Android + iOS）  
> **性质**：工程可维护性；用户可见行为不变（聊天 Transcript / VFS Markdown 富文档 WebView）  
> **定案摘要**：两套 WebView（chat-transcript + rich-document）的 boot/HTML/CSS 以独立源文件为编辑面；构建期组装为**真实 `.html` 文件**；禁止巨型 TS 字符串内嵌作为交付主路径；拆解过长入口脚本便于维护。

## 背景

聊天 Transcript 与 VFS Markdown 预览均使用 RN WebView。早期将整页 HTML/JS 嵌在 TS template 中，带来：无原生高亮/eslint、正则双转义、难拆分、常量易漂移。资源化一期已将真源迁出为 `shell/` + `boot/*.js`，但组装结果仍写入 `*.generated.ts` 巨型字符串——**编辑面干净、交付面仍内嵌**，与「不要内嵌 HTML/JS」的目标不一致。

前置迭代预留了改原生 asset / `uri` 的逃生口。本期修正：组装产物必须是真实 HTML 文件；运行时可由打包导入为字符串再 `source={{ html }}`，或直接 `uri` 加载——**以去掉巨型 generated TS 为准**，不再把「加载 API 一字不改」当作硬约束。

## 目标（含成功指标）

1. **可维护**：boot / 壳 HTML / CSS 以独立 `.js` / `.html` / `.css` 为编辑面。
2. **交付干净**：组装产物为真实 `.html`（或等价静态资源）；仓库与生产路径**禁止**以巨型 `*.generated.ts` template 作为 HTML 主交付。
3. **行为不变**：Transcript / RichDocument 展示、流式、菜单、桥、主题、滚动语义无回归。
4. **双端同管线**：chat-transcript 与 rich-document 共用组装与交付约定。

**成功指标**

- 生产路径不再依赖「TS 内嵌整页 HTML」或「手写 IIFE template」。
- 契约单测仍绿（可改为读 `.html` / 组装产物）。
- 真机：会话聊天 + VFS Markdown 预览核心交互可用。

## 用户与场景

| 角色 | 场景 |
|------|------|
| 开发者 | 改渲染/菜单/流式时编辑独立源文件；审查组装结果时打开 `.html` 而非巨型 TS。 |
| 终端用户 | 无感知；行为与改前一致。 |

## 范围

### 包含范围

1. **chat-transcript / rich-document**：独立源文件 + 构建期组装为真实 HTML 交付。
2. **去掉巨型 `*.generated.ts` HTML 交付**（或降为薄封装且内容不再内嵌整页）。
3. **共享常量单源**；清理双源陈旧文件。
4. **测试 / CI**：组装可重复；契约测适配新交付形态。
5. **boot 职责拆分**（已部分完成；禁止再堆单文件巨石）。

### 不包含范围

1. 重做桥协议或产品交互（菜单项、流式 UX 等）——除非拆分时顺手修明确 bug。
2. Desktop Electron 聊天列表。
3. `stream-display-rewrite` 删除 WebView 主路径。

## 核心需求（3–7 条）

1. **独立源文件**：boot、壳、样式不以 TS template 为主源。
2. **真实 HTML 交付**：assemble 写出 `.html`（提交入库或等价门禁）；禁止巨型 TS 字符串作为 HTML 主产物。
3. **加载可用**：WebView 能稳定加载组装页（`html` 字符串导入或 `uri` / asset，由 SPEC 定案一种主路径）。
4. **双 WebView 同管线**。
5. **拆分可维护单元**：按职责拆 boot；禁止巨石回潮。
6. **契约可回归** + **无用户可见回归**。

## 验收标准

- [ ] 主逻辑位于独立源文件；组装结果可在仓库中以 `.html` 审阅。
- [ ] 不存在作为主交付的巨型 `transcript-html.generated.ts` / `document-html.generated.ts` 整页内嵌。
- [ ] 会话聊天 WebView：列表、流式、长按菜单可用，无「永不 ready」。
- [ ] 富文档 WebView：内容与主题/交互可用。
- [ ] 相关单测全绿；桥约定未无故破坏。

## 约束与依赖

- 硬依赖：[`mobile-webview-chat-transcript`](../mobile-webview-chat-transcript/prd.md)、[`mobile-vfs-markdown-webview`](../mobile-vfs-markdown-webview/prd.md)。
- 组装与加载细节见 SPEC（Node assemble、产物路径、Metro/Jest 如何消费 `.html`）。

## 风险与待确认项（SPEC 收口）

- Metro / Jest 对 `.html` 导入或 `uri` 加载的落地方式（主路径唯一定案）。
- Android / iOS 对 `baseUrl`、本地资源路径的差异。
