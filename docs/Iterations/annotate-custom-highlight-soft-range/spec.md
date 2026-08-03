---
date: 2026-07-24
---

# annotate-custom-highlight-soft-range 技术规格（SPEC）

## 设计目标

落实 `Iterations/annotate-custom-highlight-soft-range/prd.md`：

1. 预览高亮主路径改为 **CSS Custom Highlight**（`Range` + `CSS.highlights` + `::highlight()`）；不支持时 **mark 回退**。  
2. **宽松起止行列**（optional）写入草稿与批注附件；预览匹配优先窗口内原文；模型/search 可读同一窗口。  
3. 文本 / Markdown 预览共用同一采集与 apply 抽象（feature detect 后走 Highlight 或 mark）。  
4. 保留点高亮打开；存量无行列批注行为 ≥ 现网。  
5. 本迭代**废止**旧合同中「本期不做 Custom Highlight / 不改落库锚点」对预览层的限制（以本 SPEC 为准）。

需求来源：`Iterations/annotate-custom-highlight-soft-range/prd.md`  
前置：`annotate-user-ops-unify`、`annotate-cross-node-highlight`、`annotate-workplace-ux-fix`

## 总体方案

### 钉死决策

| ID | 决策 |
|----|------|
| H1 | **探测**：`typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function'` 为真 → 主路径 Custom Highlight；否则 mark 回退。Desktop Electron 35+ 预期走主路径；Mobile WebView **必须**探测。 |
| H2 | **绘制**：主路径用选区/匹配得到的一个或多个 `Range` 注册到命名 Highlight（如 `nm-annotate`）；样式用 `::highlight(nm-annotate)`（underline）。**不**再为高亮插入 `<mark>`（回退路径除外）。 |
| H3 | **回退**：沿用（可简化的）多段 `<mark class="annotate-mark|preview-annotate-mark" data-annotate-ids>` + 现有 CSS；点击仍 `closest(mark)`。 |
| H4 | **点击（主路径）**：优先 `CSS.highlights` / `highlightsFromPoint`（若可用）；否则 `caretRangeFromPoint` / `caretPositionFromPoint` 得到 Range，与已注册 annotate Ranges 求交，解析到 draft ids。失败则无打开，不崩溃。 |
| H5 | **匹配顺序**：若草稿有有效宽松行列 → 在源文件（推荐）对应窗口内对 `originalText` 做归一后搜索，命中后再映射到当前预览 DOM Ranges；窗口内失败 → 略扩大窗口一次 → 再失败 → 全文原文匹配（现网行为）。无行列 → 直接全文原文匹配。 |
| H6 | **行列字段**（1-based，闭区间语义由实现注释钉死）：optional `startLine`/`endLine`，optional `startCol`/`endCol`；允许只存行、列缺省表示整行；窗口可大于真实选区（采集时加 padding，默认 ±2 行，可配置常量）。 |
| H7 | **坐标系**：采集与落库以**磁盘源文件**行列为准（plain 易算；MD 用选区原文在源中定位 + 窗口放大，不要求 DOM 行=源行）。 |
| H8 | **Schema**：`annotateDraftSchema` **保留 `.strict()`**，显式增加上述 optional 数字字段；`AnnotateDraftDto`、IPC 对齐。 |
| H9 | **落库**：`buildFileAnnotateAttachmentFromDraft` **显式**把行列写入 XML JSON；`parseAnnotateDraftsFromAttachments` **对称**读回；缺字段旧附件兼容。 |
| H10 | **Chip**：仍按 path 聚合一只，**不改**。 |
| H11 | **文本/MD 同路**：同一 `applyAnnotate*` 入口；输入为「当前预览根 DOM + drafts（含 optional 行列）+ 源文件文本（用于窗口）」；禁止文本模式另写一套匹配器。 |
| H12 | **Needle 归一**：为文本多行命中，**撤销或收窄**「全局删除所有 `\n`」——至少对 plain/`pre` 域保留换行匹配；跨格表选区的分隔策略在窗口内单独处理，避免再次误伤文本预览。 |
| H13 | **表连续观感**：尽力保留；与 H12 冲突时优先跨节点 + 文本预览，表项降为同迭代尽力或 follow-up。 |

### 架构概览

```text
划词选区
  → originalText + 估算宽松行列（源文件）
  → AnnotateDraft store
  → chip（path） / 发送 XML（含 optional 行列）
预览刷新
  → feature detect
  → 窗口内/全文 匹配 originalText → DOM Range[]
  → Highlight 注册 或 mark wrap
  → 点击 → ids → 打开草稿
```

## 最终项目结构

```text
packages/core/src/domain/chat/model/
  annotate-draft.schema.ts          # + optional 行列
packages/core/src/domain/chat/logic/
  annotate-highlight.ts             # 窗口匹配；needle 策略调整
  annotate-source-range.ts          # 新增：选区/原文 → 宽松行列；窗口裁剪源文本
  build-attachment-action-xml.ts    # build/parse 显式行列
apps/desktop/shared/ipc-types.ts
apps/desktop/renderer/layout/
  preview-annotate.ts               # Highlight 主路径 + mark 回退 + 点击
  PreviewPane.tsx / PreviewAnnotateUi.tsx  # 采集行列
apps/mobile/src/web/rich-document/webview/runtime/
  annotate-marks.ts / annotate.ts   # 同上
  annotate-highlight-css.ts         # ::highlight 样式注入（或 document.css）
apps/mobile/src/components/vfs/
  FileMarkdownPreview.tsx           # 加草稿时带行列
packages/core/test/chat/            # schema / parse / 窗口匹配
apps/desktop/test/ + apps/mobile/__tests__/
```

