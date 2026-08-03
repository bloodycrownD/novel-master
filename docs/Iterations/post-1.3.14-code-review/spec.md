---
date: 2026-07-20
dependency:
  - Iterations/post-1.3.14-code-review/prd.md
---

# v1.3.14→HEAD 全量代码审查 报告型 SPEC

## 需求来源

- **PRD**：`Iterations/post-1.3.14-code-review/prd.md`（已确认）
- **基线**：`v1.3.14..HEAD`（约 221 commits；含已发 `v1.4.01`/`v1.4.02` 与 post-1.4.02 未发增量）
- **形态**：审查报告（记录发现与建议；**不含**强制可编码 Step / T- 用例矩阵作为完成条件）
- **审查执行**：五包只读 CR Agent（CR-A～CR-E），按 PRD 严重级双标与强制绕弯专节产出后由主代理去重汇总
- **严重级映射**（与 PRD 意图对齐）：Blocker=P0 · Should-fix=P1 · Should-Fix=P2 · Nit=P3

## 设计目标

1. 汇总五包覆盖结论，满足 PRD「覆盖完成即可」成功标准。
2. 给出可追溯发现总表（Blocker/Should-fix/Should-Fix/Nit ↔ P0–P3）与跨包去重。
3. 标出必要 hop vs 偶然 hop / 费力实现，供后续可选整改迭代引用（本 SPEC 不立项强制编码）。

## 总体结论

| 包 | 结论 | Blocker/P0 | 发版标注 |
|----|------|------------|----------|
| CR-A Core 协议 | **Go-with-notes** | 0 | 协议主体 **已发 1.4.02**；改名触碰交 CR-C |
| CR-B Composer | **Go-with-notes** | 0 | 硬合同/门闩 **已发 1.4.x** |
| CR-C Workplace 改名 | **Go-with-notes** | 0 | C0–C4 **未发**（post-1.4.02） |
| CR-D Annotate | **Go-with-notes** | 0 | **已发 1.4.02** |
| CR-E Mobile WebView | **Go-with-notes** | 0 | CT/RD **已发**；`code-editor` **未发** |

**总评**：**Go-with-notes**。五包均未发现证据充分的 Blocker/P0；债集中在费力平行实现、层边界（Desktop renderer→core）、少量生命周期/门禁完备度缺口。

## 发现总表（去重后）

### 跨包主题（先读）

| ID | 标题 | 严重级 | 来源包 | 绕弯？ | 证据 | 建议摘要 |
|----|------|--------|--------|--------|------|----------|
| X1 | Desktop renderer 直连 `@novel-master/core` | Should-fix / **P1** | B1, C3, D 备注 | 层边界违规 | `apps/desktop/renderer/features/chat/ChatComposer.tsx` import `@novel-master/core/chat`；同类见于 settings Agent 编辑器 | 纯函数经 shared/preload/IPC DTO；renderer 禁直接依赖 core |
| X2 | 双端近复制（Chips/Picker/annotate store/高亮纯函数/门闩） | Should-fix / **P1** | B2, B3, D2, D3 | **费力实现** | Desktop/Mobile 各有 `AttachmentDraftChips`、`composer-at-path`、`chat-annotate-draft`（如 `apps/desktop/renderer/features/chat/*` vs `apps/mobile/src/components/chat/*` / `storage/`） | 抽 shared 纯函数；平台只留壳 |
| X3 | CI/PR 无统一 test·lint；`check:workplace-rename` 未进默认 CI | Nit / **P3** | E6, C9, PRD | 否 | `scripts/check-workplace-rename-gate.mjs`；PRD「不把 CI 缺失当本 diff 缺陷」 | 工程建议；**不挡**本报告完成 |

### CR-A Core 协议

