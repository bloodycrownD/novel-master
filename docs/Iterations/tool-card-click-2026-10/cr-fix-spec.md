# CR Fix Spec: 工具卡片点击完善（feat/tool-card-click-2026-10）

## 元信息
- repo: D:\Dev\nm\tcr（worktree，分支 feat/tool-card-click-2026-10）
- base_sha: 930fc1296（main）
- head_sha: e2caa8edc（CR 修复轮；真实 HEAD 以 `git log -1` 为准）
- prd_path / spec_path: 未提供（简化迭代，按提交信息与代码现状评审）
- review_round: 1 / dag_version: 1
- 状态: **已执行**（2026-10-04 提交 e2caa8edc，六条全落地）

## Must-fix（P2×6，按执行顺序建议排列）

### CR-1 [P2] webview「可读结果」判定单源化 + trim 口径统一
- 维度：C-orch / B
- 文件：`apps/mobile/src/web/chat-transcript/webview/runtime/render/rows-click.ts:89-94`；`apps/mobile/src/web/chat-transcript/webview/ui/render/ToolGroup.tsx:60-64`
- 问题：`ToolGroup` 用 `pickReadable`（trim 判空）+ summary 回落判可读；`rows-click` 用 `resultContent !== ''`（**不 trim**）取正文。`resultContent` 为纯空白串且 `summary` 有信息时，渲染侧判「可读」挂 `data-action`，点击侧却把空白串当正文上抛——阅读页一片空白、summary 丢失（渲染键/读取键口径不一致，ucu P0 同族）。同一判定在 webview 内两份 + desktop `toolResultViewFor` 第三份（trim 口径）。
- 改法：webview runtime 新导出纯函数 `readableToolResult(tool: ToolCallRow): string | undefined`（内部 `pickReadable(resultContent) ?? pickReadable(summary)`，建议落 `runtime/render/tool-logic.ts`——该文件已是 webview 侧工具摘要逻辑的家）；`ToolGroup` 的 `hasResult` 与 `rows-click` 的 content 都改为调用它，删两处内联判定。
- 验收/测试：`rows-click-tool-result.test.ts` 补两条——① `resultContent: '   '`（纯空白）+ `summary: '0 entries'` → 上抛 content=`'0 entries'`；② 纯空白 + 无 summary → 不上抛。变异拔牙：改 readableToolResult 去掉 summary 回落 → ①红。
- 来源：review-full（diff 模式）round 1

### CR-2 [P2] 「工具结果」默认标题双写收敛
- 维度：C-orch
- 文件：`apps/mobile/src/web/chat-transcript/webview/runtime/render/rows-click.ts:97`；`apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts:787`
- 问题：`rows-click` 已有 `row.name || '工具结果'` 兜底，`openToolResult` 又做一次 `payload.title === '' ? '工具结果' : ...`——同一兜底两个协调点各写一遍，任一侧改口径即分叉。
- 改法：删 `useChatTabScope.openToolResult` 的重复兜底，直接用 `payload.title`（webview 侧已保证非空，数据源就近兜底）。
- 验收/测试：现有 T-TRW1 仍绿（title 走 webview 侧兜底）；人工复核 useChatTabScope 无残留兜底分支。
- 来源：review-full round 1

### CR-3 [P2] ToolGroup 渲染分支补 vnode 直调用例（产出侧守门）
- 维度：G
- 文件：`apps/mobile/src/web/chat-transcript/webview/ui/render/ToolGroup.tsx:60-97`
- 问题：T-TRW1~6 全在消费侧（rows-click），T-TRB 只断言产物字符串存在。`hasResult` 计算与 `data-action`/`data-tool-use-id` 产出无断言——若渲染分支回退（忘输出 `data-tool-use-id`），现有测试照绿，真机表现为「卡片能点但没反应」。
- 改法：仿 `apps/mobile/__tests__/collapsible-section-classes.test.tsx` 的函数组件直调取 vnode 模式，新建 `apps/mobile/__tests__/tool-group-open-result.test.tsx`：① fs/search 卡（无 filePath/skillRef、有 resultContent）→ 子项 `data-action === 'open-tool-result'` 且 `data-tool-use-id` 等于该 tool 的 toolUseId；② 有 filePath（read）→ `data-action === 'open-tool-file'` 非 open-tool-result；③ 有 skillRef → 'open-skill'；④ content 空+summary 有 → 仍可点（CR-1 联动）。
- 验收/测试：新文件随 mobile jest 进绿；拔牙：去掉 `data-tool-use-id` 输出 → ①红。
- 来源：review-full round 1

