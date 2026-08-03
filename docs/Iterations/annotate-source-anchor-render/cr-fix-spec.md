# CR Fix Spec: annotate-source-anchor-render

## 元信息

| 字段 | 值 |
|------|-----|
| repo | novel-master |
| base_sha | `ee52c5b5ce74e6fdd68846ef5e0b394c64fbb00e` |
| head_sha | `c619ac35384c5a05479276a344d548abce4ebf8b` |
| prd_path | `.apm/kb/docs/Iterations/annotate-source-anchor-render/prd.md` |
| spec_path | `.apm/kb/docs/Iterations/annotate-source-anchor-render/spec.md` |
| review_round | 2 |
| dag_version | 3 |
| 状态 | **draft**（主代理宣布 ready 前保持 draft） |
| 审查说明 | 审查含 working tree 未提交 Recogito UX 改动 |

## Must-fix（按 P0 → P1 → P2）

### desktop/A-1 [P0] mouseup 直开 AddModal，违背显式批注合同

- 维度：A
- 文件：`apps/desktop/renderer/layout/PreviewPane.tsx`；连带 `PreviewAnnotateUi.tsx`、`preview-annotate.test.ts`
- 问题：`annotatingEnabled: false` 已设，但 `mouseup` 有选区就 `setAddOpen(true)`：普通划词复制也会弹添加批注；与 `selectionChanged` 开详情竞态（Add/Detail 双开）。违背 SPEC R6/R9（显式批注、与 Mobile 合同一致：保留复制）。
- 改法：恢复显式创建入口（优先接回 `PreviewAnnotateFloatingBar`「添加批注」）：`mouseup` 只更新 pending 选区/浮动条，禁止直接开 AddModal；点「添加批注」才开；`selectionChanged` 命中已入库 draft 时只开详情并 `setAddOpen(false)`。同步修正「Pane 不得含 FloatingBar」的断言。
- 验收/测试：源码/测例断言 `mouseup` 不直接 `setAddOpen(true)`；FloatingBar（或等价显式入口）存在；复制路径不弹 AddModal。
- 来源：review-scope-desktop round1

### mobile/B-1 [P1] quote.trim 与 renderStart/End 量测不对齐

- 维度：B
- 文件：`apps/mobile/src/web/rich-document/webview/runtime/annotate-collect.ts`（`reportRecogitoCreateFromSelection`）；连带 `FileMarkdownPreview.handleRecogitoCreate`
- 问题：`quote.trim()` 但 `renderStart`/`renderEnd` 按未 trim Selection 量测，首尾空白时不对齐 R4（`bodyText.slice(start, end) === quote`）。
- 改法：二选一钉死：(a) 不 trim；或 (b) trim 后按 leading/trailing 空白收缩 `start`/`end`，使 `bodyText.slice(start, end) === quote`。宿主勿二次 trim。补单测带空白选区。
- 验收/测试：带首尾空白的 Selection 用例通过；写入草稿后 `slice(renderStart, renderEnd) === originalText`（quote）；宿主侧无二次 trim。
- 来源：review-scope-mobile

### desktop/B-2 [P1][B] quote.trim 与 renderStart/End 不对齐（Desktop 采集）

- 维度：B
- 文件：`apps/desktop/renderer/layout/preview-recogito.ts`（`getSelectionOffsetsInElement`）；连带 `PreviewPane` mouseup 写入路径；测例 `preview-recogito-md.test.ts`
- 问题：WT 对 quote 做 `.trim()`，但 `renderStart`/`renderEnd` 仍按未 trim 的 `selectedLen` 量测，与 mobile/B-1 同构，违背 R4（`slice(start, end) === quote`）。
- 改法：与 mobile/B-1 同策二选一钉死——(a) 不 trim；或 (b) trim 后按 leading/trailing 空白收缩 `start`/`end`。AddModal/`originalText` 勿再二次 trim。建议与 mobile 选同一策略。
- 验收/测试：带首尾空白选区；`bodyText.slice(renderStart, renderEnd) === quote`；单测锁定。
- 来源：review-full round2（WT）

