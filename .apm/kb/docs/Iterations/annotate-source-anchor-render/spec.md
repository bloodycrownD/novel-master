---
date: 2026-07-24
---

# annotate-source-anchor-render 技术规格（SPEC）

## 设计目标

落实 `Iterations/annotate-source-anchor-render/prd.md`：

1. **废止**预览主路径「渲染后 DOM 全文/窗口搜 `originalText` 再高亮」；改为 **源范围钉点 → 注入锚 → 再渲染**。  
2. 持久化存 **宽松 offset 范围**（半开区间，非精确单点）；`originalText` 用于校验与模型附件。  
3. 预览用 **同一 VFS 原文 + 同一 drafts**，按 `mode: text | markdown` 各自调用 `buildAnnotatedSource`；派生串可因 mode 不同而不同，同一批注的 `data-annotate-id` 在两侧一致。  
4. 锚形态按模式区分：文本单壳；Markdown 多壳同 id（按下划线可渲染单元切开）。  
5. 锚 **只存在于渲染管道**，不写磁盘源文件。  
6. 本迭代预览合同 **覆盖** `annotate-custom-highlight-soft-range` 中以 Custom Highlight / DOM 搜字为主的预览路径（该迭代已落地的 schema/XML 行列字段可迁移或并存，见读写表与 A11）。

需求来源：`Iterations/annotate-source-anchor-render/prd.md`  
前置：`annotate-user-ops-unify`；教训来源：`annotate-custom-highlight-soft-range`、`annotate-cross-node-highlight`

## 总体方案

### 钉死决策