| ID | 标题 | 严重级 | 绕弯？ | 证据 | 建议摘要 |
|----|------|--------|--------|------|----------|
| A1 | 双套 workplace 正文物化（assemble kkv vs materializePersistBlock/CLI） | Should-fix / P1 | 是 | `packages/core/src/service/workplace/assemble-workplace-display.ts` vs `workplace.service` `materializePersistBlock`；`apps/cli/src/workplace/run-workplace.ts` | 钉死「聊天前缀唯一 assemble」或收敛 CLI 同源 |
| A2 | `loadOrFillFileCache` assemble∥prepare 双份 | Should-fix / P1 | 是 | `packages/core/src/service/workplace/assemble-workplace-display.ts` `loadOrFillFileCache`；`packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts` 同名私有函数 | 抽单点 helper |
| A3 | `run-agent-turn` 头注释调用序与 runner 实际相反 | Should-Fix / P2 | 否 | `packages/core/src/service/agent/logic/run-agent-turn.ts` 头注释写 prepare→assemble；`packages/core/src/service/agent/impl/agent-runner.ts` 实际 assemble→prepare(S0) | 改正为 assemble→prepare(S0) |
| A4 | 新 append 上多余 `mergeAttachmentsWithScannedAtPaths("",…)` | Should-fix / **P1** | 是（偶然 hop） | `packages/core/src/service/agent/logic/run-agent-turn.ts` 对新 append 调用 `mergeAttachmentsWithScannedAtPaths("", […])` | 改直 concat；dedupe 分域 |
| A5 | T-SR1 flush fixture 落后生产（缺 path/action） | Should-Fix / P2 | 否 | `packages/core/test/service/agent/run-agent-turn.test.ts` **T-SR1** flush fixture 缺 path/action | fixture 对齐生产；补同 path 并存测 |
| A6 | hydrate「已是 action」靠 `includes("<action ")` | Nit / P3 | 轻 | `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts` `includes("<action ")` | 结构化判定 |
| A7 | materialize/状态条差集未闸 `prompts.workplace`（疑点） | Should-Fix / P2（**疑点**） | 未读清 | `workplace.service` `materializePersistBlock` 与状态条投影路径；相对 SSOT `prompts.workplace` **未读清是否应闸** | SSOT 明确开关与差集关系后再定是否升/降 |
| A8 | `scan-at-path` 注释仍写无 path | Nit / P3 | 否 | `packages/core/src/domain/chat/logic/scan-at-path-attachments.ts` 注释「user_ops（无 path）」 | 更新注释 |

### CR-B Composer

| ID | 标题 | 严重级 | 绕弯？ | 证据 | 建议摘要 |
|----|------|--------|--------|------|----------|
| B1 | → 并入 **X1** | — | — | — | — |
| B2/B3 | → 并入 **X2** | — | — | — | — |
| B4 | Desktop `started:true` 即清正文；Mobile 等 append/turn 结束 | Should-fix / P1 | 生命周期不对称 | `apps/desktop/renderer/features/chat/ChatComposer.tsx`：`ipcAgentRun` ok 后 `onChange("")`；`apps/mobile/src/components/chat/ChatComposer.tsx`：`onUserMessageAppended` / turn 结束再 `clearComposerNow` | 对齐「append 成功再清」或文档钉死并补失败回填测 |
| B5 | `rollback-composer` 私有 status 判定与 Chips 不完全同形 | Should-fix / **P1** | 是（偶然 hop） | `apps/desktop/renderer/features/chat/rollback-composer.ts` `statusOnly` vs `AttachmentDraftChips` | 共用判定 |
| B6 | `AgentRunRequest.attachments?` 旁路仍在（主路径已不传） | Nit / P3 | 已知开放面 | `run-agent-turn.ts` `attachments?`；主路径 Desktop/Mobile 已不传预览 | 另开收紧；不升 Blocker |
| B7 | `showRemove`/陈旧注释兼容面 | Nit / P3 | 轻 | `AttachmentDraftChips.tsx` `showRemove?: boolean` 默认 false | 清理或 `@deprecated` |

### CR-C Workplace 改名（未发）

| ID | 标题 | 严重级 | 绕弯？ | 证据 | 建议摘要 |
|----|------|--------|--------|------|----------|
| C1 | CHANGELOG 未钉「旧 worktree 块不升开」破坏性说明 | Should-fix / P1 | 否 | 根 `CHANGELOG.md` 有常驻工作区条目，**无**「旧 `type:worktree` 不升开 / 需手动重开」破坏性说明 | 下版发版说明必写手动重开常驻工作区 |
| C2 | Desktop 两套 Agent 编辑器平行 workplace Switch | Should-fix / P1 | 费力 | `AgentEditorView.tsx` 与 `AgentDefinitionEditorForm.tsx` 各有 workplace Switch UI | 抽共享顶卡 |
| C3 | → 并入 **X1** | — | — | — | — |
| C4 | 改名门禁不对称（禁 dir 表未禁 file 表旧名；「工作树」仅扫 apps/） | Should-Fix / P2 | 否 | `scripts/check-workplace-rename-gate.mjs` 禁 `worktree_dir_rule`，未对称禁 file 表旧名；GUI「工作树」扫描面限 apps/ | 对称禁旧表名；按需扩扫描面 |
| C5 | wire 双重 strip + 死分支 | Should-fix / **P1** | 是（偶然 hop） | `packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts` `isLegacyWorktreeWireBlock` / strip；与 validate 路径叠层 | 单入口保留；死分支删或断言 |
| C6 | 校验错误文案仍写「worktree 块」 | Should-Fix / P2 | 否 | `packages/core/src/domain/prompt/logic/validate-agent-prompt-layout.ts`：「worktree 块已废弃…」 | 改为中性「常驻工作区」表述 |
| C7 | 死常量 `WORKPLACE_BLOCK_WIRE_NAME` | Should-fix / **P1** | 是（偶然 hop / 残留壳） | `packages/core/src/config-forms/agent/agent-editor-state.ts` `export const WORKPLACE_BLOCK_WIRE_NAME`（仅定义、仓库内零引用） | 删除 |
| C8 | 局部符号/注释仍 `worktree` | Nit / P3 | 否 | 如 `agent-prompt-layout.ts` 过渡态 worktree 类型注释；IPC/runtime 注释「不 capture worktree 块」 | 随手改名 |
| C9 | → 并入 **X3** | — | — | — | — |

