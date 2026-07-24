---
date: 2026-07-24
updated: 2026-07-24
---

# annotate-source-anchor-render 技术规格（SPEC）

> **修订说明（2026-07-24）**：废弃「`buildAnnotatedSource` 往 MD/plain 源串插 HTML 锚再渲染」。预览唯一方案改为 **`@recogito/text-annotator` + 仅 Markdown Tab**。下文为当前唯一事实来源。

## 设计目标

1. Markdown 预览：干净 MD → HTML 后，用 Recogito 做划词、高亮、点选。  
2. **文本（plain）Tab：禁用批注**（无入口、无投影）。  
3. 草稿携带 Recogito 渲染坐标，供再次打开 MD 预览时重投影。  
4. **禁止**预览主路径 fallback：源串插锚、搜字 apply、Custom Highlight 应急开关。  
5. 磁盘源文件永不写入批注标签。

## 钉死决策

| ID | 决策 |
|----|------|
| R1 | **预览引擎唯一**：`@recogito/text-annotator`（`createTextAnnotator`）。Mobile 在 rich-document **WebView 文档内**初始化；Desktop 在 MD 预览内容根节点初始化。 |
| R2 | **仅 Markdown**：仅 MD Tab（或等价 MD 预览）允许创建/投影批注。plain/文本 Tab **不得**出现「添加批注」、不得挂 Recogito、不得对既有草稿画高亮。 |
| R3 | **干净渲染**：MD 输入为 VFS 无锚原文（body）；`prepareTranscriptRichHtml` / `react-markdown` 等管道 **不得**先注入批注 HTML。 |
| R4 | **草稿位置权威**：相对 **MD 渲染后、Recogito 所挂容器的可见正文** 的半开 `[start, end)` + `quote`（即 Recogito `target.selector`）。写入 `AnnotateDraft`（字段名见下）；**不再**以 VFS soft offset 作为预览投影权威。 |
| R5 | **无 fallback**：删除或永久关闭预览主路径上的 `buildAnnotatedSource` 注锚接线、`applyAnnotateMarks`/`applyAnnotateHighlights`、`setAnnotations` 搜字链、`NM_ANNOTATE_DOM_SEARCH_FALLBACK` / `setPreviewAnnotateDomSearchFallbackForTests` 等应急开关（测试亦不得依赖其开）。Core 中 `buildAnnotatedSource` 可暂留文件但宿主预览 **禁止调用**。 |
| R6 | **点击/创建**：新建：RN 原生选区菜单「复制 / 批注」→ inject 量测 `.doc-body` 半开 offset → `recogitoCreate` → 写草稿 + chip。Recogito **`annotatingEnabled: false`**，禁止划词即 createAnnotation（避免选区变蓝、吞菜单）。已有批注：`selectionChanged` → 打开既有详情。 |
| R7 | **发送附件**：至少 `path` + `originalText`（= quote）+ `userAnnotation`；渲染坐标字段有则写出（便于调试/日后），模型侧以引文为主。 |
| R8 | **存量**：仅有旧 VFS offset、无 Recogito 坐标的草稿：MD 预览 **可不投影高亮**，chip/详情/发送仍可用（A12 底线）。 |
| R9 | **双端**：Desktop / Mobile 同一合同；Primary 手测宿主 = Mobile。 |

## 草稿字段（schema）

在既有 `AnnotateDraft` 上：

| 字段 | 要求 |
|------|------|
| `id` / `path` / `originalText` / `userAnnotation` | 保留；`originalText` = Recogito quote |
| `renderStart` / `renderEnd` | **新稿必写**；非负整数；半开 `[renderStart, renderEnd)`；相对 Recogito 容器正文（UTF-16，与库 selector 一致） |
| `startOffset` / `endOffset` / 行列 | **不再作为预览投影权威**；新稿可不写；旧稿可读忽略 |

XML build/parse：有 `renderStart`/`renderEnd` 则对称读写。public 导出与 allowlist 更新。

## 宿主接线

### Mobile（Primary）