| ID | 决策 |
|----|------|
| A1 | **权威位置**：草稿存源文件坐标系下的半开区间 `startOffset` / `endOffset`，语义钉死为 **`[startOffset, endOffset)`**（UTF-16 code unit 下标，与 JS `string.slice` 一致）。范围相对真实选区 **故意放宽**（采集时按 A10 / padding 常量合并后写入）。禁止只存一个精确 tip offset；禁止闭区间并存。与 A10、T-SA8 / T-SA8b 同一区间语义。 |
| A2 | **`originalText`**：保留；用于加批注时校验、失败提示、以及附件给模型。预览绘制 **不得** 再以全文/`findAllOccurrences(originalText)` 为主定位器。 |
| A3 | **磁盘**：注入锚只发生在内存派生串；`vfs` / 保存 / 导出路径仍读写无锚原文。 |
| A4 | **派生源**：`buildAnnotatedSource({ sourceText, drafts, mode }) → { annotatedSource, skippedDraftIds }`（签名见下节）。文本 Tab 吃 `mode: "text"` 的派生串；Markdown Tab（及 Desktop 等价）吃 `mode: "markdown"` 的派生串。两侧输入是同一 VFS 原文与同一 drafts，**不要求**两边 `annotatedSource` 字节相同。文本模式须走「认锚渲染」合同（见 **宿主 plain 渲染合同**）；Markdown 模式须走「宿主 Desktop MD / Mobile MD」合同，禁止把锚当纯明文或被解析器丢弃。 |
| A5 | **锚元素**：统一用 `<span class="nm-annotate-anchor" data-annotate-id="…">…</span>`。同一批注多段锚 **同一 `data-annotate-id`**。样式：下划线（可加淡底保证可见）。禁止再用 `<i>` / `<a>` 作锚示意或实现。 |
| A6 | **文本模式形态**：对落在范围内的整段连续源文本，生成 **一个** 锚壳，例如 `<span class="nm-annotate-anchor" data-annotate-id="1">xxx\|vv\|vv</span>`（中间字符含正文分隔符也一并包入，不切开）。 |
| A7 | **Markdown 模式形态**：在 offset 范围内，按 **「Markdown 允许渲染下划线的单元」** 切开，生成多段锚、同 id。切开处 = 会破坏「单一连续下划线壳」或会导致解析器把锚逃逸/拆坏的边界：至少包括行内强调定界符（`*`/`**`/`_`/`__`）、行内代码定界、链接/图片目标语法、以及进入围栏/行内代码内容的边界。落在同一可画线纯文本 run 内的不切。 |
| A8 | **代码**：围栏代码块与行内代码内部 **默认不注入锚**（绕开或整段降级不画线）；避免标签被当代码字面量或样式无意义。若选区完全落在代码内，仍保留草稿/chip，预览可无下划线。 |
| A9 | **点击**：预览内 `closest('[data-annotate-id]')`（或约定 class `.nm-annotate-anchor`）→ 解析 id → 打开既有详情/删除流。不再依赖 Custom Highlight hit-test / 旧 `data-annotate-ids` mark 作为主路径。 |
| A10 | **采集**：划词结束时用 **源文件** 坐标写入宽松 `[startOffset, endOffset)`。**plain**：由选区相对 **VFS 无锚源串** 的精确半开偏移经 `estimateSoftOffsetRangeFromPlainOffsets`（见 Step 5a）加 padding 后写入；量测禁止基于已注入锚的 DOM（见 Step 5a）。**Markdown（v1）**：宿主采集 `originalText` + 选区邻域（`contextBefore` / `contextAfter` 或等价），再在源全文中定位（见 Step 5b）；映射失败则 **不写脏 offset**，走 A12 兼容态（拒收写入或仅存 `originalText`）。**Mobile 触发通道（钉死）**：以 RN WebView **`menuItems` / `onCustomMenuSelection`** 为主入口（现网真实路径）；需要邻域或 plain offset 时由 RN **`injectJavaScript`** 向 WebView 取回，**不要**再以 Web→RN `selectionAnnotate` postMessage 为主通道（`RichDocumentBridge` 上该类型若仍存在可作遗留删除，见 Step 5b）。**padding 常量（钉死）**：行向 `ANNOTATE_SOFT_RANGE_LINE_PADDING = 2`（±2 行，复用既有）；字符向 **新增** `ANNOTATE_SOFT_RANGE_CHAR_PADDING = 32`（两侧各 32 个 UTF-16 code unit，Core 导出命名常量，禁止魔法数）。**合并顺序（钉死）**：精确选区半开 offset → **先** ±`CHAR_PADDING` 并钳制到 `[0, sourceText.length]` → **再**换算行列并施加 ±`LINE_PADDING`（外扩侧按既有 `applySoftRangeLinePadding`：丢对应侧列）→ **再**换回半开 offset 作为写入权威；派生行列取该最终宽松窗口。 |
| A11 | **给模型的附件**：继续显式写出位置信息。优先写 offset 范围；行列字段由 offset **派生** 且与 A1 同源，禁止另搞一套 DOM 搜字窗口。Chip 仍按 path 聚合，不改。 |
| A12 | **存量兼容**：无 offset 的旧草稿：预览可降级为「尽力」或仅 chip 可开；不得破坏发送。新草稿必须写 offset 范围（映射成功时）。 |
| A13 | **校验**：应用锚前，用范围内源切片与 `originalText`（归一后）比对；严重不符则跳过该条注入（草稿仍在），避免错位下划线。 |
| A14 | **双端**：Desktop / Mobile 会话工作区预览同一合同；Core 承载 `buildAnnotatedSource` / 切开纯函数，宿主只接渲染与点击。 |
| A15 | **坐标系（VFS 全文）**：`startOffset`/`endOffset` **一律相对 VFS 读出的完整源文件字符串**（含 Markdown front matter）。带 FM 的 `.md`：`buildAnnotatedSource` **吃全文**注入；宿主若只渲染 body，须在切 FM 时对 `annotatedSource` 做与无锚路径相同的 split，使 body 内锚的相对位置仍正确；**禁止**对「仅 body」另算一套 offset 而不换算。若实现选择「先 split 再注入」，必须把草稿 offset 减去 FM 前缀长度后再注入 body，并在 SPEC 实现注释与单测中钉死换算；v1 **推荐**全文注入再 split。 |

### `buildAnnotatedSource` API 签名草案（P1-5）

```ts
export type BuildAnnotatedSourceMode = "text" | "markdown";

export type BuildAnnotatedSourceInput = {
  /** VFS 全文（含 FM）；见 A15 */
  readonly sourceText: string;
  readonly drafts: readonly AnnotateDraft[];
  readonly mode: BuildAnnotatedSourceMode;
};

export type BuildAnnotatedSourceResult = {
  /** 仅内存；含锚 HTML 子集，不写盘；同 drafts 下 text/markdown 可不同 */
  readonly annotatedSource: string;
  /** 校验失败 / 重叠 skip / 代码绕开等未注入的 draft id */
  readonly skippedDraftIds: readonly string[];
};

export function buildAnnotatedSource(
  input: BuildAnnotatedSourceInput,
): BuildAnnotatedSourceResult;
```