### CR-4 [P2] desktop 监听壳（ToolResultViewerModal）补 TestRenderer 用例
- 维度：G
- 文件：`apps/desktop/renderer/features/chat/ToolResultViewer.tsx:98-124`
- 问题：`dispatchOpenToolResultView` → CustomEvent → `setTarget` 这段若事件名两侧写错将静默失效（永远打不开），无守门；仓内 harness 现成（`test/settings-overlay-request-close.test.tsx`）。
- 改法：照该先例 `TestRenderer.create` + `act` 挂 `ToolResultViewerModal`（注入可捕获 `OPEN_TOOL_RESULT_EVENT` 的假 window 或用 globalThis.window stub），`dispatchOpenToolResultView({title:'fs', content:'x'})` 后断言 `role="dialog"` 与标题 `fs` 出现；Esc keydown 后消失。
- 验收/测试：随 desktop `npm test` 进绿；拔牙：改错事件常量 → 红。
- 来源：review-full round 1

### CR-5 [P2] isFsLsOutput / formatFsLsOutput 改名 isEntriesListOutput / formatEntriesListOutput
- 维度：C（命名）
- 文件：`packages/core/src/domain/tool/logic/format-tool-output.ts:159,182`
- 问题：该分支现同时服务 fs ls、skill list、agent list 三种输出，函数名与 formatEntryLine 注释（「共用本分支」）自相矛盾，后来者按名字读会误判作用域。
- 改法：私有函数改名 `isEntriesListOutput` / `formatEntriesListOutput`（仅本文件 2 处调用+1 处判定），formatEntryLine 的注释合并进 formatEntriesListOutput 函数注释。
- 验收/测试：core `npm test` 全绿（FMT-LIST-01~03 断言零改动）。
- 来源：review-full round 1

### CR-6 [P2] 本次新引入的 prettier 不合规两文件定点格式化
- 维度：K（格式收尾）
- 文件：`apps/mobile/src/components/chat/ChatTranscriptBridge.ts:243-247`；`apps/mobile/__tests__/rows-click-tool-result.test.ts:43-51`
- 问题：`BridgeEnvelope<'openToolResult', …>` 拆 4 行（prettier 折单行）；测试文件 cast 换行不合 prettier。经 base/head blob 对比确认是本次新引入（mobile format:check 在 base 已有既存红，非新增 CI 破坏，属本次自带来的欠账）。
- 改法：`cd apps/mobile && npx prettier --write src/components/chat/ChatTranscriptBridge.ts __tests__/rows-click-tool-result.test.ts`——**只这两个文件**，勿整仓格式化（既存红不扩散进本 diff）。
- 验收/测试：`npx prettier --check <两文件>` 通过；`git diff` 确认格式化未触碰其他行。
- 来源：review-full round 1

## Spec deviations
- none（四条功能语义逐条核对均已落地；专属跳转优先级链由 T-TR8 锁住无回归）

## Open questions / 待拍板
1. **阅读页伪 path key 唯一性**：`turnId = tool-result-${title}`（title=工具名）→ 同工具多个结果共用同一 key。当前不串内容（navigate 新屏实例 + take 语义读后即清 + renderKind=txt 不走 WebView 的 path 扩展判定）；要唯一化需多传一个 toolUseId 过桥字段。**默认维持现状**，要改请说一声。
2. **阅读页标题同工具同名**：多个 fs 结果标题都是「fs」，无法区分；可带 path/摘要首行（webview 侧 title 拼装点在 rows-click）。产品决策，待拍板。
3. **skill/agent list 条目的 domain/mode 等字段不进 LLM 文本**（修复前同样全丢，非本次回归）：是否补进 formatEntryLine 属 scope 外产品决策。

## 已豁免（用户确认不修）
- （无）

## 合并后 QA（manual_user）
- 真机点开一张 fs 空目录卡（content 空+summary "0 entries"）→ 阅读页显示 "0 entries"（CR-1 验收的实机面）
- 真机点 skill list 新调用卡 → 正文「名字\t描述」非 undefined

## K 节建议（下游执行时闭合）
- CR-6 的定点 prettier（已列 must-fix）
- 提交信息例行核对（无新增）

## Fix-Spec Closure（已执行回填）
| 项 | 状态 |
|---|---|
| fix-spec-ready | yes（round 1 单轮 diff 评审即 ready） |
| fix_spec_path | docs/Iterations/tool-card-click-2026-10/cr-fix-spec.md |
| dag_version / review_round | 1 / 1 |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 0 / 6 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none |
| C-orch | ✅（CR-1/CR-2 已收敛落地） |
| C 类合并后 QA | 两条（真机面：fs 空目录卡点开显示 "0 entries"；skill list 新调用卡正文非 undefined） |
| **执行** | ✅ 提交 e2caa8edc（2026-10-04）：CR-1 readableToolResult 单源化（T-TRW7/8 新用例）、CR-2 标题收敛 webview 侧、CR-3 tool-group-open-result.test.tsx（T-TGO1~5）、CR-4 tool-result-viewer-modal.test.tsx（T-TRM1~3）、CR-5 改名 isEntriesListOutput/formatEntriesListOutput、CR-6 prettier 定点两文件。变异拔牙 M7/M8/M9 全红实证。门禁：core 56/56、desktop 27/27、mobile 46/46、mobile typecheck 三段 0 错 |
