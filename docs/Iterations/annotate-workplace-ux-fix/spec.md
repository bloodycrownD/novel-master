---
date: 2026-07-23
---

# annotate-workplace-ux-fix 技术规格（SPEC）

## 设计目标

落实 `Iterations/annotate-workplace-ux-fix/prd.md` 三项交付：

1. **表格跨格 / 整行 / 整表批注高亮**：在既有「扁平索引 + 多段 mark」上，将匹配域从「按单元格切断」调整为「表内单域」，并归一选区分隔符，使跨格连续选区尽量呈现视觉连续下划线；双端同合同。
2. **Mobile FileEditor 工具栏文件名居中**：修复预览/未聚焦态漏挂 `textAlign: 'center'` 的回归。
3. **常驻工作区**：`prompts.workplace` 升级为 `boolean | string`（兼容 `true`）；assistant 确认语可配；user 侧常驻正文外层 `<workplace>` 包裹；Agent 编辑器对齐 system 块（开→输入框、禁止空、默认 `i have seen workplace`）；**不**恢复消息增量 `<workplace>`；**不**改 tool-turn bridge 与常驻文案联动。

需求来源：`Iterations/annotate-workplace-ux-fix/prd.md`  
前置：`annotate-cross-node-highlight`、`ux-polish-macro-editor-workplace`、`agent-worktree-block-ui`、`annotate-user-ops-unify`

## 总体方案

### A. 批注表格连续高亮

**方案：TABLE 级单域 + needle 去分隔符 + 表内跳过纯空白 Text。**

| ID | 决策 |
|----|------|
| T1 | 从双端 `CUT_BOUNDARY_TAGS` **移除** `TD`/`TH`/`TR`/`THEAD`/`TBODY`/`TFOOT`；**保留** `TABLE` 及现有 `P`/`BR`/`LI`/…。表内相邻 Text 直拼为同一 flat 域；表与前后段落仍切断。 |
| T2 | Core `normalizeAnnotateNeedle`：在既有 NBSP→space 之后，**删除**所有 `\t`/`\n`/`\r`，再 `trim`。使跨格选区 `a\tb` 能命中直拼 haystack `ab`。 |
| T3 | `normalizeAnnotateSegmentText` **不变**（仅 NBSP、1:1）；禁止对 segment/haystack 做破坏 offset 的 trim/删分隔。 |
| T4 | `collectUnmarkedTextDomains`：若 Text 位于 `TABLE` 祖先内且 `nodeValue` 匹配 `/^[\t\n\r ]*$/`，**不入域**（去掉 pretty-print 空白）。 |
| T5 | 视觉连续：继续多段 `<mark>` + 现有 underline CSS；不要求单节点连笔；不引入 CSS Highlight API。 |
| T6 | 修订旧 D7 口径：表内连续选区允许直拼；表外 / 跨 `<p>` 仍不得误命中。遇已有 mark 先 flush（B-1）保留。 |

数据流不变：选区 → `originalText` → apply → group/长优先 → collect 分域 → `buildFlat*` + `findAllOccurrences` → 多段 wrap。

**T2 已知可接受限制（与 PRD「观感连续」优先一致）**：全局删除 needle 中的换行对后，`<pre>` / 单 Text 节点内含换行的选区可能不再命中（haystack 仍保留换行、needle 已去换行）。验收**接受**该代价；本迭代不以 PRE/单节点多行精确命中为成功标准。

### B. FileEditor 文件名居中

未聚焦/预览分支的中间 `Text` 合并 `styles.toolbarPathText`（或等价 `textAlign: 'center'`），与聚焦分支一致。不改 AppHeader。

### C. 常驻工作区

**Wire：`prompts.workplace?: boolean | string`。**

| 读入 | 开启？ | 域内助手文案 |
|------|--------|--------------|
| 缺省 / `false` | 关 | — |
| `true` | 开 | 兼容常量 **`【done】`**（与现网 `TOOL_TURN_BRIDGE_TEXT` 字面一致；产品上与 `true`/`done` 确认语义等价） |
| 非空 `string`（trim 后 ≥1） | 开 | 该字符串 |
| `""` / 仅空白 | **非法**（decode/validate 失败或保存阻断） | — |