- `mode: "text"` → 单壳（A6）；`mode: "markdown"` → 多壳切开（A7/A8）。  
- 返回的 `skippedDraftIds` 供宿主日志/诊断；chip 与草稿 store **不因 skip 删除**。

### 宿主 plain 渲染合同（A4 / Step 4）

当前 plain 路径会把内容当**纯文本节点**塞进去，锚标签会被当成字面量显示或根本无法点击——必须改掉。

| 宿主 | 现状（冲突） | v1 接线 |
|------|----------------|---------|
| **Desktop** | `PreviewPane`：`<pre class="preview-text">{content}</pre>`（React 文本子节点） | 文本 Tab：先 `buildAnnotatedSource({ mode: "text" })`，再把 `annotatedSource` 以**安全 HTML**写入可保留 `white-space: pre-wrap` 的容器（可继续用 `pre.preview-text`，但改为 `dangerouslySetInnerHTML` **或**等价消毒后挂载）。禁止 `{annotatedSource}` 当 children。 |
| **Mobile** | `DocumentApp`：`mode!=='html'` 时 `<div className="doc-body">{payload.plain}</div>` | plain Tab：payload 改为携带已注入锚的 HTML（或与 MD 共用 `TrustedHtml` 通道）；经 `TrustedHtml` / `sanitizeRichHtml` 渲染。禁止把带锚串放进 `payload.plain` 文本节点。RN 回退 `FileMarkdownPreview` 纯 `<Text>{content}</Text>` **不**承担认锚预览（无 WebView 时仅 chip，与 A12 底线一致）。 |

### 宿主 Desktop MD 渲染合同（A4 / Step 4 / P0-A）

现状：Desktop `PreviewPane` 用 `react-markdown` + `remark-gfm`，**默认不解析 raw HTML**。若把 `buildAnnotatedSource({ mode: "markdown" })` 的带锚串直接当 Markdown children，锚 `<span …>` 会被丢掉或当文本，下划线与点击都没了。

**v1 钉死方案 (a)（推荐）**

1. `buildAnnotatedSource({ mode: "markdown" })` 得到带锚派生串。  
2. 对派生串做与 plain **同源**的消毒白名单（见下方 XSS 合同；必须放行 `data-annotate-id`）。  
3. 以 `react-markdown` + `remark-gfm` + **`rehype-raw`** 渲染消毒后的串，使约定锚 `span` 进入 DOM。  
4. 禁止继续「无 `rehype-raw`、无消毒」的默认 MD 路径吃带锚源。

**备选方案 (b)**（仅当 Desktop 明确弃用 react-markdown 预览链时）

- 复用 Mobile 同源 **markdown-it → sanitize → HTML 挂载** 管道吃 `mode: "markdown"` 派生串。  
- v1 **无强理由不走 (b)**；本规格默认实现按 **(a)** 验收。

**T-SA4 / T-SA6 Desktop 断言说明**

- T-SA4（Core）：继续断言 `buildAnnotatedSource({ mode: "markdown" })` 对 `hel**lo**` 类产出多段同 id 锚串（与宿主无关）。  
- T-SA6（宿主）：除 Mobile 外，**Desktop MD 路径**须断言渲染后 DOM 可 `closest('[data-annotate-id]')` 命中；若只测 Core 字符串则 **不算**闭合 Desktop MD 合同。plain 路径另断言用户不可见裸锚标签字符串。

### 宿主 Mobile RichDocument 预览合同（Step 4 / 6 / P1-B）

现状：`RichDocumentWebView` 在 `setDocument` 之后另发 `setAnnotations`，Web 侧 `applyAnnotateMarks` 再 DOM 搜字画线——与本迭代主路径冲突。

**v1 接线**

| 路径 | 合同 |
|------|------|
| **主预览** | 宿主（RN）先 `buildAnnotatedSource`，再经 `setDocument` 投递 **已注入锚** 的 `html` / plain 认锚 HTML；预览高亮来自锚 DOM，**不**再靠 `setAnnotations` 驱动主绘制。 |
| **`setAnnotations` / `applyAnnotateMarks`** | 退出预览默认路径；**仅应急回滚开关**可临时恢复旧 apply（与 Step 6 一致）。默认刷新、切 Tab、草稿变更 **禁止**再走该链。 |
| **点击** | 改为 `closest('[data-annotate-id]')`（或 `.nm-annotate-anchor`）解析 id → `annotateOpen`；不再以 Custom Highlight hit-test / 旧 mark class + `data-annotate-ids` 为主。 |

### XSS / 标签白名单（Step 4 / P1-E）

