# Mobile 工作区 Markdown 预览（WebView 引擎）PRD

> **平台**：Android + iOS  
> **上游**：[`mobile-webview-chat-transcript`](../mobile-webview-chat-transcript/prd.md)（聊天 transcript 已 WebView 化并默认启用）、[`chat-rich-render`](../chat-rich-render/prd.md)（`.md` 预览始终 Markdown）  
> **组织方式**：`FileEditorScreen` **编辑模式** 仍为 RN `TextInput`；**预览模式** 正文由 **WebView** 渲染，Front Matter 卡片仍由 RN 展示。

## 背景

聊天 transcript 改用单 WebView 后，滚动与富文本（列表、代码块、流式 HTML）体验明显优于 RN `react-native-render-html` + FlatList 组合。

工作区 **`.md` / `.markdown` 预览**（`FileMarkdownPreview`）当前仍用 `RichContentBody`（RenderHTML）渲染正文：

- 与聊天 WebView 路径 **样式与能力分叉**（列表缩进、表格、CSS 等需维护两套）
- 长文预览时 RenderHTML 测高与 RN ScrollView 嵌套，在真机上偶发卡顿
- 已有 `prepareTranscriptRichHtml` + Web transcript CSS，但未复用到文件预览

**决策（2026-06）**：将 **文件预览正文** 迁至 WebView，复用聊天侧 sanitize + rich CSS；Front Matter 结构化卡片保留 RN。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 预览体验 | 真机打开 `.md` 预览，滚动与排版 **不低于** 当前 RenderHTML；长文（≥ 8k 字）无明显卡顿 |
| 样式一致 | 与聊天 WebView 富文本 **同一套** 列表/代码块/引用/链接样式（共用 CSS 或共享模块） |
| 行为不退化 | Front Matter 卡片、无效 FM 提示、非 `.md` 纯文本、编辑↔预览切换 **与现网一致** |
| 安全 | 正文 HTML 仍经 **sanitize**；无 script/iframe 等可执行内容 |
| 可回滚 | Feature flag 可切回 `RichContentBody` 预览（至少保留一版至稳定） |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 工作区写作用户 | 在 `FileEditorScreen` 编辑 `.md`，点「预览」查看排版效果 |
| 长文笔记用户 | 打开含列表、代码块、表格的 Markdown，滚动阅读 |
| 调试用户 | 预览与聊天助手富文本样式一致，减少「两处长得不一样」的困惑 |

## 范围

### 包含

- 新建 **`RichDocumentWebView`**（或等价）及 Web bundle：`apps/mobile/src/web/rich-document/`
- **`FileMarkdownPreview`**：Front Matter 仍 RN；**正文** 改 WebView（或整页预览区一个 WebView，FM 在 WebView 上方 RN 区域）
- 复用 **`prepareTranscriptRichHtml`**（或抽共享 `prepareRichDocumentHtml`）+ **`sanitizeRichHtml`**
- 主题 token 注入（背景、文字、链接色与 `ThemeProvider` 一致）
- RN↔Web 轻量桥：`init`（theme）+ `setDocument`（html / plain fallback）+ `ready`
- Feature flag：`vfsMarkdownPreviewEngine: 'rn' | 'webview'`（KKV），默认 **webview**
- **预览渲染切换**（仅 `.md` / `.markdown` 且处于预览模式）：分段控件 **Markdown** vs **文本**
  - **Markdown**：现有 WebView 富文本渲染（或 flag `rn` 时 `RichContentBody`）
  - **文本**：完整源文 monospace（含 Front Matter），不经 Markdown 管线
- 单测 + 真机验收清单（Android 优先）

### 不包含

- 文件 **编辑** 模式（仍为 `TextInput`）
- **Real Prompt 预览**、Tool 结果页、其他 VFS 阅读入口（本期仅 `FileEditorScreen` 预览路径；后续可复用组件）
- 删除 `RichContentBody`（legacy 聊天 `MessageList` 回滚路径仍可能需要）
- Web 内编辑、双向同步、协同编辑
- 将 Front Matter 移入 WebView（保持 RN 卡片便于结构化展示与错误态）