| 写出 | 规则 |
|------|------|
| 关 | omit `workplace` |
| 开 | 写 **string**（自定义或兼容常量均写字符串；首次从 UI 开启预填 `DEFAULT_WORKPLACE_ASSISTANT_TEXT` = `i have seen workplace`） |

| ID | 决策 |
|----|------|
| W1 | 域类型：关 = 缺省；开 = 非空 `string`。读入 `true` → 归一为 `【done】`。默认预填常量名：`DEFAULT_WORKPLACE_ASSISTANT_TEXT`（值 `"i have seen workplace"`）。 |
| W2 | `layoutHasWorkplace` / assemble / render 门闩：`typeof workplace === 'string' && workplace.length > 0`（或等价 helper）。 |
| W3 | `syntheticWorkplaceDoneMessage`：**读 layout 文案**，不再 import `TOOL_TURN_BRIDGE_TEXT` 作为常驻 done。 |
| W4 | Tool-turn bridge **继续**固定 `【done】`，本迭代不联动。 |
| W5 | **`<workplace>` 唯一包裹出口**：仅在 `assembleWorkplaceDisplay` **返回前**对非空 `workplaceDisplay` 包一层 `<workplace>…</workplace>`（空串不包、原样返回 `""`）。**禁止**改 `renderFileBlock` / `joinFileBlocks` 使之带外层标签；**禁止**在 `syntheticWorkplaceUserMessage` / render 路径再次包一层（否则双包）。`materializePersistBlock` **本迭代不包**（persist 展示路径与常驻前缀解耦）。消息增量路径**禁止**引入该标签。 |
| W6 | UI：Desktop `AgentWorkplaceBlockCard`（由 `AgentDefinitionEditorForm` 与 `AgentEditorView` **两处**挂载）/ Mobile `AgentEditorForm` 对齐 system——开→textarea；默认预填 `DEFAULT_WORKPLACE_ASSISTANT_TEXT`；开且 trim 空 → 保存失败。Card Props 钉死：`checked` / `onChange` / `disabled?` + **`assistantText`** + **`onAssistantTextChange`**（受控文案，对齐 system 区 `value`/`onChange` 受控模式）。 |
| W7 | 旧 `persist` `type:worktree` strip 不升迁规则**不变**。 |
| W8 | Hint（`WORKPLACE_BLOCK_HINT`）改为「可编辑助手确认语」，不再写死仅 `【done】`。示例口径：「开启后可编辑助手确认语（默认如 `i have seen workplace`）；user 侧文件树包在 `<workplace>` 内，仅表常驻前缀。」 |
| W9 | **开态空文案阻断点**：在 `buildAgentDefinitionFromForm`（及 Mobile 等价构建入口）对 `workplaceEnabled && trim(workplaceAssistantText) === ''` **显式**返回 `{ ok: false, message: … }`。**勿**依赖 `hasAnyPromptRegionEnabled`（其仅含 system/persist/dynamic，**不含** workplace）。 |

表单态：

```ts
workplaceEnabled: boolean;
workplaceAssistantText: string; // 开时默认 DEFAULT_WORKPLACE_ASSISTANT_TEXT
```

Desktop Card 受控接线（两处一致）：

```ts
// AgentDefinitionEditorForm.tsx / AgentEditorView.tsx
<AgentWorkplaceBlockCard
  checked={workplaceEnabled}
  disabled={disabled} // EditorView 可无 disabled
  onChange={setWorkplaceEnabled}
  assistantText={workplaceAssistantText}
  onAssistantTextChange={setWorkplaceAssistantText}
/>
```

## 最终项目结构