- 锚管道只允许插入约定子集：`span.nm-annotate-anchor` + `data-annotate-id`（及必要的 `class`）。  
- 正文中用户原有的 `<` `>` 必须在注入前按文本转义，再包锚，避免「源文件里的尖括号」变成真标签。  
- **Mobile**：`sanitize-rich-html.ts` 的 `sanitizeRichHtml` —— 在既有 `allowedAttributes` 上 **显式放行** `data-annotate-id`。落点示例（等价即可）：`span: […既有, 'data-annotate-id']`，或把 `data-annotate-id` 加入对 `span`/`*` 生效的属性列表；仅靠 `class`/`id`/`style` **不够**，当前默认会剥掉自定义 `data-*`。  
- **Desktop**：plain（`dangerouslySetInnerHTML` 前）与 MD（`rehype-raw` 前）消毒落点与 Mobile **同源白名单**；同样 **显式放行** `data-annotate-id`（本迭代新增 Desktop 消毒辅助或内联与 Mobile 对齐的配置；库选型见 **已知限制 / 实现注**）。  
- 禁止 `script` / 事件属性 / 非约定标签进入 plain / MD 认锚 DOM。

**`pre-wrap` / 换行**

- plain 观感保持与当前实现一致：`white-space: pre-wrap`（Desktop `.preview-text` 已有；Mobile plain 容器对齐）。  
- 锚 `span` 为 inline，不引入额外块级换行；源中的 `\n` 仍落在文本节点里由 `pre-wrap` 呈现。

**禁止**

- 把 `annotatedSource` 当纯明文展示（用户看见裸 `<span …>`）。  
- 文本 / MD Tab 渲染后再跑旧 `applyAnnotate*` / `findAllOccurrences` 补高亮（应急开关除外）。  
- Desktop MD 无 `rehype-raw`（或无方案 b 等价管道）却期望锚可见。

### 架构概览

```text
磁盘原文（无锚，VFS 全文）
  + AnnotateDraft[]（id, path, originalText, startOffset, endOffset, …）
       ↓ buildAnnotatedSource({ mode: text | markdown })  ← 同原文同 drafts，mode 各调一次
派生 annotatedSource（仅内存；text/md 串可不同）+ skippedDraftIds
       ↓
   ┌───┴───┐
文本预览   Markdown 预览
（认锚 HTML） （MD 解析且锚进 DOM：Desktop=rehype-raw 方案 a）
       ↓
  下划线样式 + click → 同一 draft id
```

文本形态示意：`<span class="nm-annotate-anchor" data-annotate-id="1">xxx|vv|vv</span>`  
Markdown 形态示意：`<span … id="1">xxx</span>|<span … id="1">vv</span>|<span … id="1">vv</span>`（`|` 若为正文则出现在壳内或壳间视切开规则而定；示意重点是多壳同 id）

### 与旧路径关系

| 旧（soft-range / DOM 搜字 / Highlight 主画） | 新 |
|-----------------------------------------------|-----|
| 预览主定位：搜 originalText | 预览主定位：offset 范围 → 锚 |
| Custom Highlight 为跨节点主手段 | 跨节点 = MD 多段锚同 id + CSS 下划线 |
| 行列窗口约束 DOM 搜字 | offset 范围直接注入；行列仅派生/附件 |
| Mobile `setAnnotations` → `applyAnnotateMarks` | 主路径退役；仅应急 |

## 最终项目结构（预期）

```text
packages/core/src/domain/chat/logic/
  annotate-source-anchor.ts     # 新增：宽松范围校验、buildAnnotatedSource、MD 切开
  annotate-source-range.ts      # + estimateSoftOffsetRangeFromPlainOffsets、CHAR_PADDING
  annotate-draft.schema.ts      # + startOffset/endOffset；迁移说明
  build-attachment-action-xml.ts
packages/core/src/public/chat.ts  # 导出新 API / 常量；allowlist 快照同步
packages/core/test/chat/
  annotate-source-anchor*.test.ts
apps/mobile/.../FileMarkdownPreview + rich-document 渲染入口（DocumentApp 认锚；menuItems 采集）
apps/mobile/.../sanitize-rich-html.ts  # allowedAttributes 放行 data-annotate-id
apps/desktop/.../PreviewPane 文本/MD 预览入口（pre 认锚；MD=rehype-raw+消毒）
# 退役清单见 Step 6
```

## 变更点清单

