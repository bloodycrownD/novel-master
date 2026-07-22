---
date: 2026-07-22
---

# annotate-cross-node-highlight 技术规格（SPEC）

## 设计目标

在工作区阅读态批注「尽力匹配」下划线合同下，使**跨行内 DOM 节点的连续可见原文**也能显示与同节点等价的下划线（或多段连续下划线），且点击打开/编辑/删除合同不变。不改落库 schema，不引入稳定字符 offset 锚点，**不以**统一 Desktop/Mobile WebView 为前置。

需求来源：`Iterations/annotate-user-ops-unify/features/annotate-cross-node-highlight/prd.md`

## 总体方案

**默认方案 A：扁平可见文本索引 + 多段 `<mark>` wrap。**

### 钉死决策

| ID | 决策 |
|----|------|
| D1 | **扁平匹配域**：行内相邻 Text **直接拼接**（无插入符）。在 **block 边界 / `br` / 表单元格边界** 切断匹配域（实现二选一，行为须等价）：(a) 分段各自建 haystack；或 (b) 在切断点插入与 `Selection.toString()` 等价的分隔，使跨界 `indexOf` 无法命中。**跨 `<p>` 不得误命中。** |
| D2 | **入库归一 ≠ 索引归一**。Needle（`originalText` / 选区入库）：允许 `\u00a0→space` + **trim**（与现网 `readSelectionTextInContainer` / Mobile 菜单选区一致）。Segment→haystack：**仅 1:1 `\u00a0→space`**，**禁止**对 haystack 整体或 segment 首尾做 trim。 |
| D3 | **offset 映射**：因 segment 归一为 1:1，flat 区间映射到某 segment 的局部 `[start,end)` **即**该 Text 的 **raw `nodeValue` 下标**（wrap 时直接用，勿再对 raw 做 trim 位移）。若未来归一破坏 1:1，须另开合同。 |
| D4 | **归一 / 扁平 / 切分 helper 落 Core**（`annotate-highlight*`）；DOM 收集与 wrap 留双端壳。 |
| D5 | **壳 apply 定稿**（双端同合同）：`unwrap` → `group` + **长优先 for-each text** → **一次**收集未 mark 的 Text segments → `buildFlat*` + `findAllOccurrences` → `mapFlatRangeToSegments` → **多段 wrap**（**右到左**包，或先记录全部局部区间句柄再一次性 wrap）。**废弃**「`while` + 最多 200 次 `findFirstUnmarkedPlainMatch`」模型。 |
| D6 | CSS Custom Highlight API：本期**不做**默认路径。 |
| D7 | 跨单元格：以「选区得到的可见连续串」为准；不要求不相邻单元格硬拼；同单元格内跨行内样式须覆盖。 |

### 算法分层

1. **Core（纯函数）**
   - `normalizeAnnotateNeedle(text)`：`\u00a0→space` + trim（入库/匹配用 needle；空则跳过）。
   - `normalizeAnnotateSegmentText(raw)`：仅 `\u00a0→space`（1:1）。
   - `buildFlatTextIndex(segments)`：按 D1 拼接规则生成 `haystack` + 每字符/区间 → `{ segmentIndex, localStart }` 映射。
   - `mapFlatRangeToSegments(flatStart, flatEnd, index)` → `{ segmentIndex, start, end }[]`。
   - 复用既有 `findAllOccurrences` / `groupAnnotateIdsByOriginalText` / `sortAnnotateTextsLongestFirst` / `parseAnnotateIdsAttr`。
2. **Mobile / Desktop 壳**：TreeWalker 收集 Text 句柄（跳过已在 annotate-mark 内的节点）；按 Core 指令 `wrapRange`；每段 `<mark>` 同一 `data-annotate-ids`；类名仍为现网（`.annotate-mark` / `.preview-annotate-mark`）。
3. **点击**：继续 `closest('mark.…')` → 解析 ids → 打开草稿。多段 mark 任一段即可打开同一批 ids。

**匹配失败**：仍保留条目与 chip，无下划线（尽力匹配底线不变）。

## 最终项目结构

```text
packages/core/src/domain/chat/logic/
  annotate-highlight.ts          # 扩展：归一 / flat index / split ranges
  annotate-highlight-flat.ts     # 可选拆文件，若单文件过大
packages/core/src/public/chat.ts # Step1 强制再导出新 API
packages/core/test/chat/
  annotate-highlight.test.ts     # 增跨段切分、跨 p 切断、归一 1:1 用例
apps/desktop/shared/logic/chat.ts # Step1 强制再导出（@shared/logic/chat）
apps/mobile/src/web/rich-document/webview/runtime/
  annotate-marks.ts              # 改：定稿 apply；废弃 200×findFirst
apps/desktop/renderer/layout/
  preview-annotate.ts            # 改：同合同多段 wrap
（样式 / bridge / PreviewPane 点击：原则上零改）
```

## 变更点清单

