# CR Fix Spec: agent-tabs-and-subagent-stream

## 元信息

- repo：`D:\Dev\nm-worktree\agent-tabs`（分支 `feature/agent-tabs-and-subagent-stream`）
- base_sha / head_sha：`15d8f20d` / `ba996611`（真实 HEAD 以 `git log -1` 为准）
- prd_path：`docs/Iterations/agent-tabs-and-subagent-stream/prd.md`（总纲）+ `features/agent-config-tabs/prd.md` + `features/subagent-stream-toggle/prd.md`
- spec_path：`features/agent-config-tabs/spec.md` + `features/subagent-stream-toggle/spec.md`
- review_round / dag_version：2（round 1 双 scope 评审 → 主代理 spec-fix 落盘本文件 → round 2 review-full 收口）/ 2
- 状态：已确认执行（用户 2026-09-29 拍板：经 code-dev-loop 执行；deviation 按现状收窄并追加 f1/A-002、f1/A-003）

## Must-fix（P0 × 0；P1 × 2；P2 × 5）

### f1/B-001 [P1] general 只读态可经「常驻工作区」卡的全屏编辑绕过
- 维度：B（辅 A/G）
- 文件：`apps/desktop/renderer/features/settings/AgentWorkplaceBlockCard.tsx:59-63`
- 问题：该卡内 `PromptCollapsibleField` 未透传 `disabled`——同卡 Switch（:46）与 textarea（:67）均已接 disabled，唯此组件漏接。general 只读态下「全屏编辑」按钮仍可打开 Modal、改草稿、保存回填 `onAssistantTextChange`，表单 state 被实际修改（dirty 变 true）。数据不会落库（总保存按钮已禁用），故 P1 而非 P0。6d2c289b 的堵口只覆盖 AgentEditorView 直接渲染的三处，漏了这张卡内部这处；对照 mobile 同位置（ExpandablePromptInput 已禁用且有测试断言）构成双端不一致，违反 PRD 核心需求 3 / 验收 4「全部控件禁用」。
- 改法：`AgentWorkplaceBlockCard.tsx:59` 的 `PromptCollapsibleField` 增加 `disabled={disabled}`（组件已支持该 prop：`PromptCollapsibleField.tsx:25/33/66`）。
- 验收/测试：`apps/desktop/test/settings-agents-tabs.test.ts` 补源码断言——AgentWorkplaceBlockCard.tsx 中 PromptCollapsibleField 节点带 `disabled={disabled}` 透传；桌面手动走查 general 详情 → 常驻工作区卡「全屏编辑」按钮灰显且不可点。
- 来源：review-scope-f1 / round 1（主代理已亲核实现现场）

### f1/G-001 [P1] e2e「无保存按钮」断言与 desktop 实现相反，桌面回归必红
- 维度：G（辅 A）
- 文件：`scripts/e2e/case-agents-tabs.mjs:52-62`
- 问题：步骤 5 的 `noSave` 断言要求 settings-view 内**不存在**文本为「保存」的按钮；而 desktop 实现与 spec 变更点 7 均为「保存按钮**保留渲染但禁用**」（`AgentEditorView.tsx:716` `disabled={saving || isBuiltin}`、`:719` 文本「保存」）。该 e2e 由 f41abe7f 提交于 6d2c289b 方案变更**之前**，后者同步了单测与文档但漏改 e2e；因从未真跑（仅 syntax-checked）未暴露。
- 改法：`noSave` 语义改为「保存不可用」：`const saveBtn = [...document.querySelectorAll(".settings-view button")].find((b) => b.textContent?.trim() === "保存"); saveDisabled: !saveBtn || saveBtn.disabled === true`，断言改为 `ro.builtinNotice && ro.saveDisabled`（按钮不存在时亦通过，兼容 mobile 式无保存栏语义）。
- 验收/测试：桌面回归真跑 `case-agents-tabs.mjs` 全绿、`AGENTS_TABS_OK` 输出正常；断言失败仍非零退出（既有静默假绿防护保持）。
- 来源：review-scope-f1 / round 1（主代理已亲核实现现场）