### CR-D Annotate

| ID | 标题 | 严重级 | 绕弯？ | 证据 | 建议摘要 |
|----|------|--------|--------|------|----------|
| D1 | Desktop 清 annotate 绑「当前 sessionId」，切会话后可能残留 store | Should-fix / P1 | 否 | `apps/desktop/renderer/features/chat/ChatComposer.tsx` `onUserMessageAppended`：`payload.sessionId !== sessionId` 则 return，不清异会话 store | 始终按 payload.sessionId 清 store |
| D2/D3 | → 并入 **X2** | — | — | — | — |
| D4 | T-AN3/5 未覆盖 ChatComposer sessionId 过滤 | Should-Fix / P2 | 否 | `apps/desktop/test/chat-annotate-draft.test.ts` **T-AN3/T-AN5** 覆盖 started 不清；未测异会话过滤 | 补异会话仍清 store 测 |
| D5 | 划词入口形态 Desktop 浮动条 vs Mobile 原生菜单 | Nit / P3 | 否 | Desktop `PreviewPane` + `preview-annotate`；Mobile rich-document bridge `selectionAnnotate` / 原生菜单 | 语义已齐；不强制统一壳 |

### CR-E Mobile WebView

| ID | 标题 | 严重级 | 绕弯？ | 证据 | 建议摘要 |
|----|------|--------|--------|------|----------|
| E1 | CT `renderToolGroup*` 死拼串与 Preact ToolGroup 平行 | Should-fix / P1 | 是 | `apps/mobile/src/web/chat-transcript/webview/runtime/render/tool-logic.ts` `renderToolGroupItem`/`renderToolGroupSection`：**仅定义、零引用**；现行 UI 为 `apps/mobile/src/web/chat-transcript/webview/ui/render/ToolGroup.tsx` | 删死路径 |
| E2 | ui 直读全局 `state`，props 不闭环 | Should-Fix / P2 | 费力 | 如 `ui/render/RowList.tsx`、`MessageRow.tsx`、`StreamTail.tsx` import `runtime/state/state` | 新组件禁 import state；逐步下发 props |
| E3 | `webview-uri-load` 未覆盖未发 `code-editor` 第三包 | Should-Fix / P2 | 否 | `apps/mobile/__tests__/webview-uri-load.test.tsx` 仅 CT/RD URI；无 `code-editor` | 补 URI/props 矩阵 |
| E4 | code-editor 无 `ui/` 与「每包 ui+runtime」定案漂移 | Should-Fix / P2 | 弱 | `apps/mobile/src/web/code-editor/webview/` 仅 `runtime/`（无 `ui/`） | 文档钉「CodeMirror 免 Preact ui」例外 |
| E5 | README/gradle 仍写「双包」心智 | Nit / P3 | 否 | `apps/mobile/README.md`「聊天 Transcript 与富文档…各为一包 / 双包视图」 | 改三包叙述 |
| E6 | → 并入 **X3** | — | — | — | — |

## 按包摘要

### CR-A
主路径（误传丢弃、Core materialize、flush→user_ops、annotate concat、assemble→prepare(S0)）与 SSOT 对齐，T-SR* 钉测在。

**绕弯专节**
- **必要 hop**：IPC；flush 事务；assemble/prepare 分阶段；预览≠payload；session kkv 双域。
- **偶然 hop**：双套 display 物化（A1，Should-fix/P1）；双份 `loadOrFillFileCache`（A2，Should-fix/P1）；空串二次 merge（A4，Should-fix/P1）。
- **费力点**：assemble∥CLI/materialize 双路径需同步改（A1）。

### CR-B
硬合同通过（状态 chip vs `@path`、无叉、预览不进 payload、中文二字）。

**绕弯专节**
- **必要 hop**：Desktop IPC；Core 投影/清洗；预览 chip ≠ `runAgentTurn` payload。
- **偶然 hop**：rollback 私有 status 判定与 Chips 不完全同形（B5，Should-fix/P1）。
- **费力点**：双端 Chips/Picker/门闩近复制（→X2）；Desktop 早清正文 vs Mobile 晚清（B4）。

### CR-C（未发）
C0–C4 与 SPEC 对齐；migration fail-fast / strip 不升开 / IPC·CLI 无长期别名 / 本地 rename-gate OK。发版前优先 C1；编辑器平行 Switch（C2）与门禁完备度（C4）次之。