```text
packages/core/src/domain/chat/logic/
  annotate-highlight.ts              # T2：needle 去 \\t\\n\\r
packages/core/test/chat/
  annotate-highlight.test.ts         # T-AT* needle / 切断对照
apps/mobile/src/web/rich-document/webview/runtime/
  annotate-marks.ts                  # T1/T4 cut 集 + 空白跳过
apps/mobile/__tests__/
  annotate-marks.test.ts             # 跨 td / 整行 / 整表 DOM
apps/desktop/renderer/layout/
  preview-annotate.ts                # 同合同
apps/desktop/test/
  preview-annotate.test.ts

packages/core/src/domain/agent/model/
  agent-definition.schema.ts         # boolean | string
packages/core/src/domain/prompt/model/
  agent-prompt-layout.ts             # workplace?: string
packages/core/src/domain/prompt/logic/
  validate-agent-prompt-layout.ts
  normalize-agent-prompt-layout.ts   # 保留 string，勿压成 boolean
packages/core/src/domain/workplace/logic/
  workplace-display.ts               # renderFileBlock / joinFileBlocks：本迭代不包 <workplace>
packages/core/src/service/workplace/
  assemble-workplace-display.ts      # 唯一包裹出口 + layoutHasWorkplace
packages/core/src/service/prompt/
  render-prompt.ts                   # assistant 读配置文案；勿再包 <workplace>
packages/core/src/config-forms/agent/
  agent-editor-state.ts              # 表单 + DEFAULT_WORKPLACE_ASSISTANT_TEXT + 空串校验 + HINT
apps/desktop/renderer/features/settings/
  AgentWorkplaceBlockCard.tsx        # Props: assistantText + onAssistantTextChange
  AgentDefinitionEditorForm.tsx      # 挂 Card（项目 Agent）
  AgentEditorView.tsx                # 挂 Card（全局 Agent）
apps/mobile/src/.../AgentEditorForm.tsx
packages/core/test/.../agent-editor-state*.ts  # T-WP7–8 主宿主
（相关 desktop/mobile 组件测可选）

apps/mobile/src/screens/stack/
  FileEditorScreen.tsx               # toolbarPathText
apps/mobile/__tests__/
  file-editor-screen.test.tsx        # T-FE1
```

## 变更点清单

| 模块 | 变更 |
|------|------|
| Core `annotate-highlight` | `normalizeAnnotateNeedle` 删 `\t\n\r` |
| Mobile/Desktop annotate 壳 | cut 集去表单元格/行；TABLE 内跳过纯空白 Text；注释对齐 T6 |
| Core agent schema / layout / validate / normalize | `workplace: boolean \| string`；域开=非空 string；true→`【done】` |
| `assemble-workplace-display` | **唯一**对非空 `workplaceDisplay` 包 `<workplace>`；`layoutHasWorkplace` 改判 |
| `workplace-display`（`renderFileBlock`/`joinFileBlocks`） | **禁止**改外层包裹 |
| `materializePersistBlock` | **本迭代不包** `<workplace>` |
| render-prompt | 常驻 assistant 用配置文案；与 bridge 解耦；`syntheticWorkplaceUserMessage` **勿再包** |
| agent-editor-state + 双端 UI | enabled+text；`DEFAULT_WORKPLACE_ASSISTANT_TEXT`；`buildAgentDefinitionFromForm` 显式禁空；更新 HINT |
| Desktop 接线 | `AgentDefinitionEditorForm` + `AgentEditorView` 均传 `assistantText` / `onAssistantTextChange` |
| FileEditorScreen | 非聚焦 Text 补 `toolbarPathText` |
| 测试 | 见「测试用例」；增量测继续断言消息 body **无** `<workplace>`；常驻前缀测断言 **有** 且不双包 |

## 详细实现步骤

- Step 1 — phase-annotate-needle — blocking: yes — qa: auto：Core `normalizeAnnotateNeedle` 删除 `\t`/`\n`/`\r`；单测 T-AT1。
- Step 2 — phase-annotate-table-domain — blocking: yes — qa: auto：双端 `CUT_BOUNDARY_TAGS` 与表内空白跳过（T1/T4）；Mobile/Desktop DOM 测 T-AT2–T-AT5；同格 strong 与跨 p 不误中回归 T-AT6/T-AT7。
- Step 3 — phase-fileeditor-center — blocking: yes — qa: auto：`FileEditorScreen` 非聚焦分支补居中；T-FE1（宿主 `file-editor-screen.test.tsx`）。
- Step 4 — phase-workplace-schema — blocking: yes — qa: auto：schema/域/validate/normalize/toWire；true 兼容；空串非法；T-WP1–T-WP3。
- Step 5 — phase-workplace-inject — blocking: yes — qa: auto：仅 `assembleWorkplaceDisplay` 返回前包 `<workplace>`；不改 `renderFileBlock`/`joinFileBlocks`；`materializePersistBlock` 不包；render 用配置 assistant 文案且不二次包裹；空树不注入；bridge 仍为 `【done】`；T-WP4–T-WP6。
- Step 6 — phase-workplace-ui — blocking: yes — qa: auto：扩展 `AgentWorkplaceBlockCard` Props（`assistantText` + `onAssistantTextChange`）；`AgentDefinitionEditorForm` 与 `AgentEditorView` 两处接线；Mobile `AgentEditorForm` 开→输入框、默认预填、空串保存失败（`buildAgentDefinitionFromForm` 显式阻断）；HINT 更新；T-WP7–T-WP8（主宿主 core `agent-editor-state`）。
- Step 7 — phase-manual-qa — blocking: no — qa: manual_user：真机/桌面扫跨格表批注连续下划线、FileEditor 各态居中、常驻注入预览含标签与自定义确认语；可选 Desktop Card 组件冒烟。