### f1/A-001 [P2] spec/PRD 残留旧「只读卡片」表述，文档与实现不自洽
- 维度：A
- 文件：`docs/Iterations/agent-tabs-and-subagent-stream/features/agent-config-tabs/spec.md:45、:65`（另 `:74`「只读详情」措辞顺带）；同目录 `prd.md:60`
- 问题：6d2c289b 的文档补丁（2 prd 行 + 5 spec 行）只改了部分段落，残留：① spec:45 结构树仍写「`AgentEditorScreen.tsx [改] sentinel 分支渲染 BuiltinAgentDetail`」——该文件已在 6d2c289b 删除；② spec:65 变更点 10 仍引用「`AgentEditorScreen.tsx + BuiltinAgentDetail.tsx`……只读呈现」；③ prd:60 验收 4「无保存入口」与核心需求 3 拍板措辞矛盾（desktop 保存按钮保留但禁用、mobile 不渲染保存栏）。
- 改法：spec:45 改为「`AgentEditorScreen.tsx [改] sentinel 分支渲染 AgentEditorForm readOnly + initialDefinition`」；spec:65 变更点 10 改写为「mobile：AgentEditorForm readOnly 全字段禁用、不渲染保存栏；desktop：完整表单全控件 disabled、保存按钮保留但禁用」，去掉 BuiltinAgentDetail 引用；prd:60「无保存入口」改为「保存不可用（desktop 保存按钮保留但禁用、mobile 不渲染保存栏）」；spec:74「只读详情」改「只读编辑器形态」。
- 验收/测试：改后全仓 `git grep BuiltinAgentDetail` 仅剩 `apps/mobile/__tests__/agent-editor-form-dirty.test.tsx` 的历史注释（可顺手改为「替代原独立只读卡片」）。
- 来源：review-scope-f1 / round 1

### f1/A-002 [P2] spec 变更点 8 按现状收窄（用户拍板 2026-09-29）
- 维度：A
- 文件：`docs/Iterations/agent-tabs-and-subagent-stream/features/agent-config-tabs/spec.md`（变更点 8）
- 问题：spec 变更点 8 写「菜单仅『查看』」，mobile 实现为整行点击进详情、不渲染行内菜单（desktop 行则保留 ⋮ 菜单仅「查看」）。PRD 行为要求（可见、可进、不可删）均满足。用户拍板**按现状收窄**。
- 改法：变更点 8 文字改写为「mobile：整行点击进入只读详情，不渲染行内菜单；desktop：保留行内菜单，仅『查看』」。
- 验收/测试：文档改动，人工核对语义与双端实现一致。
- 来源：round 1 spec_deviation → 用户 2026-09-29 拍板收窄

### f1/A-003 [P2] general 合成行描述缩短为单行（用户实测反馈 2026-09-29）
- 维度：A（辅 J）
- 文件：`apps/mobile/src/components/agent/AgentList.tsx:87`（`meta: DEFAULT_SUBAGENT_DEFINITION.description ?? ''`）；`apps/desktop/renderer/features/settings/SettingsViews.tsx:914`（`{DEFAULT_SUBAGENT_DEFINITION.description ?? "—"}`）
- 问题：双端 general 合成行描述直接用完整 description（「通用助手，可以读写文件、搜索内容，完成主代理委派的任务。」28 字），mobile 行 meta 允许两行（AgentList.tsx:450 `numberOfLines={2}`）导致该行占多行，与其他 agent 行（模型 · 步数，单行）不一致；用户反馈「就 general 的卡片描述长，和其他卡片只占一行不一样」。
- 改法：**行内**描述双端统一换短文案「通用助手 · 不可编辑」（双端各自在合成行定义处用字面量 + 注释「双端文案对齐」，不动 `DEFAULT_SUBAGENT_DEFINITION.description` 本体）；mobile 行 meta 天然回到单行（numberOfLines 不必改）。**编辑器详情页保留完整 description**（mobile initialDefinition / desktop applyDefinition 现状不动）。
- 验收/测试：mobile `agent-list-tabs.test.tsx` 断言 general 行内含「通用助手 · 不可编辑」且不含「读写文件」长文案；desktop `settings-agents-tabs.test.ts` 同口径源码断言；双端详情页仍显示完整描述（既有测试覆盖则不重复加）。
- 来源：用户 2026-09-29 deviation 拍板时追加