**绕弯专节**
- **必要 hop**：workplace 表 rename migration（空新表+旧表撞车）；读入 strip 旧 `type:worktree` 不升开。
- **偶然 hop**：wire 双重 strip + 死分支（C5，Should-fix/P1）；死常量 `WORKPLACE_BLOCK_WIRE_NAME`（C7，Should-fix/P1）。
- **费力点**：两套 Agent 编辑器平行 workplace Switch（C2）。

### CR-D
append 成功清 / 禁 started / 同 path 多条 concat / 中文 chip 主路径通过。优先修 D1（切会话清 store）；双端复制并入 X2。

**绕弯专节**
- **必要 hop**：Desktop `userMessageAppended` 分轨（与 `started` 解耦清 annotate）；annotate concat 禁 path 去重。
- **偶然 hop**：无显著多余中间层（入口壳差异属 Nit/D5）。
- **费力点**：annotate store / 高亮纯函数双端近复制（→X2）；D1 sessionId 过滤易漏测（D4）。

### CR-E
无 runtime→ui 反向依赖；TrustedHtml/菜单壳/1.4.02 双包资产门禁抽检通过。删 E1 死拼串；未发 code-editor 补测与文档例外（E3/E4）。

**绕弯专节**
- **必要 hop**：WebView bridge / `source.uri` / 原生 assets；Preact `main` 注册 + runtime 不 import ui；流式 body 岛。
- **偶然 hop**：`renderToolGroup*` 仅定义、零引用的死拼串（E1，Should-fix/P1）。
- **费力点**：ui 直读全局 `state`（E2）；三包心智与测矩阵未齐（E3/E4/E5）。

## 绕弯总览（按包索引）

跨包优先收敛：X2 双端样板 → A1/A2/A4 Core 双路径与偶然 hop → B5 rollback 判定 → E1 死拼串 → C5/C7/C2。各包明细见上方「按包摘要 · 绕弯专节」。

**应保留的必要 hop（抽样）**

- Electron IPC；WebView bridge / `source.uri` / 原生 assets
- `assembleWorkplaceDisplay` → `prepareUserMessagesForPrompt`（S0）分阶段
- 预览 chip ≠ `runAgentTurn` payload；annotate concat 禁 path 去重
- Desktop `userMessageAppended` 分轨（因 `started` 早返回）
- workplace 表 rename migration（空新表+旧表撞车处理）
- Preact `main` 注册 + runtime 不 import ui；流式 body 岛

## 测试与门禁线索（汇总）

- Core：T-SR*、T-PD*、T-AN*、T-W*、composer-sendable、status-chip、workplace-rename-gate / schema-migrations
- Desktop/Mobile：composer / annotate / chips / at-path 集成与单测
- Mobile WebView：boot-script、uri-load（缺 code-editor）、release `build:webview:native`
- **缺口（报告级）**：A5/A7、B4 失败回填、D4、E3、C1 发版说明

## 已知已整改（不重复立项）

- 硬合同相关 revert/删除（`@` 藏 chip、picker→attach chip、showRemove 默认 false 等）
- 误传丢弃、allowAssistantContinue、pending→kkv、write→file_cache、单一 user-ops
- workplace 域/IPC/CLI 改名主路径（未发，属 CR-C 交付面而非「再猎 P0」）
- WebView 菜单壳债、TrustedHtml、1.4.02 资产修复

## 建议后续动作（可选，非本 SPEC 强制）

1. **发版前（若含 CR-C）**：落地 C1 CHANGELOG；跑 `check:workplace-rename` + schema-migration 测。
2. **正确性小修优先**：D1（annotate 切会话清 store）；视产品确认 A7（疑点）。
3. **费力债 / 偶然 hop 可另开迭代**：X1（renderer↔core）、X2（shared 抽纯函数）、A1/A2/A4、B5、C5/C7、E1。
4. **不在本报告要求**：Blocker 清零、真机 blocking smoke、强制实现 Step/T- 矩阵。

## 风险与回滚说明

- 本文件为**只读审查产物**，无代码变更，无回滚步骤。
- 若依建议另开整改，应单独立项 PRD/SPEC，并与 `implementation-simplification` / 各 feature SSOT 分工，避免重开已合入正确性 P0。

## PRD 验收对照

- [x] 五包均有结论摘要、发现列表（双严重级）、绕弯专节、证据路径
- [x] 无收益多层均 ≥ Should-fix/P1（或并入跨包 P1）
- [x] 本 `spec.md` 为报告型汇总，不含强制编码 Step/T- 完成条件
- [x] 与 historical remediation 重复项已标「已知已整改」或跨包去重
- [x] `prd_confirmed: yes` 后完成 CR → 本 SPEC 落盘