## 变更点清单

| 模块 | 变更 |
|------|------|
| Core schema / XML build·parse | optional 行列；严格 schema；旧数据兼容 |
| Core 匹配 | 窗口优先；调整 needle 换行策略（H12） |
| Desktop / Mobile apply | Custom Highlight 主路径；mark 回退；点击重写 |
| 加批注 UI | 写入宽松行列 |
| CSS | `::highlight(nm-annotate)`；保留 mark 回退样式 |
| 测试 | 见 T-* |
| 文档 | 本迭代覆盖旧 D6/T5 对预览的禁止项 |

## 兼容性与迁移

- **读**：无行列字段 → 行为同现网全文匹配。  
- **写**：新批注尽量带行列。  
- **Undo**：parse 读回行列；无则不填。  
- **不**批量改写历史消息 XML。

## 详细实现步骤

- Step 1 — phase-schema-range — blocking: yes — qa: auto：扩展 `annotateDraftSchema`（保留 strict）+ Dto；`build*`/`parse*` 显式行列；单测缺字段兼容与 round-trip（T-AR1–T-AR3）。  
- Step 2 — phase-source-range-collect — blocking: yes — qa: auto：实现源文件宽松行列估算（plain 精确偏移换算；MD 用原文定位 + padding）；双端加草稿写入（T-AR4）。  
- Step 3 — phase-window-match — blocking: yes — qa: auto：Core 窗口内匹配 + 扩大一次 + 全文回退；调整 needle 换行策略使 plain 多行可命中（T-AR5–T-AR6）。  
- Step 4 — phase-custom-highlight-desktop — blocking: yes — qa: auto：Desktop 探测 + Highlight 绘制 + 点击命中；无 API 时 mark 回退（T-AR7–T-AR8）。  
- Step 5 — phase-custom-highlight-mobile — blocking: yes — qa: auto：Mobile WebView 同合同；注入 `::highlight` 样式；回退 mark（T-AR9）。  
- Step 6 — phase-cross-node-accept — blocking: yes — qa: auto：跨 `<strong>`/`<a>` 高亮可见（Highlight 或多段 Range/mark）（T-AR10）。  
- Step 7 — phase-manual-webview — blocking: no — qa: manual_user：真机 Android/iOS 探测分支、文本多行、点高亮打开；Desktop 对照。

## 测试策略

| 层 | 宿主 |
|----|------|
| Schema / XML / 窗口匹配 | `packages/core/test` |
| Desktop Highlight / 回退 / 点击 | `apps/desktop/test`（jsdom 测 mark 回退；Highlight 可用则测注册） |
| Mobile | `apps/mobile/__tests__` + 真机 manual |
| T-AR* manual | 合并后用户 |

### 测试用例

- T-AR1 — blocking: yes — decode/encode 带行列的草稿；缺行列旧 JSON 仍合法。（→ Step 1）  
- T-AR2 — blocking: yes — `buildFileAnnotateAttachmentFromDraft` XML 含行列键；旧三字段附件 parse 不挂。（→ Step 1）  
- T-AR3 — blocking: yes — Undo parse round-trip 保留行列。（→ Step 1）  
- T-AR4 — blocking: yes — plain 选区生成的窗口覆盖选区行且 ≥ padding。（→ Step 2）  
- T-AR5 — blocking: yes — 窗口内命中优先于文外相同原文。（→ Step 3）  
- T-AR6 — blocking: yes — plain/`pre` 多行 `originalText`（含 `\n`）可命中（回归文本预览）。（→ Step 3）  
- T-AR7 — blocking: yes — Desktop：模拟支持 Highlight 时注册非空 ranges；清除后 registry 干净。（→ Step 4）  
- T-AR8 — blocking: yes — Desktop：不支持时出现 mark + `closest` 可解析 ids。（→ Step 4）  
- T-AR9 — blocking: yes — Mobile：回退路径 mark + `data-annotate-ids` 合同不变。（→ Step 5）  
- T-AR10 — blocking: yes — 跨 strong 的可见串高亮覆盖（主路径或回退）。（→ Step 6）  
- T-AR11 — blocking: no — 真机：Custom Highlight 开/关两分支各扫一遍文本多行与点开。（→ Step 7）

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| Mobile WebView 无 Highlight | H1 探测 + H3 回退；真机 T-AR11 |
| 点击无 mark | H4 hit-test；失败不崩溃 |
| MD 源行列不准 | H7 宽松窗口 + 原文；不要求像素级 |
| 与表 needle 去换行冲突 | H12/H13：优先文本多行 |
| schema 漏写 XML | T-AR2/T-AR3 强制对称 |

**回滚**：关闭 Highlight 主路径（强制 mark）；行列字段保留 optional 不影响旧路径。或 git revert 本迭代提交。

## Context Bundle

```yaml
iteration_name: annotate-custom-highlight-soft-range
requirement_path: Iterations/annotate-custom-highlight-soft-range/prd.md
spec_path: Iterations/annotate-custom-highlight-soft-range/spec.md
explore_summary: |
  无 Highlight 现网代码；mark+closest；四字段 strict；
  行列双用途已确认；plain 易映射，MD soft；Android 须探测。
impact_files:
  - packages/core/.../annotate-draft.schema.ts
  - packages/core/.../build-attachment-action-xml.ts
  - packages/core/.../annotate-highlight.ts
  - apps/desktop/.../preview-annotate.ts
  - apps/mobile/.../annotate-marks.ts / annotate.ts
constraints:
  - 保留 schema.strict + optional 字段
  - chip 不改
  - 文本/MD 同 apply 抽象
blocking_steps: [1, 2, 3, 4, 5, 6]
```