### f1/C-001 [P2] 「全部」徽标判定：mobile 失效行不显示，与 desktop 不一致
- 维度：C（辅 A）
- 文件：`apps/mobile/src/components/agent/AgentList.tsx:102-104`；对照 `apps/desktop/renderer/features/settings/SettingsViews.tsx:940/952`
- 问题：desktop 徽标条件 `row.mode == null || row.mode === "all"` 对 invalid 行（DTO 无 mode）显示「全部」徽标；mobile `isAllModeRow` 带 `row.def != null` 守卫，invalid 行（无 def）**不显示**。双端行为不一致（PRD 验收 9），且「读不到作用域按『全部』呈现」的口径（PRD 验收 7）在 mobile 失效行上未贯彻；判定逻辑双端各自内联、写法不一致。
- 改法：`isAllModeRow` 去掉 def 守卫：`return (row.def?.mode ?? 'all') === 'all';`（与 desktop 语义对齐）。
- 验收/测试：`apps/mobile/__tests__/agent-list-tabs.test.tsx` T-M1 补断言——`agent-bad`（invalid）行内文本含「全部」徽标；desktop 行为不变（T-D1 已锁 mode 缺省语义）。
- 来源：review-scope-f1 / round 1

### f2/G-1 [P2] 子会话流式容错分支的测试覆盖只有一半，回退日志无断言
- 维度：G
- 文件：`packages/core/test/service/agent/run-agent-turn-subagent-stream.test.ts`（对照实现 `packages/core/src/service/agent/logic/run-agent-turn.ts:864-871`）
- 问题：实现 catch 有两条路径——`PreferencesError` 吞掉回退 true（T-S4 已用真实 KKV 直写脏值覆盖）、非 `PreferencesError` 时 `throw cause` 重抛（`run-agent-turn.ts:869`）。重抛分支零用例：把 `:869` 整行删掉（吞所有错误静默回退），T-S1~T-S4 全绿不红。另 T-S4 只断言「回退 true 且不炸」，未断言回退日志——先例 `packages/core/test/agent/agent-runner.test.ts:1693-1764`（MF-3，注意在 `test/agent/` 目录、与目标测试文件 `test/service/agent/` 不同目录）劫持 `console.error` 断言了标签日志，本测试相对先例少一档。
- 改法：同一测试文件补用例 T-S5：`makeRuntime` 注入 `preferences: { getSubagentStreamEnabled: async () => { throw new Error("boom"); } }`（非 PreferencesError），锁重抛分支。**断言口径（实现时 spike 实证修正）**：重抛的异常会被 `toolRunner`（`domain/tool/logic/tool-runner.ts:117-126`，单工具失败捕获不外抛的设计）包成 ToolError 转为失败 tool_result 回流主 run，`runAgentTurn` 不会整体拒绝——故断言三件可观察事实：① 主 run 正常完成（stopReason=completed）；② 恰好 2 次 model 调用（重抛发生在子 `runner.run` 之前，子 run 从未启动）；③ boom 以失败 tool_result（`Error: boom`）出现在主 run 第 2 次请求输入中。T-S4 增强为照 MF-3 模式临时替换 `console.error`、断言 tag `"[agent-run] subagentStream pref read failed"` 被调用一次、`finally` 恢复原函数。
- 验收/测试：删除实现 `:869` 重抛行后 T-S5 三条断言必红（boom 被吞 → 子 run 启动消费响应 → ①②③ 全红）；删除实现 `console.error` 后 T-S4 增强断言必红。跑法（core 包内）：`npm run test:fast -- test/service/agent/run-agent-turn-subagent-stream.test.ts`。
- 来源：review-scope-f2 / round 1（主代理已亲核实现与测试现场）

## Spec deviations

- **mobile general 行无 ⋮ 菜单**：spec 变更点 8 写「菜单仅『查看』」，实现为整行点击进详情、不渲染行内菜单（T-M3 断言「无删除菜单项」兼容）。PRD 行为要求（可见、可进、不可删）均满足——**用户 2026-09-29 拍板按现状收窄**（顺带追加行描述缩短需求 f1/A-003）；spec 文字改写已落为 must-fix f1/A-002。
- T-M2 并入 agent-list-tabs.test：**fixed**（spec 括号备选允许，dev-loop 已确认）。
- T-D1 实测 3 用例（spec 要求 2）、T-M1 实测 2 用例（spec 要求 1）：正向超出，非偏离。

## Open questions / 待拍板