| 模块 | 变更 |
|------|------|
| Core schema / XML | offset 范围字段；附件对称；旧数据兼容；写时派生行列 |
| Core 锚管道 | `buildAnnotatedSource(text\|markdown)` + 切开纯函数 + 校验 + skip 列表 |
| Core 采集 helper | `estimateSoftOffsetRangeFromPlainOffsets` + `ANNOTATE_SOFT_RANGE_CHAR_PADDING`；public 导出 + allowlist；MD 邻域定位 API（命名实现时定） |
| Mobile / Desktop 预览 | 渲染前注入；双 Tab 同原文同 drafts；plain 认锚；Desktop MD rehype-raw；点击锚 |
| Mobile RichDocument | 主路径吃已注入 html/plain；`setAnnotations`/`applyAnnotateMarks` 仅应急 |
| 加批注采集 | plain / MD 分路写入宽松 offset；Mobile 以 `menuItems`/`onCustomMenuSelection` 触发，必要时 `injectJavaScript` 取邻域/offset；遗留 `selectionAnnotate` 可删 |
| 旧 DOM 搜字 apply | 退出主路径（见 Step 6 退役清单） |
| 测试 | 见 T-SA*（含 T-SA8b） |

## 兼容性与迁移

- **读**：无 offset → 不注入锚（或文档化的一次性降级）；chip/发送仍可用。有 offset → 注入优先走 offset（A13 校验）。  
- **写**：新批注在映射成功时必写 offset 范围；**同时**由 offset 派生行列一并写出（若可算）。  
- **不**批量改写历史消息 XML；Undo parse 对称读 offset（及既有行列）。  
- 已有 `startLine/endLine`：继续写出（由 offset 派生），避免模型侧回退。

### Schema / Dto / XML 读写表（Step 1）

| 方向 | 规则 |
|------|------|
| **写（store / 附件 XML）** | 映射成功时必写 `startOffset`、`endOffset`（半开）。由同一 offset **派生** `startLine`/`endLine`/`startCol`/`endCol`（1-based，行闭区间语义与 soft-range 一致）并写出；派生失败可省略行列，但不可省略已成功的 offset。 |
| **读（注入预览）** | **优先**有效 offset → `buildAnnotatedSource`；无 offset → A12（不注入或文档化降级）。有 offset 时 **忽略**旧搜字路径；行列不参与主定位。 |
| **读（Undo / parse）** | `parseAnnotateDraftsFromAttachments` 对称读回 offset；缺省旧附件仍合法。 |