### desktop/B-1 [P1] 开详情后未 cancelSelected，二次点击卡顿

- 维度：B
- 文件：`apps/desktop/renderer/layout/PreviewPane.tsx`
- 问题：开已有详情后未 `cancelSelected()`；二次点击同批注常不触发 `selectionChanged`（R9 vs Mobile）。
- 改法：`onSelectionChanged` 开详情后 `try { anno.cancelSelected() }`；关闭详情/挑选时也可清选中。
- 验收/测试：源码断言开详情后调用 `cancelSelected`；二次点击同高亮仍能打开详情（或测例锁调用点）。
- 来源：review-scope-desktop

### desktop/C-orch-1 [P1] getSelectionOffsetsInElement 平行实现

- 维度：C-orch
- 文件：`apps/desktop/renderer/layout/preview-recogito.ts`、`preview-annotate.ts`
- 问题：两处同名 `getSelectionOffsetsInElement` 平行实现（返回形状不同）。
- 改法：权威实现钉在 `preview-recogito.ts`（WT 后 Pane 已 import 该侧）；`preview-annotate.ts` 委托 / re-export，或删除重复。单测锁定一致。
- 验收/测试：仅一处权威实现（`preview-recogito.ts`）；单测断言两路径（或委托后）offset/quote 一致。
- 来源：review-scope-desktop

### desktop/C-1 [P1] FloatingBar 死代码或随 A-1 恢复接线

- 维度：C
- 文件：`apps/desktop/renderer/layout/PreviewAnnotateUi.tsx`、`shell.css`
- 问题：FloatingBar 从 Pane 摘掉后组件/CSS 死代码；或随 A-1 恢复接线。
- 改法：随 A-1 恢复接线；若产品坚持无浮动条则删除 FloatingBar+CSS 并改注释（须用户收窄 R6，当前按恢复接线写）。
- 验收/测试：FloatingBar 在 MD 有选区时可见并可点「添加批注」开 AddModal；或（仅在用户书面收窄后）确认零引用并删除组件/CSS。
- 来源：review-scope-desktop

### desktop/G-1 [P1] T-RG6 未钉 R6 行为与生命周期

- 维度：G
- 文件：`preview-recogito-md.test.ts`（及必要时 `preview-annotate.test.ts`）
- 问题：T-RG6 未钉 R6：无 `annotatingEnabled: false`；无「非 mouseup 直开 Add」/显式入口；无 `cancelSelected`/`destroy`。
- 改法：补源码断言如上。
- 验收/测试：测例断言 `annotatingEnabled: false`；mouseup 不直开 Add；存在显式入口；存在 `cancelSelected`/`destroy` 相关断言。
- 来源：review-scope-desktop

### core/C-1 [P1] 「预览用」注锚文案与 R5 冲突

- 维度：C
- 文件：`annotate-source-anchor.ts`、`public/chat.ts`；连带 `annotate-source-range.ts` 模块头
- 问题：仍写「预览用」注锚；与 R5/render 坐标权威冲突。
- 改法：可暂留函数；JSDoc/导出说明钉死「非预览投影合同；宿主 MD/plain 预览主路径禁止调用」。改写 range 头「预览锚注入见…」导向。不要求本轮删除实现。
- 验收/测试：源码/文档字符串检索无「预览用」误导措辞；明确禁止宿主预览主路径调用。
- 来源：review-scope-core

### mobile/C-orch-1 [P2] selectionCollect 平行入口遗留