1. 孙代理递归非流式目前靠代码结构保证（各层闭包同一 runtime）+ Step 6 手动验收，spec 测试矩阵未列自动用例——是否补三层递归用例，待用户拍板。
2. 回退日志形态（文本 tag + error）与 MF-3 先例（结构化 payload `{stage,key,code,fallback,error}`）不一致——spec 变更点 5 明文写的是现形态，实现忠实于 spec；若要观测口径统一属 spec 层取舍，不改实现不算错。
3. `persistent-preferences.port.ts:25` 与 `preference-keys.ts` 对 thinkingContext 注释写「默认 true」、impl 实际 `getBooleanPref(key, false)`（**预存偏差，BASE 已在，非本迭代引入**）——建议 K 类收尾顺手修正。
4. 杂项（均不阻塞）：desktop 批量模式下 general 行 ⋮ 仍可见（形态不一致、无数据风险）；e2e 步骤 3（主 tab 无 general 行）只 console.log 无硬断言；`AgentDefinitionEditorForm.tsx` 预存死代码（1010 行，全仓无引用）是否顺带清理；sentinel `"general"` 魔法值 4 处散布（spec 本身规定字面量判断，未来可统一引用 `DEFAULT_SUBAGENT_DEFINITION.name`）；`AgentsSettingsScreen.handleCreate` 的 tab→mode 映射无直接单测（链路两端已测，中间是三目表达式）。
5. mobile `SegmentedControl` 组件无任何无障碍属性（desktop 对应组件内建 role/aria-pressed）——既有共享组件的预存缺失，本 diff 新增的 agent tab 使用点（AgentList.tsx:313）放大了暴露；修它要触达全部既有使用点，超出本迭代范围，记入后续迭代（round 2 review-full 新增）。
6. `persistent-preferences.port.ts:18-19` 新方法注释为英文——逐字跟随同文件 `getLlmStreamEnabled`（:11-12 同为英文）的直接先例，同文件中文注释属预存混排；保持不动（round 2 review-full 建议，不改）。

## 已豁免（用户确认不修）

（无）

## 合并后 QA（manual_user）

- f2 Step6 手动验收：关「子会话流式」→ task 子会话无逐字输出、生成期间终止行为、重启保留（dev-loop 遗留项，合并后用户验收）。
- f1 Step5 补全走查：过滤矩阵 / invalid 行双边显示 / 批量选择按 tab 独立（用户已真机主测过主体功能）。
- `case-agents-tabs.mjs` 随桌面回归真跑（f1/G-001 修复后）。

## K 节建议（下游执行时闭合）

- thinkingContext 预存注释偏差修正（见 Open questions 3，改 port 注释与 keys 注释为「默认 false」对齐 impl）。
- 本 fix-spec 执行提交前：core `npm run test:fast`（定向三文件）+ desktop `node scripts/run-tests.mjs`（定向）+ mobile `npx jest`（定向）复跑；提交信息按仓库惯例，主代理统一提交（子代理禁 git 写）。

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | **yes**（用户 2026-09-29 已确认执行：code-dev-loop） |
| fix_spec_path | docs/Iterations/agent-tabs-and-subagent-stream/cr-fix-spec.md |
| dag_version / review_round | 2 / 2（用户拍板后追加 A-002/A-003，未新增审查轮） |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 2 / 5（P1：f1/B-001、f1/G-001；P2：f1/A-001、f1/A-002、f1/A-003、f1/C-001、f2/G-1） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none open（general 菜单形态经用户 2026-09-29 拍板按现状收窄 → f1/A-002 落文字；其余 fixed） |
| C-orch | ✅（过滤/常量/通道单点化，两 feature 共享文件 ipc-types/handler-registry/invoke-registry/client 分区无踩踏——round 1 + round 2 双确认） |
| C 类合并后 QA | 不为空：f2 Step6 手动验收、f1 Step5 补全走查、case-agents-tabs.mjs 随桌面回归真跑（见上文专节） |

评审轮次记录：round 1 = review-scope-f1 + review-scope-f2 并行（not-ready：5 must-fix）；round 2 = review-full（建议 ready；五条行号逐条复核吻合、D/E/F/H/I/J/K 七维与跨 scope 零新 must-fix；纠 1 处 MF-3 先例目录前缀笔误、增 2 条 open 观察）。主代理对全部 5 条 must-fix 均已行号级亲核现场。真实 HEAD 以 `git log -1` 为准（本表以 ba996611 评审）。