## 测试策略

| 层 | 宿主 |
|----|------|
| Core annotate / workplace schema / render / **agent-editor-state** | `packages/core/test`（T-WP7–8 **以本层为主**） |
| Mobile annotate DOM / FileEditor / AgentEditor | `apps/mobile` jest；T-FE1 → `file-editor-screen.test.tsx` |
| Desktop preview-annotate | `apps/desktop/test`；T-AT3 / T-AT4 Desktop 侧同合同 |
| Desktop AgentWorkplaceCard 组件测 | **可选**；不足时 Step 7 手工冒烟 `AgentDefinitionEditorForm` / `AgentEditorView` |
| T-M* | 真机/桌面 manual |

### 测试用例

- T-AT1 — blocking: yes — Core：needle `"a\\tb\\nc"` 归一后为 `"abc"`。（→ Step 1）
- T-AT2 — blocking: yes — Mobile：`<table><tr><td>aa</td><td>bb</td></tr></table>`，`originalText` 为跨格可见串（可含 `\\t`）→ ≥2 段 mark 并集覆盖 `aabb`（或可见连续串）。（→ Step 2）
- T-AT3 — blocking: yes — Desktop：同 T-AT2 合同。（→ Step 2）
- T-AT4 — blocking: yes — **Mobile + Desktop 均要**：整行 / 多格 DOM：高亮覆盖该行可见文本。（→ Step 2）
- T-AT5 — blocking: yes — 表后邻接 `<p>xx</p>`：needle 为表尾+段首拼接串 → **零** mark。（→ Step 2）
- T-AT6 — blocking: yes — 同格 `<td>hel<strong>lo</strong></td>` 仍 ≥2 段 mark（不回归）。（→ Step 2）
- T-AT7 — blocking: yes — 跨 `<p>` `lohe` 仍零命中。（→ Step 2）
- T-FE1 — blocking: yes — 宿主 **`apps/mobile/__tests__/file-editor-screen.test.tsx`**：预览态与聚焦态中间文件名 Text 均含 `textAlign: 'center'`；脏「未保存」同。（→ Step 3）
- T-WP1 — blocking: yes — decode `workplace: true` → 域开启且文案 `【done】`。（→ Step 4）
- T-WP2 — blocking: yes — decode `workplace: "i have seen workplace"` → 原文案；toWire 写出 string。（→ Step 4）
- T-WP3 — blocking: yes — `workplace: ""` 或仅空白 → 校验失败。（→ Step 4）
- T-WP4 — blocking: yes — assemble/render：开启且有 display 时 user body 含**恰好一层** `<workplace>` 与 `</workplace>`，且内含既有 `<file>`；断言无 `<<workplace>` / 双层嵌套。（→ Step 5）
- T-WP5 — blocking: yes — render：assistant `prompt:workplace:done` content 等于配置文案（非强制 `【done】`）。（→ Step 5）
- T-WP6 — blocking: yes — 消息增量 prepare 路径 body **仍不含** `<workplace>`（常驻前缀除外的既有断言保留）。（→ Step 5）
- T-WP7 — blocking: yes — **主宿主** core `agent-editor-state`：开启后默认文案为 `DEFAULT_WORKPLACE_ASSISTANT_TEXT`；清空后 `buildAgentDefinitionFromForm`（或等价）显式 `ok: false`（不依赖 `hasAnyPromptRegionEnabled`）。Desktop Card 组件测**可选**。（→ Step 6）
- T-WP8 — blocking: yes — **主宿主** core `agent-editor-state`：关开关后 omit workplace；再开若文案空则预填默认。Desktop 组件测**可选**/手工。（→ Step 6）
- T-M1 — blocking: no — 真机跨格/整行划词有连续观感下划线并可点开。（→ Step 7）
- T-M2 — blocking: no — 真机 FileEditor 预览态文件名居中。（→ Step 7）
- T-M3 — blocking: no — 配置自定义确认语后会话前缀可见 `<workplace>` 与该确认语。（→ Step 7）

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 表内直拼导致相邻格假命中（如 `lo`+`he`→`lohe`） | PRD 接受表内代价；用 TABLE 边界挡住表外；单测 T-AT5 |
| WebView `selectedText` 与 Desktop `toString` 分隔不一致 | needle 删分隔 + 表内跳过空白，降低 UA 差 |
| **T2：`<pre>` / 单 Text 含换行的选区可能不再命中** | **已知可接受限制**；与 PRD「观感连续」优先一致；本迭代不要求 PRE/单节点多行精确命中 |
| assemble / join / synthetic 易双包 `<workplace>` | W5：唯一出口在 `assembleWorkplaceDisplay` 返回前；禁改 render/join；render/synthetic 不二次包；T-WP4 断言单层 |
| 常驻 `<workplace>` 与废止增量标签同名混淆 | 文档/HINT 标明「仅常驻前缀」；增量测继续禁止 |
| 写出一律 string 使旧 YAML `true` 在保存后变形 | 读兼容即可；可接受首次保存升级为 string |
| bridge 与常驻曾共用常量 | W3/W4 解耦；compat 仍可用 `【done】` 字面 |
| 开态空文案仅靠 region 门闩漏检 | W9：`buildAgentDefinitionFromForm` 显式判 `workplaceEnabled && trim===''` |

