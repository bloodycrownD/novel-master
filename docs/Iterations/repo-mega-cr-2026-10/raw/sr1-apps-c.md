---
zone: fix-spec/wave-b-apps 分片 · 组 C（§6#6 注记 + §6#7 注记 + 分片注记节 + apps-mobile 债务池抽验）
agent: reviewer / readonly
files_scanned:
  - docs/Iterations/repo-mega-cr-2026-10/PLAN.md
  - docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-b-apps.md
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/SPEC.md
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-e.md
  - docs/Iterations/repo-mega-cr-2026-10/synth/apps-mobile.md
  - docs/apm/RULE.md
  - docs/apm/memory/*
  - apps/desktop/renderer/ipc/invoke-registry.ts
  - apps/desktop/renderer/ipc/client.ts
  - apps/desktop/shared/ipc-types.ts
  - apps/desktop/renderer/features/chat/ChatComposer.tsx
  - apps/desktop/renderer/features/chat/FileReferencePicker.tsx
  - apps/desktop/renderer/features/chat/ChatHistorySearchPanel.tsx
  - apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx
  - apps/desktop/src/main/ipc/resolve-vfs-scope.ts
  - apps/desktop/src/main/ipc/handlers/compaction-conditions.ts
  - packages/core/src/domain/agent/run-agent-turn.ts
  - apps/mobile/src/services/snapshot-file-hash.ts
  - apps/mobile/src/services/document-io.ts
  - apps/mobile/src/db/connection.ts
  - apps/mobile/src/storage/chat-composer-draft.ts
  - apps/mobile/src/theme/ThemeProvider.tsx
  - apps/mobile/src/storage/app-ui-keys.ts
  - apps/mobile/src/screens/stack/AboutScreen.tsx
  - apps/mobile/src/screens/stack/SessionDetailScreen.tsx
  - apps/mobile/src/screens/stack/RealPromptScreen.tsx
  - apps/mobile/src/services/session-stream-unit-manager.service.ts
  - apps/mobile/src/components/chat/ComposerAtPathInput.tsx
  - apps/mobile/src/web/tsconfig.json
  - apps/mobile/src/web/chat-transcript/stream/block-split.ts
  - apps/mobile/src/web/rich-document/webview/runtime/annotate-collect.ts
  - node_modules/@types/node/index.d.ts
---

# 组 C 审查报告 · wave-b-apps 注记节 + apps-mobile 债务池

## 摘要

§6 #6 与 §6 #7 两个注记的**事实内核全部复核成立**，写入的病句、行号、边界描述没有捏造，
§6 #7 的「需要产品确认的问题」原文逐字保留、未擅自入账，符合 suspected 不入账纪律。
真正的缺陷只有一类：**基线数字错了**——本轮在 `fe79b781` 上独立实跑
`tsc --noEmit -p tsconfig.renderer.json` 得 **411** 条，不是本分片 §0.3 断言的「424 ✅ 一致」；
`wave-e.md`（N-P1-05 本体）早已独立测到 411 并把它记成口径差，本分片漏掉了这次修正，
于是「renderer 基线可量化降至 **423**」这个自报主张的绝对值站不住（应为 **410**）。
差额 −1 的**算法**是对的，减量来源只有 §2 的 `:106` 一处 TS2345，我逐条对过账。
债务池抽验 9/46 条（19.6%），九条病灶在 `fe79b781` 上逐条仍真、定级合理、无重复立项。

## 职责与边界

只审三个东西：§5（§6 #6 注记本体）、§6.2（§6 #7 注记本体）、§6.1（分片级注记），
外加按 §12 纪律对 apps-mobile 债务池做 ≥10% 抽验。§1/§2/§3/§4 的七要素本体不归本组，
只在它们与 §5/§6 的边界处被交叉引用时顺手对账。全程只读，唯一写入是本文件。

## 对外接口（本组复核的跨文件契约）

| 交接面 | 对方 | 复核结论 |
|---|---|---|
| `invoke-registry.ts:649/653` 类型补齐 | `shared/ipc-types.ts:1613/1622` + `handlers/compaction-conditions.ts:12/24` | ✅ 三个签名逐字在位，「零风险纯补签名」成立 |
| `vfsScope("session", …)` → `resolveVfsScopeFromRequest` | `apps/desktop/renderer/ipc/client.ts:261-267`、`src/main/ipc/resolve-vfs-scope.ts:30-34` | ✅ 映射为 `{kind:"project"}`、`sessionId` 被丢弃，属实 |
| §5.3 消减顺序 → `wave-e.md` X2 Step 4 分批表 | R1–R6 | ❌ **wave-e 未引用 §5.2/§5.3**，且两处分批口径不同（见 MF-2） |
| §2 `:106` 修法 → renderer 基线棘轮 | `wave-e.md` X2 `typecheck-renderer-baseline.json` | ⚠️ 基线数字两边不一致（见 MF-1） |

## 数据记忆

- **本轮唯一一次实跑**：`cd apps/desktop && node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.renderer.json`
  （仓库 hoist 的 TypeScript **6.0.3**；`apps/desktop/node_modules/typescript` 不存在，`npx tsc` 会解析到根副本）。
  输出共 411 条诊断、825 行。临时输出文件已删除，worktree 回到只读态（`git status` 无新增）。
- **按错误码分布（411）**：TS18046 138 · TS6307 69 · TS18047 49 · TS2339 42 · TS2322 21 · TS2345 18 ·
  TS6133 13 · TS2571 11 · TS2559 11 · TS2540 10 · TS7006 8 · TS7017 5 · TS2740 4 · TS2352 2 · TS2769 2 ·
  TS2704 2 · TS2307 1 · TS2493 1 · TS2367 1 · TS2554 1 · TS18048 1 · TS7016 1。
- **按顶层目录（411）**：`test/` 190 · `renderer/` 178 · `src/` 42 · 仓外相对路径 1
  （`../../packages/core/src/errors/session-fs-errors.ts:210` 的 TS2307）。
  ⇒ 与 `wave-e.md:1473` 的「test/ 190 / renderer/ 178 / src/ 42」逐项吻合（它少算了那 1 条仓外项）。
- **TS18046 按文件（138）**：`SettingsViews.tsx` 69 · `ModelSamplingView.tsx` 18 · `AgentEditorView.tsx` 18 ·
  `WorkspaceSettingsView.tsx` 9 · `FetchModelsModal.tsx` 7 · `AgentDefinitionEditorForm.tsx` 4
  ‖ `Tooltip.tsx` 4 · `token-usage-stats-view.test.tsx` 6 · `fetch-models-modal.test.tsx` 2 ·
  `workspace-push-menu.test.tsx` 1。
- **无记忆写入**（硬纪律：本组禁写 `docs/apm/`）。

## 依赖关系

本组不引入任何依赖。§5 的两个 compaction 通道类型补齐依赖
`shared/ipc-types.ts`（已在位）→ `handlers/compaction-conditions.ts`（已在位），
**不需要 core 或 mobile 侧任何配合**，是全组最干净的依赖。

---

# 1 · 注记复核表

## 1.1 §6 #6 —— `invoke-registry` 无响应类型组（§5）

| # | 注记里的主张 | 复核做法 | 实测 | 判定 |
|---|---|---|---|---|
| C1.1 | 三个工厂不给类型实参时推断成 `unknown`（`invoke-registry.ts:135/139/154`） | 定点打开工厂定义 | `noArg<T>` / `withReq<TReq,TRes>` / `withBool<TRes>` 三处签名与注记逐字一致 | ✅ |
| C1.2 | 「共 30 个封装落在这一档」 | 按 §5.1 的四张表逐行数 | 服务商/模型 14（`:474/:475/:479/:483/:487/:491/:495/:499/:503/:507/:511/:515/:519/:523`）+ agent-registry/YAML 5（`:527/:532/:536/:544/:548`）+ 压缩/备份 4（`:649/:653/:657/:658`）+ 云同步 7（`:667/:668-680/:681/:685/:689/:693/:694-695`）= **30** | ✅ 数字精确 |
| C1.3 | 排除项核对：`:528 ipcAgentRegistryGet`、`:540 ipcAgentRegistryCreateBlank` 已带类型 | 读原文 | 分别是 `withReq<{agentId}, IpcResult<AgentRegistryGetResponse>>` 与 `withOptionalReq<AgentRegistryCreateBlankRequest, IpcResult<{agentId:string}>>`，确实已带 | ✅ 未误伤 |
| C1.4 | 「db 统计整组无响应类型 ❌ 不成立，台账须删」 | 读 `invoke-registry.ts:659/663` | `ipcDbStats: noArg<IpcResult<DbStatsResult>>`、`ipcDbMaintenance: noArg<IpcResult<DbMaintenanceResult>>` —— **确已带类型**，台账 §6 #6 的「db 统计」确为讹传 | ✅ 更正正确，且与台账公开分歧、有据 |
| C1.5 | 「台账写的 `474-525` 行号区间不完整」 | 对照台账 §6 #6 原文与实测 | 台账写的七个组里只有前两组落在 474–525 内 | ✅ 判断成立 |
| C1.6 | 「138 = 125 + 13，两族不相干」 | 跑 tsc 后按文件分组 | TS18046 共 **138**；6 个 renderer 生产文件合计 **125**，`Tooltip.tsx`(4)+3 个测试文件(9) 合计 **13** | ✅ 完全吻合 |
| C1.7 | 13 条 `.props` 族的具体位置 | 逐条对 tsc 输出 | `Tooltip.tsx` 4 条 + `token-usage-stats-view.test.tsx` 6 条 + `fetch-models-modal.test.tsx` 2 条 + `workspace-push-menu.test.tsx` 1 条 = 13，文件集完全一致（列内行号未逐条核，但文件与条数闭合） | ✅ |
| C1.8 | 「不得算进本条消减账」这条口径本身 | 判断 | 正确：13 条来自 `react-test-renderer` 的 `TestInstance.props`，与 registry 的 `unknown` 无因果链；混账会让 wave-e 的棘轮批次对不上 | ✅ |
| C1.9 | `:649/:653` 两个 compaction 通道是「唯一零风险纯补签名」 | 读 `shared/ipc-types.ts` + handler | `ipc-types.ts:1613 CompactionConditionsDto`、`:1622 CompactionConditionsSetRequest` 在位；`handlers/compaction-conditions.ts:12` 返回 `IpcResult<CompactionConditionsDto | null>`、`:24` 入参 `CompactionConditionsSetRequest` 返回 `IpcResult<void>` —— **handler 侧一字都不用改** | ✅ |
| C1.10 | §5.3 步骤 1「`WorkspaceSettingsView.tsx` 的 9 条全消」 | 读 tsc 输出 + 打开源码 | 9 条 = `:103`(×2)/`:104`/`:106`/`:107`/`:111`/`:112` 七条来自 `compactionRes`，`:153`/`:156` 两条来自 `res`；`WorkspaceSettingsView.tsx:103` 是 `if (compactionRes.ok && compactionRes.data)`、`:141` 是 `await ipcCompactionConditionsSet({…})`、`:156` 是 `toastSettingsError(res.error.message)` —— **两条变量全部出自这两个通道** | ✅ 消减账闭得住 |
| C1.11 | 「并入 N-P1-05 的 P2 侧」的边界描述是否自洽 | 对 `SPEC.md` §2 分片表 + `wave-e.md` X2 | `SPEC.md:22` 分片表写明「#6 invoke-registry（并入 N-P1-05 P2 侧注记）」；`wave-e.md:217` 是 N-P1-05 本体、`step-4` 是分批清账 —— **归属划分本身自洽** | ✅ 边界描述成立 |
| C1.12 | §5.4 声称 wave-e「直接引用 §5.2 的按文件分布与 §5.3 的消减顺序」 | 全文检索 `wave-e.md` 里的 `wave-b-apps` / `125` / `§5` | `wave-e.md` 里 `wave-b-apps` 只在 `:888` 出现一次且与本条无关；`:244/:245` 有自己的 TS18046 目录分布表，`:300-307` 有**自洽的 R1–R6 分批表**（R2 = `SettingsViews.tsx` 79 条整体、R3 = `AgentEditorView`+`ModelSamplingView`+`AgentDefinitionEditorForm` 55 条），**既未引用 §5.2 也未引用 §5.3**；§5.3 步骤 1 的 `WorkspaceSettingsView` 9 条在 R1–R6 里没有归属批次（只能落进 R6「剩余长尾」） | ❌ **见 MF-2** |

## 1.2 §6 #7 —— `ChatComposer` scope 不一致（§6.2）

| # | 注记里的主张 | 复核做法 | 实测 | 判定 |
|---|---|---|---|---|
| C2.1 | 台账 §6 第 7 行原文逐字保留 | 逐字 diff | §6.2 引用的整段与 `ledger-v2.md:299` **一字不差**，包括「✅代码链路复核成立」「保留 P1-suspected，不入账」 | ✅ 保留完整 |
| C2.2 | 有没有擅自入账 | 通读 §6.2「本分片的处置」四条 | 明确写「**不立条目、不进 Wave B 执行面、不进 fix-spec 化范围**」「**不写修法**」；§0.1 条目一览 4 条里也没有它；`SPEC.md:12` 与 `:22` 两处都归为「suspected 留产品确认 / 只注记不 spec 化」 | ✅ **未入账，符合纪律** |
| C2.3 | 「需要产品确认的问题」原文保留 | 对 `ledger-v2.md:299` | 台账要求的「desktop 是否刻意只让引用项目模板？」被**单独加框原文引用、一字不改** | ✅ |
| C2.4 | 环节① `client.ts:261-267` 原样返回 | 读源码 | `function vfsScope(workspaceScope, projectId?, sessionId?): VfsScopeRequest { return { workspaceScope, projectId, sessionId }; }` —— 确无任何加工 | ✅ |
| C2.5 | 环节② 两个调用点 | 读源码 | `ChatComposer.tsx:189-191` = `ipcWorkplaceBuildListRows(vfsScope("session", projectId, sessionId))`；`FileReferencePicker.tsx:65-67` 同款 | ✅（台账写 `:189-193`，spec 收窄成 `:189-191`，两者都对） |
| C2.6 | 环节③ main 侧 handler | 检索 | `handlers/workplace.ts` 的 `handleWorkplaceBuildListRows` → `resolveVfsScopeFromRequest` → `getWorkplaceForScope(rt, scope)` 三跳成立（`getWorkplaceForScope` 在 `resolve-vfs-scope.ts:84-90`） | ✅ |
| C2.7 | 环节④ 映射本体 `:30-34` 把 `'session'` 映成 `{kind:"project"}`、丢 `sessionId` | 读源码 | `case "session":`（:30）→ `return { kind: "project", projectId: req.projectId };`（:34），全程不读 `req.sessionId` | ✅ **逐字属实** |
| C2.8 | 环节⑤ 取到 project 域 workplace | 读 `getWorkplaceForScope` | `:88 return rt.workplace(scope)`，`scope.kind === "project"` ⇒ project 域 | ✅ |
| C2.9 | 注记「新核」的 `:35-46` `chat` 分支同时校验 `projectId` 与 `sessionId` | 读源码 | `case "chat":`（:35）校验 `projectId`（:36）与 `sessionId`（:39），返回 `{kind:"session", projectId, sessionId}`（:42-46） | ✅ 「改一个字符串即可」的前提成立 |
| C2.10 | 「逐跳闭合」的措辞是否过强 | 复核注记实际闭合的范围 | 注记的表格只闭合了**候选列**这一半（①→⑤）。台账病灶的另一半「core hydrate 走 `toolCtx.vfs` = session 域」在 §6.2 里**是从台账继承的、本轮未复核**。我独立补核：`packages/core/src/domain/agent/run-agent-turn.ts:733/868/1247` 三处都是 `runtime.sessionVfs(scope.projectId, scope.sessionId)`，`:1103` 的 JSDoc 明写「子 agent `toolCtx.vfs = runtime.sessionVfs(projectId, parentSessionId)`」⇒ **这一半也成立，但成立依据不在注记里** | ⚠️ **见 MF-3**（措辞问题，不改结论） |
| C2.11 | 建议在 `ledger-v2.md` §7 补一条拍板项、拍板前 wave-e 不得「顺手修正」映射 | 判断 | 与 §7 现有 ★4/★5/★16/★17 同级合理；「不得顺手修正」是本轮最有价值的一条护栏 —— 因为 `resolve-vfs-scope.ts` 确实在 X1 门禁收口的路径上 | ✅ |

## 1.3 分片级注记节（§6.1）

| # | 主张 | 复核 | 判定 |
|---|---|---|---|
| C3.1 | 「30 个无响应类型通道的清单」归属本文 §5，是 wave-e 的**输入数据**不是执行面 | 与 §5.1/§5.4 自洽性检查 | ✅ 内部自洽（对外引用未兑现，见 MF-2） |
| C3.2 | 「`ChatHistorySearchPanel.tsx:106` 的 TS2345 是一处真运行时缺陷，不是类型债」 | 读 `ChatHistorySearchPanel.tsx:51/106/263-266` + `ipc-types.ts:211-220` | ✅ `:51` 声明 `useState<string \| undefined>`、`:106` 传 `result.error`（`IpcErrorPayload` 对象）、`:265` 把 `{error}` 当 React child —— 定性正确 |
| C3.3 | 「`Tooltip.tsx` + 4 个测试文件的 13 条不在 N-P1-05 的 125 账里」 | 与实测吻合 | ✅（是 1 个测试文件 + `Tooltip.tsx`，措辞「4 个测试文件」不严谨，实测是 **3** 个测试文件共 9 条 + Tooltip 4 条，见 OBS-4） |
| C3.4 | §6.1 表里「`WorkspaceSettingsView.tsx` 的 9 条 TS18046 → §5.3 步骤 1，可搭 §1 的车」 | 与 §1 依赖节的「424 → 415」对照 | ⚠️ 归属正确，但**搭车后的目标数字同样受 MF-1 影响** |

---

# 2 · 「renderer 基线可量化降至 423」主张核算

## 2.1 主张出处

| 出处 | 原文 |
|---|---|
| `wave-b-apps.md:49-51`（§0.3「另核到台账未记的两条」） | 「`ChatHistorySearchPanel.tsx:106` 在 424 基线里是 **TS2345** … ⇒ §2 修完，renderer 基线应从 **424 降到 423**。这是本分片唯一可量化到个位的验收锚点。」 |
| `wave-b-apps.md:43`（§0.3 表格第一行） | 「`renderer` typecheck **424** 条错误 \| **424** ✅ 一致 \|（`apps/desktop` 下）实跑」 |
| `wave-b-apps.md:265-268`（§2 验收第 4 条） | 「⇒ **从 424 条降到 423 条**，且 `ChatHistorySearchPanel.tsx` 不再出现在输出里。（424 是 `baseline.md` 的实跑基线；降不到 423 说明改法没落在 `:106`。）」 |
| `wave-b-apps.md:171`（§1 依赖·搭车） | 「若同 PR 做，验收里那条「renderer 仍为 424」要改成「**424 − 9 = 415**」」 |

## 2.2 算法拆解（本分片在 renderer 基线上到底能消几条）

逐条把本分片 4 个条目 + 2 个注记过一遍，看谁动了 `tsconfig.renderer.json` 的诊断集：

| 条目 | 触碰文件 | 是否落在 `tsconfig.renderer.json` 的 include（`renderer/**` + `shared/**` + `test/**`）里 | 对基线的净效应 |
|---|---|---|---|
| §1 N-P1-04 定时器闭包 | `renderer/features/settings/WorkspaceSettingsView.tsx` | ✅ 在 | **0**（纯行为缺陷，改动前后类型面不变；本分片自己在 `:131` 也写明「本条不改类型面」） |
| **§2 §6#5 搜索面板白屏** | `renderer/features/chat/ChatHistorySearchPanel.tsx:106` | ✅ 在 | **−1**（唯一一处） |
| §3 AM-1 forgetSession+LRU | `apps/mobile/src/...` | ❌ 不在（mobile 工程，走 `tsconfig.build.json`） | **0** |
| §4 N-P1-03 死路由参数 | `apps/mobile/src/...` | ❌ 不在 | **0** |
| §5 §6#6 invoke-registry | `renderer/ipc/invoke-registry.ts` | ✅ 在，但**不进本波执行面**（§0.1 明写「不进本波执行面」） | **0（本波）**；若未来搭 §1 的车，则额外 **−9** |
| §6.2 §6#7 scope | `renderer/features/chat/ChatComposer.tsx` 等 | ✅ 在，但**不立条目、不写修法** | **0** |

⇒ **算法本身是对的**：本波唯一的 renderer 净效应就是 §2 那一处 TS2345，**减量恰好 1 条**。

## 2.3 减量的「牙齿」验证：改 `:106` 会不会顺带多出/少掉别的诊断

- 现状（实跑 tsc 输出逐字）：`renderer/features/chat/ChatHistorySearchPanel.tsx(106,20): error TS2345: Argument of type 'IpcErrorPayload' is not assignable to parameter of type 'SetStateAction<string | undefined>'.` —— **恰好一条、一个位置**。
- 修法 `setError(result.error.message)`：`shared/ipc-types.ts:211-216` 的 `IpcErrorPayload.message` 声明为 `readonly message: string` ⇒ 实参类型正确收敛为 `string`。
- 新写法**不读任何 `unknown`**（`result` 本身是 `IpcResult<ChatMessageDto[]>`，本就有类型）⇒ 不会新增 TS18046，也不会因 `.message` 可选性产生新报错。
- ⇒ **净效应严格等于 −1，无残差。算法层面无异议。**

## 2.4 绝对基线对账（本轮实跑，结果不支持 424）

我按本分片给的命令在 `fe79b781` 工作区实跑（TypeScript 6.0.3，仓库 hoist）：

| 口径 | 本分片 `wave-b-apps.md` | `wave-e.md`（N-P1-05 本体） | **本轮 reviewer 实跑** |
|---|---:|---:|---:|
| renderer 总诊断数 | **424**（「✅ 一致」） | **411**（`:266`/`:1472` 明写「台账 424 / 本分片实测 411」） | **411** |
| `test/` | — | 190 | 190 ✅ |
| `renderer/` | — | 178 | 178 ✅ |
| `src/` | — | 42 | 42 ✅ |
| TS18046 总数 | 138 | 138（`:244`） | **138** ✅ |
| 其中 invoke-registry 族 | 125 | — | **125** ✅ |
| 其中 `.props` 族 | 13 | — | **13** ✅ |
| `SettingsViews.tsx` | 69（TS18046） | 79（总诊断，`:303`） | 69 TS18046 / 79 总 ✅ |
| `ChatHistorySearchPanel.tsx` TS2345 | 存在（`:106,20`） | 存在（`:257-258`） | **存在** ✅ |

**结论**：本分片 `wave-b-apps.md:43` 的「**424** ✅ 一致」是**错的**。同一命令在同基线上，
`wave-e.md` 与本 reviewer 都得 **411**。⇒

- §0.3「424 ✅ 一致」应为「**411**（与 `wave-e.md` X2 一致；台账 §2.8 的 424 是旧机位数字，权威以 `baseline.md` S1 为准）」。
- §2 验收第 4 条的「**降到 423**」应为「**降到 410**」；括号里「降不到 423 说明改法没落在 `:106`」应同步改成 410。
- §1 依赖节的「**424 − 9 = 415**」应为「**411 − 9 = 402**」。
- 相对量 −1 / −9 **不变**，全部可执行性不受影响，只是绝对值对不上。

---

# 3 · 债务池抽验表（apps-mobile 簇）

**口径**：Plan §12 定「其余 P2/P3 留台账作债务池」。`ledger-v2.md:201` 记 apps-mobile **P2 20 / P3 26 = 46 条**；
逐条明细在 `synth/apps-mobile.md` 的 `AM-4`…`AM-49`（P2 20 条 = AM-4…AM-23，P3 26 条 = AM-24…AM-49，合计 **46**，与台账计数逐项对上）。
抽验比例 **9/46 = 19.6% ≥ 10%**，P2 取 5 条、P3 取 4 条。

| # | ID | 级 | 台账/synth 位置 | 病灶摘要 | 实测（`fe79b781`） | 还在吗 | 定级 | 已被覆盖 | 重复立项 |
|---|---|---|---|---|---|---|---|---|---|
| S1 | **AM-8** | P2 | `apps/mobile/src/services/snapshot-file-hash.ts:21-42` | `readStream` 开的原生读流在 `onEnd`/`onError` 后都不 `close()`，每次云同步至少泄漏 1 个 fd | `hashSnapshotFile` 全文 43 行，`:21-25` 开流、`:27-40` Promise、`:39` `onEnd(resolve)`、`:36-38` `onError(reject)`，**全文件零 `close`**；对照组 `db-backup.service.ts` 的 `writeStream` 有 try/finally close | ✅ 在 | P2 合理（fd 泄漏、需长期累积才撞上限、有绕行） | ❌ 未覆盖（不在 wave-b-apps 执行面） | 无 |
| S2 | **AM-13** | P2 | `apps/mobile/src/web/tsconfig.json:8` + 2 处已命中 | `lib:["ES2018","DOM"]` 但未设 `types`，`@types/node` 的 `/// <reference lib="es2020"/>` 把 ES2020 无条件拉进来，门禁失效；已命中 `block-split.ts:42 trimStart()`、`annotate-collect.ts:132-133` | `web/tsconfig.json:8` 确为 `"lib": ["ES2018","DOM"]`、确无 `types`；`block-split.ts:42` 确为 `FENCE_OPEN_RE.exec(line.trimStart())`，文件头 `:17-18` 自述「es2018 双端安全 / 禁 lookbehind」；`annotate-collect.ts:132/133` 确为 `trimStart/trimEnd`；`node_modules/@types/node/index.d.ts` 确有 `/// <reference lib="es2020" />` | ✅ 在 | P2 合理（门禁失效但目前没写错；有绕行） | ❌ 未覆盖 | 无 |
| S3 | **AM-17** | P2 | `apps/mobile/src/screens/stack/AboutScreen.tsx:88-93` + `:130` | catch 里 `await persistFailedUpdateCheck(appUi)` 自身抛错会吞掉原始错误；`void runManualCheck()`（`:130`）变成裸 rejection | catch 块在 `:95-98`，`:96` 确为 `await persistFailedUpdateCheck(appUi)` 且其后才有 `showToast`；`void runManualCheck()` 实际在 **`:158`**（`:78` 是 `runManualCheck` 定义、`:92` 是 `showUpdateAlert` 调用） | ✅ 在 | P2 合理（有 `.catch` 托底、无反馈但不自愈性崩溃） | ❌ 未覆盖 | 无 |
| S4 | **AM-20** | P2 | `theme/ThemeProvider.tsx:34-64` + `storage/app-ui-keys.ts:40` | 主真源两侧不一致（`APP_UI_DEFAULTS[THEME]='light'` vs Provider 自算 `system==='dark'?'dark':'light'`）；且从不切到系统模式，首帧恒 light ⇒ 深色用户每次冷启动闪一下白 | `app-ui-keys.ts:40` 确为 `[APP_UI_KEY_THEME]: 'light'`；`ThemeProvider.tsx:31` 确为 `useState<ThemeMode>('light')`；`:46-52` 首帧分支只会给出 `raw` 或 `system`，**从不给 `'system'`**；`:53/:59` 两个 `setLoaded(true)` 之后消费面不读 `loaded` | ✅ 在 | P2 合理（一帧闪烁，有绕行） | ❌ 未覆盖 | 无 |
| S5 | **AM-15** | P2 | `storage/chat-composer-draft.ts:18` | 进程级 `bySession` Map 无上限、无删除链路清理 ⇒ 删会话后草稿长期驻留 | `chat-composer-draft.ts:18` 确为 `const bySession = new Map<string, ChatComposerDraft>();`，全文件**无容量上界、无按会话清理** | ✅ 在 | P2 合理（内存驻留，非功能性） | ❌ **未被 wave-b-apps §3 覆盖** —— §3 只治 `session-stream-unit-manager` 的两张 Map，`chat-composer-draft` 是**第三张**无界 Map，修法（改 `createScopeKeyCache`）连口径都不一样 | 无（但**极易被误认为「§3 已经治了」**，见 OBS-2） |
| S6 | **AM-27** | P3 | `services/document-io.ts:47` | 临时文件名不含随机/时间戳，直接用 `options.fileName` ⇒ 并发导出互相覆盖/提前 unlink | `document-io.ts:47` 确为 `const tmpPath = \`${fs.dirs.CacheDir}/${options.fileName}\`;`，无任何后缀 | ✅ 在 | P3 合理（竞态、需并发导同一模板触发） | ❌ 未覆盖 | 无 |
| S7 | **AM-29** | P3 | `db/connection.ts:96` | `initPromise` 只在 `closeMobileConnection()` 里清空，open/bootstrap 抛错后复用同一个已 reject 的 promise ⇒ 导入链拿到「上一次 boot 的错误」 | `db/connection.ts:96` 确为 `return initPromise;`；`:103` 确为 `initPromise = undefined`，且**只在 `closeMobileConnection()` 内**（`:100-104`），`open`/`bootstrap` 的失败分支（`:88-89`）不清 | ✅ 在 | P3 合理（有 `retry()` 自愈路径，只是误导排障） | ❌ 未覆盖 | 无 |
| S8 | **AM-31** | P3 | `services/session-stream-unit-manager.service.ts:1971-1973` | 进程退出时的统一清理里 `settledProjections.clear()/idleMessageViews.clear()/notifyChanged()` 的顺序问题 | 实际在 **`:1970`/`:1971`/`:1972`**（`settledProjections.clear()` / `idleMessageViews.clear()` / `notifyChanged()`），synth 写的 `:1971-1973` 整体偏移 1 行；顺序本身（先清后通知）属实 | ✅ 在（行号偏移 1） | P3 合理（清理/一致性项） | ⚠️ **与 wave-b-apps §3 同文件**（§3 步骤 5 会把这两张 Map 换成 LRU、步骤 6 要求同步改 `:1971/:1970` 两处 `clearAll`）⇒ §3 落地后本条的清理面会顺带一起变，**不构成冲突，但改同一区域** | 无 |
| S9 | **AM-42** | P3 | `screens/stack/SessionDetailScreen.tsx:184-195` 事件双发 | 置位流程里 `DeviceEventEmitter.emit('session-transcript-changed')` 发两次（`:184` 压入成功后一次、`:192` `onFinally` 再一次） | `:184-186` 确发一次（紧跟 `:181` 的 toast），`:190-195` 的 `onFinally: async outcome => { if (outcome.ok) { emit(...) } }` 确发第二次 | ✅ 在 | P3 合理（重复事件、可观测级） | ❌ 未覆盖 | 无 |
| S10 | **AM-48** | P3 | `docs/apm/RULE.md:21` | RULE「composer tag 多行闪烁」条目把根因指向 `ComposerAtPathInput.tsx` 的 TextInput 内联 span 实现，而该实现已整体删除 | `RULE.md:21` 确仍在、确写「胶囊内联在 TextInput 内容不可避免…见 `apps/mobile/src/components/chat/ComposerAtPathInput.tsx`」；该文件**仍存在但已是 243 行的 WebView 壳**（`:3` 自述「`ComposerInputWebView` 单引擎」、`:6` 明写高亮分段/原子删/选区真源「随 WebView 化整体消失」、`:229` 渲染 `<ComposerInputWebView>`，全文零 `<TextInput>`） | ✅ 在 | P3 合理（文档腐化，防再犯类） | ❌ 未覆盖（属 Wave E 文档面） | 无 |

**抽验小结**：**10 条（AM-8/13/15/17/20/27/29/31/42/48）全部「病灶仍在」**，定级全部合理（无一例该升或该降），
**0 条已被 fix-spec 覆盖**（AM-31 与 §3 同文件但不同面），**0 条重复立项**，**3 处行号轻微漂移**（AM-17 `:130→:158`、AM-31 `1971-1973→1970-1972`、AM-13 的 `@types/node` 引用行）。
⇒ apps-mobile 债务池健康，**不构成 Go/No-Go 障碍**。

---

# 4 · must-fix 清单表

| ID | 级 | 位置 | 问题 | 建议修法 | 置信 |
|---|---|---|---|---|---|
| **MF-1** | **P1** | `wave-b-apps.md:43`、`:49-51`、`:131`（同源）、`:171`、`:265-268` | **renderer 基线数字错**。`:43` 断言「424 ✅ 一致」，但同基线同命令实测 **411**（`wave-e.md:266/1472` 早已独立测到 411 并记成口径差，本分片漏掉了这次修正）。连带 §2 验收第 4 条的「**降到 423**」应为 **410**、§1 搭车的「**424 − 9 = 415**」应为 **402**、`:131` 的「仍为 424」应为 **411**。**这条会让实现者照抄验收命令时当场跑不出来**（TS2345 消掉了但总数停在 411 而不是 423）。 | 把 `:43` 改成「**411**（与 `wave-e.md` X2 `:266` 同口径；台账 §2.8 的 424 是旧机位数字，权威以 `baseline.md` S1 为准）」；`:171` 改「411 − 9 = 402」；`:131` 改「仍为 411」；`:265-268` 改「**从 411 降到 410**…（降不到 410 说明改法没落在 `:106`）」。相对量 −1 / −9 一律不动。 | confirmed（本轮实跑 411，与 wave-e 双向吻合） |
| **MF-2** | **P2** | `wave-b-apps.md:715-717`（§5.4「与 wave-e 本体的边界」）对 `wave-e.md:300-307`（X2 Step 4 分批表） | **跨分片悬空引用**。§5.4 写「wave-e.md 里 N-P1-05 的『先按文件分批清账』一节，**直接引用 §5.2 的按文件分布与 §5.3 的消减顺序**，不重复展开通道清单」——但 wave-e 的 R1–R6 是**自洽且未引用 §5 的**：R2 = `SettingsViews.tsx` 79 条整体、R3 = `AgentEditorView`+`ModelSamplingView`+`AgentDefinitionEditorForm` 55 条，与 §5.3「先补 compaction 两通道（零风险）→ 备份/云同步 → 服务商/模型」的排序**不是同一套**；更关键的是 §5.3 步骤 1 的 `WorkspaceSettingsView` 9 条在 R1–R6 里**没有归属批次**，只能掉进 R6「剩余长尾」。⇒ §5 花了整节交付的「零风险第一刀」在 wave-e 的计划里**没有落点**。 | 二选一（doc-fix 定）：① **改 §5.4 的措辞**为「wave-e 的分批表与 §5.3 是两套排序，§5.3 提供的是逐通道类型映射输入；**须在 wave-e 的 R1–R6 表里补一行「R0：compaction 两通道补签名 −9」并加脚注引用 wave-b-apps §5.3 步骤 1**」；② **改 wave-e 的分批表**加 R0 并回引 §5.3。**不要**两边都留成「会互相引用」的将来时。 | confirmed（wave-e 全文无 `125`/`138`/`§5` 引用，`wave-b-apps` 仅 `:888` 提及且与本条无关） |
| **MF-3** | **P3** | `wave-b-apps.md:751`（§6.2「⇒ ①②③④⑤ 逐跳闭合」）与 `:757` | **措辞过强**。「①②③④⑤ 逐跳闭合」实际只闭合了**候选列**这一半；台账病灶的另一半「core hydrate 走 `toolCtx.vfs` = session 域」在 §6.2 里是从台账**继承未复核**的。⇒ 读者会误以为「不一致」的两端都已一手验证。（**注记结论不变、不需要改判 suspected**——我独立补核了那一半：`packages/core/src/domain/agent/run-agent-turn.ts:733/868/1247` 三处均 `runtime.sessionVfs(scope.projectId, scope.sessionId)`，`:1103` JSDoc 明写子 agent 同款，**core 侧确为 session 域**，病灶两端都真。） | 在 `:757` 后补一句：「**本轮补核另一半**：core 侧 `run-agent-turn.ts:733/868/1247` 三处 toolCtx.vfs 均取 `runtime.sessionVfs(projectId, sessionId)`，`:1103` JSDoc 自述同款 ⇒ 台账『hydrate 走 session 域』亦成立，病灶两端俱在。」并把 `:751` 的「逐跳闭合」改为「候选列一侧 ①②③④⑤ 逐跳闭合」。 | confirmed（我已补核成立；属表述精度，不改结论） |

## 非阻塞观察（记入「矛盾与存疑」，不占 must-fix 额度）

| ID | 内容 |
|---|---|
| **OBS-1** | **任务前提的一处不成立**：交办要求必读的「`docs/apm/RULE.md`（desktop `workspaceScope:"session"` 解析为 project scope 的**历史命名条**——正是 #7 的机理）」——**`RULE.md` 里没有这条**。全文检索 `workspaceScope` / `vfsScope` / `resolve-vfs-scope` / `kind: "project"` 均无命中；最接近的历史记录在 apm memory：`20260819-global-fs-func-review-s1-s4.md:19` 记「`resolve-vfs-scope.ts` L30-31 **重复 `case "session"` 标签**（死代码，无行为影响，TS 不报错）——P2 待删一行」，`20260819-global-fs-manager-impl.md:35` 记 `WorkspacePanelScope` 扩展 + `resolve-vfs-scope` 分流 —— **两条都只讲 global/meta 域扩展与一行重复标签，与「session 被映成 project 是历史命名」无关**。⇒ `wave-b-apps.md` §6.2 **本身并没有引用这条 RULE 记录**（它引的是 `resolve-vfs-scope.ts:48` 对 `physical` 的注释，那条属实），所以 **spec 不需要改**；但 #7 子问题 3 里「与真实意图不符的**历史命名**」这个论断目前**没有文档背书**，只靠代码事实。建议 #7 拍板材料里把这一句的支撑从「RULE 记录」改为「代码事实 + 待产品确认」。 |
| **OBS-2** | **AM-15 极易被误认为已被 §3 覆盖**：`chat-composer-draft.ts:18` 是**第三张**进程级无界 Map（§3 只治 manager 里的 `idleMessageViews`/`settledProjections`），修法（改用 `createScopeKeyCache<ChatComposerDraft>` 并在三处删除链路补清理）与 §3 完全不同。若 §3 的 PR 描述里写了「治了无界 Map」，会把 AM-15 误标成已覆盖。建议在 §3 的「明确不做」里补一句点名 `chat-composer-draft.ts`。 |
| **OBS-3** | 台账 §6 #6 的「**db 统计**整组无响应类型」确为讹传（`invoke-registry.ts:659/663` 已带类型），spec §0.3/§5.1 的更正是对的。但**台账本身还没改**——`ledger-v2.md:298` 仍写着「服务商/模型/agent-registry/YAML/云同步/备份/db 统计整组返回 `Promise<unknown>`」。执行侧照台账做会白干一轮，doc-fix 应同步把这一项从台账删掉。 |
| **OBS-4** | §6.1 表里写「`Tooltip.tsx` + **4 个**测试文件的 13 条 `.props` TS18046」——实测是 `Tooltip.tsx` 4 条 + **3** 个测试文件 9 条（`token-usage-stats-view.test.tsx` 6 / `fetch-models-modal.test.tsx` 2 / `workspace-push-menu.test.tsx` 1）。条数 13 对，文件个数措辞差一个。 |
| **OBS-5** | 台账 §2.8 N-P1-05 记「`renderer/features/**` 恰为 **160** 条」——我实测 `renderer/` 顶层 178 条、`renderer/features/` 口径未单独跑；本轮不核（超出本组职责），但与 wave-e 的 411/178/190/42 分布是同一套数，供 judge 自行对账。 |

## 验收断言的牙齿自查（RULE 三条判据）

- **① 有牙吗**：MF-1/MF-2/MF-3 都能被「改回去就红」判别 —— 把 `:43` 改回「424 ✅ 一致」而 `:265-268` 保留 411，读者按验收跑就会发现数字自相矛盾；把 §5.4 的「直接引用」删掉而 wave-e 的 R1–R6 不加 R0，则 `WorkspaceSettingsView` 9 条确实无处归属。**成立**。
- **② 同源不重叠**：本组的观测面分别是「tsc 输出条数」「wave-e 分批表内容」「core 侧 VFS 取域代码」，三者互不覆盖；没有把同一条缺陷挂在两个观测面下。**成立**。
- **③ 夹具无同族污染**：本组只跑了一条只读命令（`tsc --noEmit`），不写任何测试文件、不动生产代码；临时输出文件已删除，worktree 回到只读态（`git status` 无新增）。**成立**。

---

## 结论

**组 C：有条件 Go（Conditional Go）。**

**一句话理由**：两个注记的事实内核与边界描述全部复核成立、suspected 未被擅自入账、债务池抽验 10/10 健康，
唯一阻碍是 **MF-1 这个基线数字错**——`wave-b-apps.md` 的「424 ✅ 一致 / 降到 423 / 424−9=415」三条数字
在同一基线上应分别是 **411 / 410 / 402**，必须由 doc-fix 先把这三处口径对齐（MF-2/MF-3 建议同轮一并处理），
否则 §2 的验收第 4 条照抄即当场跑不出来；除数字外无一处需要改动修法、证据或结论。