- 维度：C-orch
- 文件：`annotate-collect.ts`、`RichDocumentBridge`
- 问题：遗留 `selectionCollect` / `__nmCollectAnnotateSelection` 平行入口。
- 改法：生产只挂 Recogito 采集；旧 collect 删或测试专用；bridge deprecate 或移出主联合类型。
- 验收/测试：生产路径无旧 collect 挂载；bridge 主类型不再暴露生产用旧入口（或标 `@deprecated` 且测试专用）。
- 来源：review-scope-mobile

### mobile/A-1 [P2] 旧锚/marks 样式与死模块

- 维度：A
- 文件：`document.css`；`annotate-marks.ts` + 测例
- 问题：旧锚/marks 样式；`annotate-marks.ts` + 测例主路径未 import。
- 改法：确认零引用后删或 `@deprecated`；CSS 去掉应急块或注明非主路径。
- 验收/测试：主路径无 import/引用；CSS 无误导性主路径应急块（或明确标注非主路径）。
- 来源：review-scope-mobile

### mobile/G-1 [P2] 缺 reportRecogitoCreateFromSelection 行为测

- 维度：G
- 文件：Mobile 相关单测（`annotate-collect` / recogito create 路径）
- 问题：缺 `reportRecogitoCreateFromSelection` 行为测（含 B-1 空白选区）。
- 改法：补 DOM Selection 单测（含首尾空白场景，与 mobile/B-1 对齐）。
- 验收/测试：单测覆盖正常选区与带空白选区；断言 quote 与 `renderStart`/`renderEnd` 一致。
- 来源：review-scope-mobile

### desktop/C-2 [P2] draftId={null} 恒传无意义

- 维度：C
- 文件：`PreviewPane.tsx`
- 问题：`draftId={null}` 恒传。
- 改法：去掉无意义 prop 或真正接入 draft id。
- 验收/测试：无恒 `null` 的死 prop；或接入真实 draft id 且测例覆盖。
- 来源：review-scope-desktop

## Spec deviations

| id | 状态 | 说明 |
|----|------|------|
| desktop-create-path | **open** → 由 **desktop/A-1** 闭合 | Desktop：`mouseup` → 直开 AddModal，与 SPEC R6/R9（显式批注、保留复制、与 Mobile 一致）偏离。闭合方式见 must-fix `desktop/A-1`。 |

## Open questions / 待拍板

> 附录：不阻塞 must-fix 写入；实现前或实现中按需拍板。

| id | 问题 |
|----|------|
| core/Q-1 | `annotate-source-range`「写入权威」措辞是否加「非预览投影」 |
| core/Q-2 | 同时带 render + 旧 offset 的 XML round-trip 是否补测 |
| mobile/Q-1 | Android 点「批注」后选区是否仍在（T-RG7） |
| mobile/Q-2 | 超限/无 html 时 `annotateEnabled` + plain 挂 Recogito 是否接受 |
| desktop/Q-1 | 遗留搜字栈删还是 `@deprecated` |
| desktop/Q-2 | 若坚持无 FloatingBar，需用户书面收窄 R6/R9 |
| desktop/Q-3 | desktop/B-2 与 mobile/B-1 是否强制同一 trim 策略（建议同，不强制不阻塞） |

## 已豁免（用户确认不修）

（无。本 round 未收到用户确认豁免项。）

## 合并后 QA（manual_user）

> 不阻塞 must-fix 写入与实现合并；真机由用户执行。

- **T-RG7 真机**：MD 划词、复制不弹批注、显式批注、重开投影、标题不破坏、plain 无入口、二次点击高亮不卡顿。

## K 节建议（下游执行时闭合）

- 提交未提交 working tree（含 Recogito UX 改动）
- lint / format
- 文档与注释同步（含 core JSDoc、死代码清理说明）
- 可选：`apm kb index` rebuild

## 相对上轮

- 新增 **desktop/B-2**（quote.trim 与 renderStart/End 不对齐，Desktop 采集；与 mobile/B-1 同构）
- **desktop/C-orch-1** 权威侧钉死为 `preview-recogito.ts`