## 核心需求

1. **预览正文 WebView 化**：`.md` 闭合 Front Matter 后的正文，经 Markdown→sanitize→HTML 注入 WebView。
2. **超长回退**：超过 `RICH_CONTENT_MAX_CHARS` 时与现网一致：显示 plain 原文 + 「内容过长，已显示原文」提示（可在 RN 层或 Web 层，行为一致）。
3. **主题同步**：切换深色/浅色或进入预览时，WebView 收到 `themeUpdate`，背景与文字色正确。
4. **编辑↔预览**：从编辑切到预览时 WebView 展示 **当前编辑器 buffer**（含未保存内容）；不要求 WebView 在编辑模式常驻。
5. **单 WebView 原则**：预览屏 **至多一个** WebView（与 chat-transcript 一致）；禁止 ScrollView 内嵌多个 WebView。
6. **复用富文本 CSS**：列表缩进、代码块、blockquote 等与 [`transcript-html.ts`](../../../../apps/mobile/src/web/chat-transcript/transcript-html.ts) 对齐，抽共享样式模块避免双份维护。
7. **可回滚 flag**：KKV `vfsMarkdownPreviewEngine=rn` 恢复 `RichContentBody` 路径。
8. **预览 Markdown / 文本切换**：`.md` 预览模式下提供分段控件；**文本** 显示完整 buffer 原文（含 `---` FM），**Markdown** 走现有预览管线。

## 验收标准

### 功能

- **T1** 打开 `.md` 文件 → 预览：Front Matter 卡片正常；正文 Markdown（标题、列表、粗体、链接）正确渲染。
- **T2** 列表序号/项目符号 **不超出** 内容区左边界（与聊天气泡修复一致）。
- **T3** 含 `<script>`、`<iframe>` 的 md/html 片段预览后 **不可执行**，危险标签被剥离。
- **T4** 非 `.md` 路径：预览仍为 **纯文本** monospace（与现网一致）。
- **T5** Front Matter 未闭合：仍显示 RN 错误提示，**不**渲染 Web 正文。
- **T6** 编辑中有未保存修改 → 切预览：展示 **当前 buffer**，非仅磁盘已保存内容。
- **T7** 内容 &gt; 12k 字符：plain 回退 + 提示文案与现网一致。
- **T8** 切换系统/应用主题后重新进入预览：WebView  colors 与 RN 主题一致。

### 性能与体验

- **T9** 8k–12k 字 Markdown 预览：滚动 **无明显掉帧**（主观 + 与当前 RenderHTML 对比不退化）。
- **T10** 编辑↔预览切换 **&lt; 500ms** 可见正文（冷启动 WebView 除外，可接受首次稍慢）。

### 回滚

- **T11** KKV 设 `vfsMarkdownPreviewEngine=rn` 后，预览走 `RichContentBody`，App 正常启动。
- **T12** `.md` 预览：切 **文本** 显示完整源文（含 Front Matter）monospace；切 **Markdown** 显示渲染预览（WebView 或 RN 富文本，依 flag）。

## 约束与依赖

- 依赖 `react-native-webview`（已引入）
- 依赖 `@novel-master/core` 的 `splitMarkdownFrontMatter`
- 不新增 native 模块

## 风险与待确认项

| 风险 | 缓解 |
|------|------|
| 预览页 RN ScrollView + WebView 嵌套高度 | 优先 **flex:1 单 WebView** 占满预览区；FM 在 WebView 外 RN 列布局 |
| 双 WebView 内存（聊天页 + 文件页） | 不同路由，非同时全屏；可接受 |
| CSS 分叉 | M0 抽 `rich-content-styles.css.ts` 共享 |

## 里程碑（可选）

| 阶段 | 内容 |
|------|------|
| M0 | 共享 rich CSS + `RichDocumentWebView` POC + flag |
| M1 | 接入 `FileMarkdownPreview` / `FileEditorScreen`，单测 |
| M2 | 真机 T1–T11，默认 webview，文档更新 |

---

**请确认本 PRD**。确认后可进入 [`spec.md`](./spec.md) 评审与 `/subagent-inline-loop` 实现。