**字段清单**（`annotateDraftSchema` 保留 `.strict()`；Dto / IPC 对齐）

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` / `path` / `originalText` / `userAnnotation` | 是 | 既有 |
| `startOffset` / `endOffset` | 新稿映射成功时必写 | 非负整数；`start < end`；半开 `[start,end)` |
| `startLine` / `endLine` / `startCol` / `endCol` | optional | 由 offset 派生；附件 XML 键名同 soft-range |

XML：`buildFileAnnotateAttachmentFromDraft` 在 `params` 中显式增加 `startOffset`/`endOffset`（有则写）；parse 对称 `asParam` 读回。

**Public 导出与 allowlist（Step 1 / P2-C）**

本迭代新增并须从 `@novel-master/core` 的 `public/chat` 导出（并更新 `public-chat-allowlist` 快照）至少包括：

- `buildAnnotatedSource`（及必要关联类型）  
- `estimateSoftOffsetRangeFromPlainOffsets`  
- `ANNOTATE_SOFT_RANGE_CHAR_PADDING`（既有 `ANNOTATE_SOFT_RANGE_LINE_PADDING` 保持导出）

## 详细实现步骤

- Step 1 — phase-schema-offset-range — blocking: yes — qa: auto：schema/Dto/XML 增加 `startOffset`/`endOffset`；注释钉死半开 `[start,end)`；按上表实现读写与派生行列；**public/chat 导出新 API/常量并更新 allowlist**（T-SA1–T-SA2）。  
- Step 2 — phase-build-annotated-text — blocking: yes — qa: auto：文本模式单壳注入；多草稿按 `startOffset` 升序处理。**v1 重叠策略：禁止 overlap 注入**——若候选范围与已成功注入区间相交，将该 draft 记入 `skippedDraftIds` 并 **保留 chip/草稿**，不嵌套、不裁切。校验 `originalText`（T-SA3）。  
- Step 3 — phase-build-annotated-markdown — blocking: yes — qa: auto：Markdown 按下划线可渲染单元切开多壳同 id；代码块/行内代码绕开；重叠策略同 Step 2（T-SA4–T-SA5）。  
- Step 4 — phase-host-preview-wire — blocking: yes — qa: auto：Mobile/Desktop 预览改为吃派生源；落实 **宿主 plain 渲染合同**、**Desktop MD 渲染合同（方案 a）**、**Mobile RichDocument 预览合同**、**XSS 白名单（含 `data-annotate-id`）**；点击改 `closest('[data-annotate-id]')`。**预览刷新路径禁止再调用**旧 `applyAnnotateMarks` / `applyAnnotateHighlights` / `setAnnotations` 驱动的搜字绘制（含「渲染后再 apply」）；应急开关除外（T-SA6–T-SA7、T-SA9）。  
- Step 5 — phase-collect-soft-range — blocking: yes — qa: auto：划词写入宽松 `[startOffset, endOffset)`，分 plain / MD：  
  - **5a plain（P1-C / P1-D）**：选区精确半开 → Core **`estimateSoftOffsetRangeFromPlainOffsets(sourceText, selectionStart, selectionEnd, options?) → { startOffset, endOffset }`**（半开；内部按 A10：**先** ±`ANNOTATE_SOFT_RANGE_CHAR_PADDING`（默认 32），**再** ±`ANNOTATE_SOFT_RANGE_LINE_PADDING`（默认 2）合并）→ **写路径以返回的 offset 为权威**；行列由该最终 offset **派生**后一并写出。既有 `estimateSoftRangeFromPlainOffsets` 可保留作行列辅助或内部实现，但新稿 offset **不**再以「只写行列、预览再搜字」为主。覆盖真实选区且更宽（T-SA8）。  
    - **Desktop plain 量测**：对 plain 根节点（如 `pre.preview-text`）调用既有 **`getSelectionOffsetsInElement`**：选区须落在 element 内；`selectNodeContents(element)` 后 `setEnd` 到选区起点，`toString().length` 得 `start`，再加选区 `toString().length` 得半开 `end`。  
    - **Mobile plain 量测（钉死）**：在 `.doc-body` 上取当前选区 `Range`，算法与 Desktop `getSelectionOffsetsInElement` **同构**，得到相对 **VFS 无锚源串** 的半开 `[selectionStart, selectionEnd)`（UTF-16；与 A1 / A15 同一坐标系——含 FM 时相对全文，body-only 视图须换算回 VFS 全文下标）。**禁止**基于已注入 `nm-annotate-anchor` 的 DOM 树量测（标签字符不得计入 offset；认锚渲染开启时，采集须对无锚正文坐标系量测——例如采集瞬间对无锚视图/`textContent` 等价串量测，或先把 Range 映射回无锚 `sourceText` 再算下标）。Mobile 触发仍走 RN `menuItems` / `onCustomMenuSelection`；若菜单回调只有 `selectedText`、缺 offset，则 RN **`injectJavaScript`** 向 WebView 拉取上述半开 offset 后再进 Core。  
  - **5b Markdown（v1 / P1-A）**：**Mobile 主通道 = RN 原生选区菜单**（现网真实路径），**不是** Web→RN `selectionAnnotate`。  
    - **触发**：`RichDocumentWebView` 的 `menuItems`（含「添加批注」）→ `onCustomMenuSelection`（`key === 'annotate'`）拿到 `selectedText`（即 `originalText`）。  
    - **邻域补齐**：菜单事件通常只有选中文本；需要 `contextBefore` / `contextAfter`（或字段名等价）时，由 RN **`injectJavaScript`** 在 WebView 内读选区前后邻域（或等价窗口）并回传 RN。宿主采集合同至少包含 **`originalText` + `contextBefore` / `contextAfter`**（或等价）。  
    - **RN→Core 调用链（钉死）**：`onCustomMenuSelection` →（必要时 `injectJavaScript` 取邻域）→ RN（`RichDocumentWebView` / `FileMarkdownPreview`）→ Core 邻域定位 API（命名见下方「已知限制 / 实现注」）用 `originalText` + 邻域在 **VFS 无锚全文** 定位 → 命中后换算精确半开 offset → 同一套 padding 合并（A10）→ `addChatAnnotateDraft`（或等价写路径）。Desktop MD 划词须提供等价邻域信息再调同一 Core 定位。唯一命中则写入；多命中取邻域内最近；**失败 → A12**（不写脏 offset）。  
    - **遗留**：`RichDocumentBridge` 的 Web→RN `selectionAnnotate`（现状仅 `{ text }`）**不再作为主通道**；类型/handler 可删。blocking 测 **T-SA8b 绑定 RN 菜单触发 + 邻域 payload + 上述调用链**。  
- Step 6 — phase-retire-dom-search — blocking: yes — qa: auto：预览默认关闭搜字 apply；附件仍带位置（T-SA9）。**退役清单（预览主路径）**：  
  - Desktop：`preview-annotate.ts` 内以 `findAllOccurrences` / 窗口搜字驱动的 `applyAnnotateHighlights` 调用链；`PreviewPane` 渲染后自动 apply。  
  - Mobile：`annotate-marks.ts` / `annotate.ts` 中 `applyAnnotateMarks` + `findAllOccurrences` 作为 setDocument 后主绘制；**`RichDocumentWebView` 默认 `setAnnotations` 投递链**（主路径改为吃已注入锚的 html/plain）。  
  - Core：`annotate-highlight.ts` 作为预览主定位的窗口搜字（可保留纯函数供应急开关或单测，但宿主默认不调用）。  
  - 保留：chip UI、详情/删除、附件 build/parse、采集辅助（行列↔offset 换算）。  
  - 应急：仅回滚开关可临时恢复旧 apply / `setAnnotations`（见风险与回滚）。  
- Step 7 — phase-manual — blocking: no — qa: manual_user：跨 `**`/链接、同文两处、文本/MD 切换、点开删除、plain 认锚无裸标签、Desktop MD 锚可见可点。

## 测试策略

| 层 | 宿主 |
|----|------|
| 切开 / 注入 / 校验 / 重叠 skip / offset helper / padding | `packages/core/test` |
| 预览接线 / 点击 / plain 认锚 / Desktop MD rehype-raw / sanitize | Mobile `__tests__`、Desktop `test` |
| T-SA* manual | 用户真机 |

### 测试用例

- T-SA1 — blocking: yes — schema 接受 offset 范围半开语义；非法（start≥end、非整数、负值）拒绝；缺省旧草稿仍合法。  
- T-SA2 — blocking: yes — build/parse 附件含 offset；有 offset 时派生行列一并 round-trip；旧附件无 offset 不挂；**public 导出 / allowlist 含本迭代新符号**。  
- T-SA3 — blocking: yes — 文本模式：范围内单壳；同文两处只亮范围内一处；重叠草稿进入 `skippedDraftIds` 且不注入。  
- T-SA4 — blocking: yes — `hel**lo**` 类：Markdown 注入为多段同 id 锚（或等价切开），不是单壳跨 `**`。（Core 字符串断言；Desktop DOM 可见性归 T-SA6。）  
- T-SA5 — blocking: yes — 选区落入围栏代码：不注入锚或整段跳过；草稿仍在。  
- T-SA6 — blocking: yes — 派生源渲染后 DOM 可 `closest` 到 id；**含 Desktop MD（方案 a）路径断言**；plain 路径用户不可见裸锚标签字符串；Mobile sanitize 后 `data-annotate-id` 仍在。  
- T-SA7 — blocking: yes — **Primary 宿主 = Mobile**：文本 Tab 与 MD Tab 对同一 draft id 均可点开；Desktop 对齐为次要或同测补充。  
- T-SA8 — blocking: yes — plain 划词：宿主（含 Mobile `.doc-body` Range / Desktop `getSelectionOffsetsInElement`）量测得相对 **VFS 无锚源串** 的精确半开 offset，再经 `estimateSoftOffsetRangeFromPlainOffsets` 得到的 `[start,end)` 覆盖选区且宽于精确选区；断言 CHAR→LINE 合并顺序与默认常量（32 / 2）；**禁止**以已注入锚 DOM 为量测基准的实现通过。  
- T-SA8b — blocking: yes — Markdown 划词：**绑定** Mobile **`menuItems` / `onCustomMenuSelection`** 触发（必要时 `injectJavaScript` 取邻域）→ 宿主 payload（至少 `originalText` + `contextBefore`/`contextAfter` 或等价）→ RN→Core 定位链；**不**以 Web→RN `selectionAnnotate` 为主通道；邻域定位成功则写入与源全文一致的 `[start,end)`；定位失败不写 offset（A12）；与 A1 半开语义一致。  
- T-SA9 — blocking: yes — 预览路径源码/测试断言不再以 `findAllOccurrences(originalText)` / `applyAnnotateMarks|Highlights` / 默认 `setAnnotations` 为高亮入口。  
- T-SA10 — blocking: no — 真机：跨节点可见、同文不误多、删除闭环、plain/MD 切换连续（含 Desktop MD 锚）。

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| MD 插锚破坏语法 | A7/A8 切开与代码绕开；单测 T-SA4/5 |
| Desktop MD 丢锚 span | 宿主 Desktop MD 合同方案 a（rehype-raw + 同源消毒）；T-SA6 |
| MD 划词映射失败 | A10 / Step 5b → A12；不写脏 offset；T-SA8b |
| 重叠批注 | v1 skip 注入、保留 chip（Step 2） |
| plain / MD 路径 XSS / 裸标签 | 宿主 plain + XSS 合同；转义 + 白名单显式 `data-annotate-id` + TrustedHtml |
| 旧草稿无高亮 | A12 底线：chip/条目仍在 |
| FM 与 body 偏移错位 | A15 全文注入再 split（或显式换算 + 测） |
| 认锚 DOM 污染 plain 量测 | Step 5a：禁止基于已注入锚 DOM 量测；相对 VFS 无锚源串 |

**回滚**：关闭注入管道，临时恢复旧搜字 apply / `setAnnotations`（仅应急）；或 git revert 本迭代。

## 已知限制 / 实现注（P2）

本迭代规格钉死合同与验收边界；下列细节 **实现时自决或待定命名**，不阻塞 Step 编号，但实现 PR 须在注释/导出上与本节一致：

| 项 | 说明 |
|----|------|
| **Core 邻域定位 API 命名** | Step 5b / MD 采集所用「`originalText` + 邻域 → VFS 全文半开 offset」的 Core 函数名 **待实现时定**（可新建或扩展既有 `estimateSoftRangeFromOriginalText` 一类）；须从 `public/chat` 导出并更新 allowlist。SPEC 正文用「邻域定位 API」指代，不锁死符号名。 |
| **Desktop 消毒库选型** | plain / MD 认锚前消毒与 Mobile **同源白名单**（含 `data-annotate-id`）。库可选：**`rehype-sanitize`**（配合 `rehype-raw` 方案 a）**或** 复用 / 对齐 Mobile 的 **`sanitize-html`**（或抽共享配置）；v1 不锁死其一，验收以白名单行为为准。 |
| **A7 切开细节** | Markdown「下划线可渲染单元」切开的具体 tokenizer / 边界枚举 **实现自决**，只要满足 A7/A8 与 T-SA4/T-SA5（跨强调多壳同 id；代码内不注入）。 |
| **v1 划词采集限定** | v1 划词批注 **只对无锚源串** 采集 offset / 邻域（相对 VFS 无锚全文）。用户在已注入锚的预览 DOM 上划词时，宿主仍须映射回无锚坐标系；**不**把锚标签或已标注 DOM 结构当作采集真源。 |

## Context Bundle

```yaml
iteration_name: annotate-source-anchor-render
requirement_path: Iterations/annotate-source-anchor-render/prd.md
spec_path: Iterations/annotate-source-anchor-render/spec.md
explore_summary: |
  用户确认：渲染前注入锚；文本单壳、MD 按下划线单元多壳同 id；
  存宽松半开 offset 范围；不写磁盘；废止 DOM 搜字主路径；
  plain Tab 须认锚安全 HTML 渲染；Desktop MD 钉 rehype-raw+同源消毒；
  同 VFS 原文 + 同 drafts，mode 派生串可不同、id 一致；
  MD 划词 v1 邻域定位失败走兼容态；
  Mobile 采集主通道 = menuItems/onCustomMenuSelection（非 selectionAnnotate）；
  plain offset 相对 VFS 无锚源串，禁止已注入锚 DOM 量测。
constraints:
  - 锚仅内存派生源
  - 双预览同 VFS 原文与 drafts；mode 派生串可不同、id 一致
  - originalText 不主定位
  - offset 相对 VFS 全文；半开 [start,end)
  - CHAR_PADDING=32 先于 LINE_PADDING=2 合并
  - Desktop MD: rehype-raw + 消毒放行 data-annotate-id（方案 a）
  - Mobile 采集: menuItems/onCustomMenuSelection；injectJavaScript 补邻域/offset
  - v1 划词对无锚源串采集；禁止已注入锚 DOM 量测
  - v1 禁止 overlap 注入
blocking_steps: [1, 2, 3, 4, 5, 6]
```