1. MD 预览：`setDocument` 仅干净 HTML（现有 `prepareTranscriptRichHtml`）。  
2. WebView bundle 引入 `@recogito/text-annotator` + CSS；在 `.doc-body`（或约定根）上 `createTextAnnotator`。  
3. `createAnnotation` → bridge → RN：`addChatAnnotateDraft`（quote + renderStart/End + path…）→ `refreshComposerAnnotateChips`。  
4. 加载/变更草稿 → `setAnnotations` 映射为 Recogito 注解列表。  
5. plain Tab：去掉批注 menu / collect；不创建 annotator。  
6. 销毁 WebView / 切走时 `destroy()`。

### Desktop

1. MD `PreviewPane`：干净 `react-markdown`（**不再**为批注强制 rehype-raw 注锚串）。  
2. 内容根挂 Recogito；事件接入既有草稿 store。  
3. 文本 Tab：禁用批注入口与投影。

## 详细实现步骤

- Step 1 — phase-schema-render-range — blocking: yes — qa: auto：schema/Dto/XML 增加 `renderStart`/`renderEnd`；注释钉死「MD 渲染正文坐标系」；旧 offset 不删读路径但非投影权威（T-RG1）。  
- Step 2 — phase-retire-inject-preview — blocking: yes — qa: auto：宿主 MD/plain 预览路径移除 `buildAnnotatedSource` 注锚调用与搜字 apply / fallback 开关主路径（T-RG2）。  
- Step 3 — phase-mobile-recogito-md — blocking: yes — qa: auto：Mobile WebView 接入 Recogito；仅 MD；划词→草稿→chip；重开投影；plain 无批注（T-RG3、T-RG4、T-RG5）。  
- Step 4 — phase-desktop-recogito-md — blocking: yes — qa: auto：Desktop MD 对齐 Recogito；plain 禁用批注（T-RG6）。  
- Step 5 — phase-manual — blocking: no — qa: manual_user：真机 MD 划词、重开投影、标题不被破坏、plain 无入口。

## 测试策略

| 层 | 宿主 |
|----|------|
| schema / XML | `packages/core/test` |
| 宿主接线 / 禁 plain / 无插锚调用 | Mobile `__tests__`、Desktop `test` |
| T-RG* manual | 用户真机 |

### 测试用例

- T-RG1 — blocking: yes — schema 接受 `renderStart`/`renderEnd` 半开；非法拒绝；XML round-trip；缺省旧草稿仍合法。  
- T-RG2 — blocking: yes — MD 预览源码路径断言：不调用 `buildAnnotatedSource` 生成预览 HTML；无默认 DOM 搜字 apply / fallback 开。  
- T-RG3 — blocking: yes — Mobile：MD 路径存在 Recogito 初始化（`createTextAnnotator`）与草稿↔`setAnnotations` 映射。  
- T-RG4 — blocking: yes — Mobile：plain 路径无批注菜单/collect/Recogito。  
- T-RG5 — blocking: yes — 映射：Recogito annotation ↔ draft 的 quote/`renderStart`/`renderEnd` 字段一致（单测）。  
- T-RG6 — blocking: yes — Desktop MD 接入 Recogito；plain 禁用批注（源码/测例断言）。  
- T-RG7 — blocking: no — 真机：MD 批注不破坏标题；重开可投影；plain 无入口。

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| WebView 未打进 Recogito | build:webview 纳入依赖；启动测 T-RG3 |
| 渲染管道变更致坐标漂移 | v1 接受；文档注明 |
| 旧插锚代码残留 | Step 2 清单清理；T-RG2 |

**回滚**：git revert 本修订相关提交；临时恢复旧预览不在 v1 范围。

## Context Bundle

```yaml
iteration_name: annotate-source-anchor-render
requirement_path: Iterations/annotate-source-anchor-render/prd.md
spec_path: Iterations/annotate-source-anchor-render/spec.md
explore_summary: |
  用户确认：禁用文本 Tab 批注；仅 Markdown；预览唯一用 @recogito/text-annotator；
  草稿存 Recogito 渲染坐标以重投影；废除源串插锚与 fallback。
constraints:
  - Recogito only preview
  - MD only annotate
  - no inject-anchor preview
  - no DOM-search fallback switches
blocking_steps: [1, 2, 3, 4]
```