**回滚**：按 phase 反向还原 cut 集 / needle / schema union / UI 输入框 / FileEditor 样式；发版前用 git revert 对应提交即可。

## Context Bundle（实现参考）

```yaml
iteration_name: annotate-workplace-ux-fix
requirement_path: Iterations/annotate-workplace-ux-fix/prd.md
spec_path: Iterations/annotate-workplace-ux-fix/spec.md
explore_summary: |
  批注：CUT 去 TD/TR 等，保留 TABLE；needle 去 tab/换行（PRE/单节点多行可能不命中，可接受）；
  表内跳过空白 Text。
  FileEditor：非聚焦 Text 补 toolbarPathText；T-FE1 → file-editor-screen.test.tsx。
  workplace：boolean|string；true→【done】；
  仅 assembleWorkplaceDisplay 返回前包 <workplace>（禁改 renderFileBlock/joinFileBlocks；
  materializePersistBlock 本迭代不包；synthetic 不二次包）；
  render 读配置文案；bridge 不联动；
  UI：DEFAULT_WORKPLACE_ASSISTANT_TEXT；Card Props assistantText+onAssistantTextChange；
  AgentDefinitionEditorForm + AgentEditorView 两处接线；
  buildAgentDefinitionFromForm 显式禁空（勿依赖 hasAnyPromptRegionEnabled）。
impact_files:
  - packages/core/src/domain/chat/logic/annotate-highlight.ts
  - apps/mobile/.../annotate-marks.ts
  - apps/desktop/renderer/layout/preview-annotate.ts
  - packages/core/.../agent-definition.schema.ts
  - packages/core/.../workplace-display.ts
  - packages/core/.../assemble-workplace-display.ts
  - packages/core/service/prompt/render-prompt.ts
  - packages/core/config-forms/agent/agent-editor-state.ts
  - apps/desktop/.../AgentWorkplaceBlockCard.tsx
  - apps/desktop/.../AgentDefinitionEditorForm.tsx
  - apps/desktop/.../AgentEditorView.tsx
  - apps/mobile/.../AgentEditorForm.tsx
  - apps/mobile/.../FileEditorScreen.tsx
  - apps/mobile/__tests__/file-editor-screen.test.tsx
constraints:
  - 不恢复消息增量 <workplace>
  - 不改 tool-turn bridge 联动
  - 旧 worktree 块 strip 不升迁
  - <workplace> 仅 assembleWorkplaceDisplay 返回前包一层
  - 禁止改 renderFileBlock/joinFileBlocks 外层包裹
  - materializePersistBlock 本迭代不包 <workplace>
blocking_steps: [1, 2, 3, 4, 5, 6]
```