| 模块 | 变更 |
|------|------|
| Core `annotate-highlight*` | 新增 needle/segment 归一、扁平索引、区间切分；**强制**导出至 `public/chat`，Desktop `@shared/logic/chat` **再导出** |
| Mobile `annotate-marks.ts` | 定稿 apply（unwrap → 长优先 → collect → flat findAll → 多段 wrap）；**删除** 200 次 `findFirst` 循环 |
| Desktop `preview-annotate.ts` | 同合同算法；删除/改写「跨元素跳过」注释为「跨段多 mark」；**禁止**引入另一套 findFirst×N |
| 测试 | Core 纯函数（含跨 p 切断）；双端 DOM/jsdom：跨 `<strong>` **两段 mark**；既有 T-UL* / 同文多命中无回归 |

## 详细实现步骤

- Step 1 — phase-core-flat-index — blocking: yes — qa: auto：Core 实现归一 + `buildFlatTextIndex` + `mapFlatRangeToSegments`（或等价命名）；复用 `findAllOccurrences`。**强制**经 `packages/core/src/public/chat.ts` 导出，并在 `apps/desktop/shared/logic/chat.ts` 再导出。单测：跨 segment 切分、空 needle、跨 p / br / 单元格切断不误命中、segment 归一 1:1 下 offset≡raw。重叠由上层长优先处理。
- Step 2 — phase-mobile-multi-wrap — blocking: yes — qa: auto：`applyAnnotateMarks` 改为定稿 apply；同 ids；unwrap 后再 apply 无残留；**废弃** `wrapAllPlainMatches` 的 200×findFirst。补充 DOM/jsdom 测（见测试宿主策略）。
- Step 3 — phase-desktop-multi-wrap — blocking: yes — qa: auto：`applyAnnotateHighlights` 同合同；扩展 `preview-annotate.test.ts`（跨 strong/a，**两段** mark）。
- Step 4 — phase-click-contract — blocking: yes — qa: auto：断言多段 mark 均带同一 `data-annotate-ids`；点击路径（Mobile bridge / Desktop `closest`）无改或仅测回归。
- Step 5 — phase-regression-ul — blocking: yes — qa: auto：多文件 path 下划线（既有 T-UL*）、同文多处全标、长串优先抢占短串仍通过。
- Step 6 — phase-manual-preview — blocking: no — qa: manual_user：真机/桌面各扫：标题内加粗、表格单元格内嵌套、跨链接短语、相邻段落不误标；确认下划线与点击打开。

## 测试策略

### 测试宿主策略

| 层 | 宿主 | 说明 |
|----|------|------|
| Core T-XN1 / T-XN1b / T-XN1c | Node（既有 `packages/core/test`） | 纯字符串 segments，无 DOM |
| Mobile T-XN2 | jsdom（或现网等价 DOM 测 harness）测 `annotate-marks` 壳 | 不依赖真机 WebView；构造 `<p>hel<strong>lo</strong></p>` 等 |
| Desktop T-XN3 | jsdom / 既有 desktop test 环境测 `preview-annotate` | 与 Mobile 同 HTML 合同 |
| T-XN7 | 真机 / 桌面 manual | 仅人工扫 |

### 测试用例

- T-XN1 — blocking: yes — Core：segments `["hel","lo"]` 扁平匹配 `hello` → 两段局部区间 `{0,0..3}` + `{1,0..2}`（示意）。（→ Step 1）
- T-XN1b — blocking: yes — Core：**跨 p 切断**：两段分属不同 block run（或中间插入等价分隔）时，needle=`lohe`（前段尾+后段首）**零命中**；不得拼成 `…lo`+`he…`。（→ Step 1）
- T-XN1c — blocking: yes — Core：segment raw 含 `\u00a0`，归一后 haystack 等长；flat 命中映射的 local offset **等于** raw `nodeValue` 下标；haystack **未** trim。（→ Step 1）
- T-XN2 — blocking: yes — Mobile：DOM `<p>hel<strong>lo</strong></p>`，draft `originalText=hello` → **恰好两段**（或 ≥2 且并集覆盖可见 `hello`）`.annotate-mark`，ids 一致。（→ Step 2）
- T-XN3 — blocking: yes — Desktop：同上合同，**两段** `.preview-annotate-mark`。（→ Step 3）
- T-XN4 — blocking: yes — 多段 mark 的 `data-annotate-ids` 一致；parse 后 ids 与草稿一致。（→ Step 4）
- T-XN5 — blocking: yes — 匹配失败（原文不在文档）→ 无 mark，条目仍在（壳层测或契约说明）。（→ Step 2/3）
- T-XN6 — blocking: yes — 同文两处命中均标记；长串优先。（→ Step 5）
- T-XN7 — blocking: no — 真机/桌面跨节点点选打开批注。（→ Step 6）

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 扁平串与选区空白不一致 | 拆开 needle trim vs segment 1:1；Core 共用 helper | 恢复单 Text wrap |
| 跨 p / 单元格误命中 | D1 切断匹配域；T-XN1b | 同上 |
| 多段 wrap 破坏富文本结构 | unwrap+normalize；测列表/标题；右到左或批量句柄 | 同上 |
| 旧 200×findFirst 漏标/误模型 | D5 废弃该模型 | — |
| 误上 CSS Highlight | D6 明确本期不做 | — |

不迁 WebView；不改 annotate 附件协议。
