# cr1-core2 · Wave B core2 分片代码评审报告（review round 1，节点 cr1-core2）

- repo：`D:\Dev\nm-worktree\mcr`（feat/repo-mega-cr）
- base_sha：`fe79b781` ／ head_sha：`046f4d9c`
- 本 scope：commit `4829b8d1`（core2 十条：N-P1-02 / M-06 / summarizeToolInput / M-03 / CS-02 / S-D-02 / CS-08 / M-04 / M-01 / B）
- 业务 spec：`docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-b-core2.md`（11 条，七要素完整）
- CR fix-spec：`docs/Iterations/repo-mega-cr-2026-10/cr-fix-spec.md`（draft，Must-fix 段仍为「（首轮评审进行中）」空壳）
- 检查维度：A（需求符合性）+ B（正确性）+ C（质量）+ C-orch（编排收敛）+ G（测试）；D/E/F/H–J/K 不在本节点范围（相关观察入附录）
- C-orch：**适用**（本 commit 同时动 core prompt 域 / llm-protocol 解析层 / provider 域 / vfs 导出 / desktop main + renderer + mobile RN + WebView，且与其前后提交（37df8900 apps 侧、c667be0f Wave C）有交叉面）
- 纪律：readonly。未改任何生产/测试代码、未改 spec、未做任何 git 写。**唯一写入为本文件**（临时探针文件已全部删除）。
- 上一轮结论：none（首轮）

---

## 1）相对上轮

首轮，无上轮结论。本节点 10 条落地条目逐条对照 diff + HEAD 现状核对完毕，产出 2 条 P1 + 5 条 P2 must-fix、2 条 open_questions、3 条 spec_deviations。

### 1.1 十条逐项结论

| 条目 | 落地形态 | 结论 |
|---|---|---|
| N-P1-02 layout 白名单 | `normalize-agent-prompt-layout.ts:82-89` 两条 spread + 模块头注释；`skillsEnabled === false` / `skillsPrefix` 非空透传 | **通过**（与 `validate-agent-prompt-layout.ts:307-314` 逐字对齐；4 条新用例含 `=== true` 省略的反向断言） |
| M-06 SSE `data:` 无空格 | 新增 `sse-data-line.ts` + 三 parser 各改 4 行；`payload === ""` 判据并入 `parseSseDataLine` 返回 `null` | **通过**（三 parser 各带自家 payload 的 `SSE-DATA-NS-01/02`，6 条全绿） |
| summarizeToolInput 三面统一 | 新增 `domain/chat/logic/tool-summary.ts` + `public/chat.ts` 再导出 + 三处改引用；`??` 语义由 `T-TS-07` 钉住 | **通过**（全仓 `function summarizeToolInput` 只剩 core 一处） |
| M-03 探针拆分 | **不在本 commit**，落在 `6ffeb5fb`（core1） | **归属偏离**（实现正确，见 SD-1，与 cr1-core1 同源） |
| CS-02 空串守卫 | `compute-replace-result.ts:47-50` 真源守卫 + `vfs-tools.ts:341` / `skill-tool.ts:341-345` 两层 zod `.min(1)` | **通过**（4 条用例，含 replaceAll 死循环超时牙齿） |
| S-D-02 staging 基准 | `vfs-batch.service.ts:266-272` 抽出 `vfsBatchStagingBase()` + `:283-290` 包含断言（带 `sep`） | **实现通过**（3 条新用例 + 2 条夹具迁移，全绿） |
| CS-08 skipped 通道 | `parentLogicalOf` 换锚点 + `BatchExportSkip` 可选字段 + desktop `console.warn` + 条件回填 | **实现通过**，DTO 未同步（B-2） |
| M-04 引用扫描 + in-use 拒绝 | `find-saved-model-references.ts` 加 `chat_session` 段 + 三个扫描段统一 `safeParseRecord`；`provider.service.ts:237-264` 前置拒绝 + deps 增 `conn` | **实现基本正确，但 B2 软指针过滤的前提不成立**（A-1，P1） |
| M-01 attempt 已产出闩锁 | `model-request.service.ts:227-274` 逐 attempt 复位 + 先置闩再转发 + `!attemptEmitted` 合取项 | **通过**（4 条新用例，含 `usage/done` 不置闩的反向护栏） |
| B `formSnapshotJson` 补 `mode` | `agent-editor-state.ts:545-551` 无条件 + `?? "all"`；两端基线调用点同步 | **通过**（三处联动齐全，但跨 commit 拆分，见 C-3） |

### 1.2 与其它节点的交叉记账

- **M-03**：与 `cr1-core1/C-1`、`cr1-core1/SD-1` 同一事实。本节点复核确认：`4829b8d1 --name-only` 的 39 个文件里**不含** `load-or-fill-file-cache.ts`，该文件由 `6ffeb5fb` 交付。实现与 core2 spec 修法 4 条逐条对齐（探测提到 `status` 判断外 / `FillResult` 模块私有 / 降级用显式 `degraded` 标记 / 模块头注释已订正），**不是实现问题，是记账问题**，本节点不重复开 must-fix。
- **CS-07**：不在本 commit，落在 `c667be0f`（Wave C），与 CS-06 **同一个 commit**（见 C-2）。
- **B 的 apps 侧**：`AgentEditorView.tsx` / `useAgentEditorFormState.ts` 的基线补 `mode` 落在 `37df8900`（Wave B apps），不在本 commit（见 C-3）。

---

## 2）must-fix

### cr1-core2/A-1 [P1] M-04 的 `currentModelId` 软指针过滤（B2）建立在一个**代码里不成立**的前提上：desktop/mobile 删完 provider 后 `resetCurrentModelId` 永不执行

- **维度**：B（正确性 —— 前置拒绝的判据依赖跨模块契约）+ C-orch（注释把未验证契约写成事实）
- **文件**：`packages/core/src/service/provider/impl/provider.service.ts:243-252`（过滤与注释）、`apps/desktop/src/main/ipc/handlers/providers.ts:94-106`、`apps/mobile/src/screens/stack/ProvidersScreen.tsx:75-88`、`apps/cli/src/provider/commands.ts:95-111`
- **来源节点**：cr1-core2

**问题**

`provider.service.ts` 的前置拒绝把 `currentModelId` 从阻断引用里滤掉，注释给出的理由是：

> `currentModelId` 是**软指针**……CLI（`provider/commands.ts` delete 分支）与桌面（`handleProvidersDelete`）都在 `providers.delete` **成功返回之后**按 `saved.providerId === id` 主动 resetCurrentModelId / resetCurrentProviderId。

逐个打开三个调用方核对，**三个里只有一个成立**：

| 调用方 | 取 `saved` 的时机 | `getSavedById` 结果 | `resetCurrentModelId` 是否执行 |
|---|---|---|---|
| CLI `commands.ts:98-110` | `providers.delete` **之前**算 `clearCurrentModel` | 命中 | ✅ 会 |
| desktop `providers.ts:94-106` | `await rt.providers.delete(id)` **之后**才 `getSavedById` | **恒 `null`**（`deleteByProvider` 已 `DELETE FROM llm_saved_model WHERE provider_id=…`） | ❌ 永不 |
| mobile `ProvidersScreen.tsx:75-88` | 同 desktop，`delete` 之后 | **恒 `null`** | ❌ 永不 |

`findById` 的实现（`sqlite-saved-model.repository.ts:50-60`）在 `rows.length === 0` 时返回 `null`，`saved?.providerId === req.providerId` 恒为 `false`。

⇒ **desktop 与 mobile 上，删除「当前模型所属的 provider」之后，`currentModelId` 悬空指向一个已不存在的模型 UUID。**

**后果链**（全部本机核实过调用点）：

1. `session.service.ts:118-124`：`DefaultSessionService.create` 会 `getCurrentModelId()` 并把结果**复制进新建会话的 `agent_config_json`** ⇒ 悬空 id 被固化进 `chat_session`。
2. `agent-run-shared.ts:110-121`：`resolveSavedModelId({agentModelId, sessionModelId})` 在 agent 无 pin 时返回该悬空 id。
3. `model-request.service.ts:173` → `assert-saved-model-uuid.ts:28-36` 抛 `INVALID_SAVED_MODEL_ID: Saved model not found: <uuid>`，UI 零解释。

⇒ M-04 之前就有这个悬空（那时 `delete(provider)` 无守卫、直接删），但 M-04 把「调用方会 reset」写成了守卫放行的**正式依据**，并据此在注释里断言契约成立。这条断言现在是错的，且它正是让守卫在「provider 是当前模型」时放行的唯一理由。

**改法**（三处，缺一不可）

1. `apps/desktop/src/main/ipc/handlers/providers.ts:94` 与 `apps/mobile/src/screens/stack/ProvidersScreen.tsx:75`：把「取 `currentModelId` + 判定归属」整块**移到 `providers.delete` 之前**（照 `apps/cli/src/provider/commands.ts:98-102` 的现成写法：`clearCurrentModel` 在 delete 前算好，delete 成功后再 reset）。这修掉悬空本身。
2. `provider.service.ts:243-252`：注释改写。当前那句「都在成功返回之后按 `saved.providerId === id` 主动 reset」必须换成实际契约（**delete 之前**判定归属、delete 成功之后 reset），并显式记一句「本过滤依赖上述三个调用方的 delete 前置判定顺序，改动任一调用方必须同步复核」——这条依赖是隐式的，值得在代码里点名。
3. 若第 1 步因故不做（产品决定保留「删完再判」），则第 2 步的过滤必须撤掉：`currentModelId` 应当作硬引用参与阻断，否则就是「明知会悬空还放行」。

**验收**

- desktop + mobile 各补一条用例：置 `currentModelId = M`（`M` 属 provider P）→ `providers.delete(P)` → 断言 `state.getCurrentModelId()` 为 `undefined`（不是 `M`）。
- `provider-service.test.ts` 补一条「仅 `currentModelId` 引用时 `delete` 成功」的正向用例，把 B2 过滤本身钉住（当前零覆盖，见 §6.3）。

---

### cr1-core2/C-1 [P1] 打包约束违背：spec 写死「六个 commit、M-04 / M-01 各自独立」，实际是**单 commit 打包十条**

- **维度**：C-orch（跨提交收敛 + 回滚粒度）
- **文件**：`4829b8d1` 整体（39 files, +1088/−119）
- **来源节点**：cr1-core2

**问题**

`wave-b-core2.md` §0.1 与 §12.1 把打包约束写成**硬约束**：

> ① **M-04 与 M-01 各单列为独立 commit**（台账量级均为 M，§0.2）……C3 因此拆成 C3a（其余六条）+ C3b（M-04）+ C3c（M-01）⇒ 本 PR 合计 **六个 commit**（C1 / C2 / C3a / C3b / C3c / C4），不是四个；
> ⚠️ 本条有一个必须避开的陷阱……**C2（M-06）必须先于 C3c（M-01）落地**（§2 依赖栏②：否则 `T-RR-1` 会假绿）。

`4829b8d1` 是**一个** commit，同时含 C1（N-P1-02）、C2（M-06）、C3a（CS-02 / CS-08 / S-D-02 / summarizeToolInput / B）、C3b（M-04）、C3c（M-01）五条的全部内容。

**后果**（spec 自己给出的理由，逐条仍然成立）：

1. **回滚粒度丧失**。M-01 改的是重试循环的**可重试语义**，spec 风险栏自己写明「改错的两个方向都有静默后果：闩锁太松 ⇒ 重复输出 + 重复计费；闩锁太紧 ⇒ 首字后断流的黑洞再也重试不了」。现在要回滚它，必须连同 N-P1-02 的白名单、M-06 的解析层、CS-08 的导出结构一起 revert。
2. **M-06 ⇒ M-01 的单向依赖无法二分定位**。spec 依赖栏②说得很具体：只跑 M-01 的 `T-RR-1` 会在「`data:` 无空格仍被整流丢弃」的实现下**假绿**（`text-delta` 压根没到 `onStream`，`seen.length === 1` 因为只收到一次）。这个依赖现在被同一个 commit 吞掉，`git bisect` 落在中间态时无法区分是 M-06 没修还是 M-01 没修。
3. **M-04 / M-01 都是台账量级 M**，spec §0.2 花了整节论证它们「不是 S 级」，结论是「须独立成 commit 以便单独评审与回滚」。这个结论没有被执行。

**改法**（本节点 readonly，给下游两条路，须选一条）

- **方案甲（推荐，保留历史）**：把 `4829b8d1` 用 `git rebase -i` / `filter-branch` 拆成 spec §12.1 的六个 commit（C1 / C2 / C3a / C3b / C3c），commit message 按 §0.1 表格与 §12.1 硬约束①补「本批含 2 条台账量级 M」。**前置条件**：先闭合 A-1（否则拆出来的 C3b 带一个错误前提），以及 B-1（否则 C3c 里带类型错误的测试）。
- **方案乙（不重写历史，只补记账）**：在 `cr-fix-spec.md` 显式记「Wave B core2 的 C1–C3c 已合为单 commit `4829b8d1`，回滚须按文件路径手工 revert，spec §12.1 的六 commit 形态**未执行**」，并在 `ledger-v2.md` 的 M-04 / M-01 两行标注「合入形态偏离：与 C1/C2/C3a 同 commit」。同时把 §0.1 / §12.1 的「六个 commit」改成「六个逻辑变更单元」。

无论哪条，**必须写进 fix-spec**：现状是 spec 承诺的形态与仓库实际形态不一致，下游按 spec 派工时会按六个 commit 去找。

**验收**：`git log --oneline fe79b781..HEAD` 里 core2 相关 commit 数与 `ledger-v2.md` 记载一致；或 `cr-fix-spec.md` 有上述显式偏离记录。

---

### cr1-core2/B-1 [P2] `model-request-retry.test.ts` 两处类型错误；core 测试代码**无任何类型门禁**兜底

- **维度**：G（测试有效性）+ B（错误面）
- **文件**：`packages/core/test/provider/model-request-retry.test.ts:420`、`:459-462`
- **来源节点**：cr1-core2

**问题**

新增用例里有两处构造不符合类型定义：

1. `:420` `throw new LlmStreamTimeoutError("idle");` —— 构造函数是 `constructor(phase: LlmStreamTimeoutPhase, timeoutMs: number, detail?: string)`（`llm-stream-timeout-error.ts:34`），少传 `timeoutMs` ⇒ TS2554。运行时不崩（`tsx` 只转译不做类型检查），但错误消息退化成 `LLM stream idle for undefinedms after the last chunk`，断言里那条「归因可分辨」正是靠这个错误对象判的。
2. `:459-462` `req.onStream?.({ type: "done" });` —— `LlmStreamEvent` 的 `done` 变体是 `{ type: "done"; result: LlmChatResult }`（`adapter.port.ts:50-51`），缺 `result` ⇒ TS2322/2345。同文件的既有两条用例（`:257` / `:283`）都老老实实传了 `120_000` / `90_000`，本条破了这个同文件惯例。

**为什么 CI 抓不到**：`packages/core/tsconfig.test.json` 继承了 `tsconfig.json` 的 `rootDir: "./src"`，而 `include` 含 `test/**/*` ⇒ 本机实跑 `npx tsc --noEmit -p tsconfig.test.json` 产出 **454 条 TS6059**（每个 test 文件一条「not under rootDir」），配置本身不可用；CI 的 `npm run typecheck --workspaces` 走的是 `tsc --noEmit -p tsconfig.json`，`include` 只有 `src/**/*` ⇒ **测试代码零类型检查**。`.github/` 与 `scripts/` 全仓 grep `tsconfig.test` 零命中，确认没有任何门禁引用它。

**改法**

1. 两处补齐：`:420` → `new LlmStreamTimeoutError("idle", 90_000)`；`:459-462` 的 `done` 事件补一个最小 `result`（或改用 `{ type: "usage", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }` —— 但 `usage` 已在上一行发过，重复发同一类型不增加覆盖面，**建议补 `result`**）。
2. 把 `packages/core/tsconfig.test.json` 的 `rootDir` 覆盖为 `"."`（或删掉继承来的 `rootDir`，让 `noEmit` 生效），使它可被 `tsc -p` 使用；在 CI 的 Typecheck 步后加 `npx tsc --noEmit -p packages/core/tsconfig.test.json`。**这是本条的根因，不修则同类问题会继续流入。**

**验收**：`npx tsc --noEmit -p packages/core/tsconfig.test.json` 退出码 0（当前 454 错）；`model-request-retry.test.ts` 13 → 14 条 `# fail 0`。

---

### cr1-core2/B-2 [P2] CS-08 的 `skipped` 没同步进 IPC DTO，renderer 类型面上这个字段直接消失

- **维度**：A（需求符合性 —— 数据通道未贯通）+ B（契约）
- **文件**：`apps/desktop/shared/ipc-types.ts:530-534`（`VfsBatchExportStageResult`）、`apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:32-36`（`StagedExport`）
- **来源节点**：cr1-core2

**问题**

`stageVfsBatchExport` 的返回类型 `ExportStageResult` 加了 `skipped?`（`vfs-batch.service.ts:239-245`），但：

- `handleVfsBatchExportStage` 的返回类型标注是 `IpcResult<VfsBatchExportStageResult>`（`vfs.ts:386`），而 `ipc-types.ts:530-534` 的 `VfsBatchExportStageResult` **只有 `stagingRoot` + `filePaths`**，没有 `skipped`；
- renderer 的 `StagedExport`（`workspace-batch-dnd.ts:32-36`）同样没有 `skipped`，`:192-196` 落库时也不带。

TS 不报错（`data: staged` 是变量不是字面量，多余属性检查不触发），运行时 `skipped` 会随 IPC 过去，但**两端类型都看不见它** ⇒ 未来接 UI 提示时必须同时改三个文件，而 `ipc-types.ts` 恰好是最容易被漏掉的那个（它在 `shared/` 下、离改动最远）。

**改法**

1. `ipc-types.ts` 的 `VfsBatchExportStageResult` 补 `readonly skipped?: readonly { logicalPath: string; reason: string }[]`（或直接复用 core 的 `BatchExportSkip` 类型，看 desktop 侧 `import type` 惯例）。
2. `workspace-batch-dnd.ts` 的 `StagedExport` 同步补字段。
3. renderer 若本期不消费，至少在 `StagedExport` 上留一行注释指向 spec §12.5 第 3 条（UI 呈现列为债务池），避免后人以为「skipped 已经被消费了」。

**验收**：`npx tsc --noEmit -p apps/desktop/tsconfig.json` 与 `tsconfig.renderer.json` 双绿；`stagedByPath` 落库处能读到 `skipped`。

---

### cr1-core2/C-2 [P2] CS-07 与 CS-06 落在同一个 commit，「须在 CS-06 之后」的顺序约束在该 commit 内不可验证

- **维度**：C-orch（跨波顺序约束）
- **文件**：`packages/core/src/bootstrap/vfs/vfs-revision-schema.ts`、commit `c667be0f`
- **来源节点**：cr1-core2

**问题**

`wave-b-core2.md` §0.3 与 ledger §2.4 都写死 CS-07 **须在 CS-06 之后**（CS-06 在 wave-c2）。实际 `c667be0f`（Wave C 全量）的 commit message 里同时列了 `CS-06/07 触发器 v2+BOOT_VERSION 18` —— 两条落在同一 commit。

这不是「顺序错了」（同一 commit 内 DDL 与写路径改动同时生效，运行时确实满足约束），而是**约束不可二分定位**：一旦 CS-07 的触发器 v2 在生产上报 blob 不回收，无法用 `git bisect` 判断「CS-06 在不在」这个前提是否成立，而 §0.3 的整个存量库生效论证（指纹对齐 + bump `SCHEMA_BOOT_VERSION` 依赖慢路径执行）都建立在「CS-06 已合入」之上。

**改法**：在 `cr-fix-spec.md` 记一笔编排偏离（不重写 Wave C 历史——那是别的节点的 commit），并把 `ledger-v2.md` 里 CS-07 的「须在 CS-06 之后」补注「实际与 CS-06 同 commit `c667be0f` 合入，运行时顺序成立但不可二分定位」。

**验收**：`ledger-v2.md` CS-07 行有该注记。

---

### cr1-core2/C-3 [P2] B 条目的「三处同 commit，缺一不可」被拆到两个 commit；顺序恰好安全但违反硬性要求

- **维度**：C-orch + A（验收矩阵的原子性）
- **文件**：`packages/core/src/config-forms/agent/agent-editor-state.ts`（`4829b8d1`）、`apps/desktop/renderer/features/settings/AgentEditorView.tsx:353-357`（`37df8900`）、`apps/mobile/src/components/agent/agent-editor/useAgentEditorFormState.ts:287-290`（`37df8900`）
- **来源节点**：cr1-core2

**问题**

spec §9 修法把这条的风险写得很重：

> ⚠️ **本条有一个三处联动的陷阱，只改 core 一处会把「改作用域不 dirty」变成「永远 dirty」**……修法（三处同 commit，缺一不可）

实际 core 侧在 `4829b8d1`、两端 apps 侧在 `37df8900`。**顺序恰好是安全的**——`37df8900` 在 `4829b8d1` **之前**（`git log` 序：`37df8900` → `4829b8d1`），于是中间态是「apps 传了 `mode`、core 的 `formSnapshotJson` 还不认这个键 ⇒ 多余键被 `JSON.stringify` 丢弃」，打开智能体不会误报 dirty；等 `4829b8d1` 合入时两端都已就位。

但「恰好安全」不等于「按 spec 执行」：如果 rebase 顺序被调换（core 先于 apps），中间态立刻变成 spec 描述的最坏形态（打开任意智能体即显示「· 未保存」）。这条依赖现在是隐式的。

**改法**：在 `fix-spec.md` §9 的修法栏加一行实现注记「core 侧 `4829b8d1` / apps 侧 `37df8900`，**apps 必须先于 core**；若 rebase 调换顺序须同步把两处基线调用点与 core 改动并入同一 commit」。

**验收**：`wave-b-core2.md` §9 有该注记；或历史被重写为单 commit。

---

### cr1-core2/C-4 [P2] M-06 的「可选加强段」（`unrecognizedLineCount`）未实现，spec 把它列为「本 PR 建议同 commit 做」

- **维度**：A（需求符合性 —— spec 建议项未落地）
- **文件**：`packages/core/src/infra/llm-protocol/logic/sse-parse-errors.ts`（未改）
- **来源节点**：cr1-core2

**问题**

spec §2 修法第 3 条：

> **可选加强（本 PR 建议同 commit 做，但可单独回滚）**：给「非空、既不是 `data:` 也不是 `event:` / 以 `:` 开头的注释行 / 空行」的行计一个**可选**字段 `unrecognizedLineCount?: number`……

`4829b8d1` 没做。§12.5 第 4 条同时写着「judge 若认为该段超出『量级 S』纪律，可整段删掉而不影响主体修法」——所以它**不是缺陷**，但 spec 说了「本 PR 建议同 commit 做」，实际没做，属未记录的偏离。

**改法**（二选一）

- 实现它：加可选字段 + `assertSseParseSucceededOrThrow` 在 `blocks.length === 0` 时纳入判定 + `sse-parse-errors.test.ts` 两条用例（喂 `:keep-alive` + `foo: bar` 抛 `MALFORMED_SSE`；只喂 `:keep-alive` 不抛——误报红线）。**必须是可选字段**（spec 点名 `SseParseDiagnostics` 在测试里被手写成对象字面量，加必填会打红 TS2741）。
- 或在 `cr-fix-spec.md` 记「M-06 可选加强段不做，judge 已裁」，把 §2 修法第 3 条标为「本期不做」。

**验收**：前者 `npm test -w @novel-master/core` 全绿且新两条用例存在；后者 fix-spec 有该裁记。

---

## 3）open_questions（未认定，不得混入 must-fix）

### OQ-1 · M-04 补上 `chat_session` 扫描后，mobile 端出现了「删不掉模型且无法自救」的死路

M-04 修好了「会话引用的模型被静默删掉」，代价是现在**会话引用会阻断删除**。核对两端的解除路径：

| 端 | 解除会话 `modelId` 覆盖的 UI | 证据 |
|---|---|---|
| desktop | ✅ 有：`SessionDetailDrawer.tsx:629-647` 的 `PickerModal` 带 `allowNone` + `noneLabel="清除会话覆盖（使用智能体锁定模型）"` | 实读 |
| mobile | ❌ 无：`ModelPickerModal.tsx:115-135` 的 `select` 只能写入一个 `savedModelId`，无 none 分支；`PickerListModal.tsx:30-53` 的 `Props` 里**没有** `allowNone` / `noneLabel` | 实读；全 `apps/mobile/src` grep `allowNone` / `noneLabel` **零命中** |

`core` 侧 `updateSessionAgentConfig` 支持 `modelId: null` 清除（`session.service.ts:305-313`），但 mobile 没有任何 UI 传 `null`（grep `modelId: null` 在 mobile 零命中）。

⇒ **mobile 用户一旦在会话里选过模型 M，就再也无法删除 M 或 M 所属的 provider**（`deleteSaved` 与 `delete(provider)` 都会被 `SAVED_MODEL_IN_USE` 拦下），且没有 UI 出口。

这是产品口径问题，不是实现缺陷：spec §5 风险栏承认了「存量用户删不掉服务商」是有意的正确行为，但**没识别出 mobile 缺解除入口**这一半。

**须用户拍板**（三选一）

- 方案甲：mobile 的 `PickerListModal` 补 `allowNone` + `ModelPickerModal` 补「清除会话覆盖」行（与 desktop 对齐）。改动小、直击死路。
- 方案乙：把 `chat_session` 扫描降级为**软引用**（同 `currentModelId` 的处理，只在错误消息里提示而不阻断）。会重新打开「模型被删 → 会话跑不起来」的口子，但那个口子在 M-04 之前就存在。
- 方案丙：接受现状，但在 `SAVED_MODEL_IN_USE` 的 mobile toast 上补一句「请先在相关会话里更换模型」——**前提是方案甲已经落地**，否则这句提示指向一个不存在的操作。

### OQ-2 · M-01 的「首字后断流不再自动重试」行为面

spec §12.5 第 1b 条已把这条列为待 judge 拍板项，本节点不重复论证，只补一条实现侧事实：闩锁判据是「`onStream` 有没有被驱动」，不是「内容非空」。`T-RR-1d` 已经证明 `usage` / `done` 不置闩（正确）。真正需要拍板的是产品取舍——从「偶尔能自动续上（代价是重复输出 + 重复计费）」变成「直接失败并显示 `[生成失败]`」。spec 风险 2 同时指出：已产出后失败时，runner 走的是「本轮无 assistant 落库」的失败链，用户屏幕上会同时看到那一段流式文本和一条 `[生成失败]`。

**处置**：等 judge 拍板。若判「保留闩锁」，须在 CHANGELOG 的 `Changed` 段写一句（当前 `4829b8d1` **未带任何 CHANGELOG 改动**，见附录 K-2）。

---

## 4）spec_deviations

### SD-1（open，跨节点重复登记）· M-03 的 spec 在 `wave-b-core2.md`，实现落在 core1 提交 `6ffeb5fb`

- spec 位置：`wave-b-core2.md` §4「M-03 · `filename` 档与读失败降级把 `1970-01-01` 假时间戳写进常驻提示词」（P1 / core-misc）
- 实现位置：commit `6ffeb5fb`；`4829b8d1 --name-only` 的 39 个文件里不含它
- 偏离性质：**归属偏离，非实现偏离**（实现与 core2 spec 修法 4 条逐条对齐，本节点已复核）
- 建议处置：`fixed`（台账归属改指 `6ffeb5fb`）
- ⚠️ 与 `cr1-core1/C-1`、`cr1-core1/SD-1` 是同一事实，**fix-spec 里只写一条**，不要写两遍

### SD-2（open）· M-06 的可选加强段未实现

- spec 位置：`wave-b-core2.md` §2 修法第 3 条（「本 PR 建议同 commit 做」）
- 偏离性质：**范围收窄**（spec 自己在 §12.5 第 4 条给了 judge 可裁的空间）
- 建议处置：`accepted`（记入 C-4 的二选一）

### SD-3（open）· spec §0.1 / §12.1 的「六个 commit」未执行

- spec 位置：`wave-b-core2.md` §0.1 分层表 + §12.1 硬约束①
- 实现位置：单 commit `4829b8d1`
- 偏离性质：**打包形态偏离**（实现内容齐全，偏离的是提交粒度）
- 建议处置：见 C-1 的方案甲 / 方案乙；无论哪条都要写进 fix-spec，因为下游按 spec 派工时会按六个 commit 去找

---

## 5）fix-spec 可执行性

`cr-fix-spec.md` 当前状态：**空壳**（Must-fix 段「（首轮评审进行中）」、Spec deviations「（待报）」、Open questions「（待报）」、K 节「（待报）」）。

| 检查项 | 结论 |
|---|---|
| 2 条 P1 是否已进 fix-spec | ❌ 全缺（A-1 是行为修复、C-1 是历史重写/记账，须分开写） |
| 5 条 P2 是否已进 fix-spec | ❌ 全缺 |
| 3 条 spec_deviations 是否已报 | ❌ 全缺（SD-1 须与 cr1-core1 的 SD-1 合并成一条） |
| 每条是否含「文件 + 改法 + 验收」 | ✅ 本报告已按此三段写全，主代理可直接摘抄 |

**业务 spec（`wave-b-core2.md`）侧的可执行性**

- 10 条落地条目的七要素**完整、可执行**，实现与 spec 逐条对得上（差异见 §1.1 与 SD-2 / SD-3）。spec 在几处主动标注了「陷阱」（CS-08 的锚点不能用自身、B 的三处联动、CS-02 的 `=== false` 不能照抄 `=== true`），实现全部避开了——**这几处是 spec 质量的高光，值得保留**。
- **缺口 1（对应 C-1）**：spec 把「六个 commit / M-04 与 M-01 独立」写成硬约束，但没给「如果合并成一个 commit 怎么办」的兜底口径，impl 就合并了。fix-spec 必须补这个兜底，否则下一片会照抄。
- **缺口 2（对应 A-1）**：spec §5 修法第 2 步的注释论证引用了「CLI 与桌面都在 delete 之后 reset」这个契约，但**没有要求 impl 去核实该契约在三个调用方上都成立**。spec 写「证据」时引的是 `provider.service.ts:240-250` 的删除流水线本身，对 reset 时机一字未提。这条要补进 fix-spec 的检查清单。
- **缺口 3（对应 B-1）**：spec 多处写「类型检查要过」，但 core 的 `typecheck` 脚本只覆盖 `src/**/*`（`packages/core/package.json` 的 `typecheck` = `tsc --noEmit -p tsconfig.json`，`include: ["src/**/*"]`），测试代码**根本不在类型检查范围内**。spec 反复要求「新增 zod 直测」「断言形态」，但没意识到新增的测试代码本身可能类型不合规而无人拦截。
- **缺口 4**：spec §12.5 列了 5 条「留给 judge」的开放项，本节点实测发现其中**没有一条覆盖 mobile 解除会话模型覆盖的死路**（OQ-1）——这是 spec 的判别盲区，不是实现的问题。

---

## 6）结论

### 6.1 结论

**scope-ready: no**

理由：本 scope 有 **2 条 P1** open（A-1 守卫放行前提不成立、C-1 打包形态偏离 spec 硬约束）+ 3 条 spec_deviations open（SD-1 / SD-2 / SD-3）。按 code-review-loop 规则，open spec_deviations 不得 scope-ready。

| 严重度 | 条数 | id |
|---|---|---|
| P0 | 0 | — |
| P1 | 2 | `cr1-core2/A-1`、`cr1-core2/C-1` |
| P2 | 5 | `cr1-core2/B-1`、`cr1-core2/B-2`、`cr1-core2/C-2`、`cr1-core2/C-3`、`cr1-core2/C-4` |
| open_questions | 2 | OQ-1、OQ-2 |
| spec_deviations | 3 | SD-1、SD-2、SD-3（均 open；SD-1 与 cr1-core1 重复，合并记一条） |

未涉及维度（本 scope 明确不含）：D 安全（IPC 面 S-D-02 已顺带覆盖）/ E 性能（F1 备注见附录）/ F 中文注释（入附录）/ H 兼容性 / I 可观测性 / J UI（OQ-1 与 CS-08 的 UI 面均已单列）。

### 6.2 本机实测记录（全部在 `046f4d9c` 工作树跑）

| 批次 | 命令 | 结果 |
|---|---|---|
| core 定向批一 | `cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/chat/tool-summary.test.ts test/prompt/normalize-agent-prompt-layout.test.ts test/vfs/compute-replace-result.test.ts test/vfs/vfs-batch-io.test.ts` | **# tests 48 / # pass 48 / # fail 0** |
| core 定向批二 | 同上，`test/provider/model-request-retry.test.ts` + `provider-service` + `provider-model.service` + 三个 `*-sse-parser` + `agent-editor-state` + `tool/vfs-tools` + `tool/skill-tool` | **# tests 195 / # pass 195 / # fail 0** |
| package-exports 快照 | `test/package-exports/public-subpath-allowlist.test.ts` | **# tests 14 / # pass 14 / # fail 0**（`summarizeToolInput` allowlist 已同步；`public-vfs-allowlist.json` 无需改——`BatchExportSkip` 是 type export，不进 runtime 名单） |
| desktop staging | `cd apps/desktop && node scripts/run-tests.mjs "test/vfs-batch-staging.test.ts"` | **# tests 7 / # pass 7 / # fail 0**（4 既有 + 3 新增；收集数 > 0，零收集守卫未触发） |
| core src 类型检查 | `npx tsc --noEmit -p packages/core/tsconfig.json` | 退出码 0，**0 诊断** |
| desktop main 类型检查 | `npx tsc --noEmit -p apps/desktop/tsconfig.json` | 退出码 0，**0 诊断** |
| core 测试类型检查 | `npx tsc --noEmit -p packages/core/tsconfig.test.json` | **454 条 TS6059**（全部是 rootDir 配置错误，无一条语义错误）⇒ 该配置不可用，见 B-1 |
| 编码门禁 | `node scripts/check-encoding.mjs` | **OK：扫描 3631 个跟踪文件，0 命中**（含 `tool-definitions.ts` 的 A7b 编码修复） |
| eslint（core2 六个改动文件） | `npx eslint src/domain/chat/logic/tool-summary.ts src/infra/llm-protocol/logic/sse-data-line.ts src/service/provider/impl/{model-request,provider}.service.ts src/service/vfs/impl/vfs-batch-io.service.ts src/domain/provider/logic/find-saved-model-references.ts` | **0 问题** |

**未跑**：core / desktop / mobile 全量测试、mobile jest、desktop renderer typecheck、`npm run format:check`（skill 的 G 维只评测试有效性不自跑测；全量耗时超出本节点预算）。
**未做**：spec 要求的反向自检（readonly 禁改代码）——已用「断言形态是否有牙齿」的静态核对替代，结论见 §6.3。

### 6.3 已核对且判定无问题的点（留痕，避免下游重复查）

- **`parseSseDataLine` 的语义等价性（本次重点之一）**：三个 parser 原本是 `startsWith("data: ")` → `slice(6).trim()` → `if (payload === "" || payload === "[DONE]") return`。新写法把「空 payload 早退」并进 `parseSseDataLine` 返回 `null`，调用方保留 `payload === "[DONE]"` 单独判。逐形态核过：`data: `（有空格无内容）旧→`""` 早退、新→`slice(5).trim()===""`→`null` 早退，**等价**；`data:{...}`（无空格）旧→整行丢弃、新→解析，**这是修复目标**；裸 `data`（无冒号）新旧都不匹配，**一致**。`[DONE]` 分支三处一字未动 ✓。
- **CS-08 换锚点的边界枚举（本次重点之一）**：`exportRelativePath(logical, parentLogicalOf(logical), selectionCount)` 在四种组合下都算过——单选文件（`第一章.md`，与旧 `basenameOf` 一致，T-B11 钉住）、多选不同父目录同名文件（`卷一/第一章.md` / `卷二/第一章.md`，T-B10 钉住）、根下文件（`basenameOf("/")===""` ⇒ 回落 `under`，得 `a.md`）、多选根文件 + 子目录文件（`a.md` / `卷一/b.md`，不撞）。**仍会撞的唯一残留**是「`/x/y/a.md` 与 `/y/a.md` 同选」（两者父目录 basename 都是 `y`）⇒ 落进 `skipped`，符合 spec §8 修法 2 的设计（锚点消不掉的那一类必须有地方报告）。T-B12 用「文件 `/卷一/a.md` + 目录 `/卷一`」精准复现了这一类，本机实测 `plan.skipped[0].logicalPath === "/卷一/a.md"` ✓。
- **CS-08 的 `skipped` 没有死字段**：`T-B12` 断言 `skipped.length === 1` 且 `files` 无重复项——若把 `skipped` 通道删掉，这条会因 `skipped` 为 `undefined` 而红（`plan.skipped!.length` 抛）。spec 验收栏特别强调「若只断言 `plan.skipped` 为空就等于把这条通道测没了」，实现避开了 ✓。
- **M-01 闩锁的复位与转发顺序（本次重点之一）**：`attemptEmitted = false` 在 `attempt += 1` 之后、构造 `onStream` 闭包**之前**（`model-request.service.ts:236-241`），闭包内**先置闩再转发**（`:245-250`）——顺序反了的话下游 `onStream` 自身抛错会让闩锁来不及置位。三点全对。`options?.onStream == null` 时直接传 `undefined`、不造闭包（`:242-243`）✓。`PRODUCED_EVENT_TYPES` 只含 `text-delta` / `thinking-delta` / `tool-use`，**不含** `usage` / `done`——`T-RR-1d` 实测钉住「只收到 usage+done 后断流仍可重试」这个反向形态 ✓。
- **M-01 的 import 补充**：spec 特别点出「`LlmStreamEvent` 未被引入，写 `Set<LlmStreamEvent["type"]>` 忘了加 import 会直接编译红」。实现加在 `:18-22` 的 `import type { ... } from "@/infra/llm-protocol/ports/adapter.port.js"` 里，`tsc -p packages/core/tsconfig.json` 退出码 0 可证 ✓。
- **M-04 的 `chat_session` 取值路径**：`chat_session` 表确无 `model_id` 列，存的是顶层 `{agentId, modelId?}`（`session-agent-config.ts:18-21`、`chat-schema.ts`），实现取**顶层** `config.modelId`（`find-saved-model-references.ts:133`），与 `chat_project` 的 `{mode, definition:{model}}` 嵌套形态明确区分并在注释里写明「照抄 chat_project 的取值路径会写成永远命不中的代码」✓。两条测试分别造了这两种形态的引用面 ✓。
- **`safeParseRecord` 的健壮性**：`JSON.parse` 失败、`null`、标量、数组四种都被 `:44-46` 一把拦掉；`agent_definition.prompts_json` 段另包了一层 try/catch（`:82-86`）。spec 要求「不得让守卫因一条脏数据整体抛错（抛错等于守卫失效，比不扫更糟）」——`provider-model.service.test.ts` 新增的「脏 JSON 时守卫不整体失败」用例实测通过 ✓。
- **M-04 的拒绝位置**：`provider.service.ts:237-264` 的 `for` 循环在 `new CoordinatedWrite()`（`:266`）**之前**，拒绝发生时 `suggestions` / `savedModels` / `secretValue` 已读出但**一个写都还没发生**，既有的五步 rollback 配对完全不受影响 ✓。deps 增的 `conn` 是必填字段（`:35-42`），工厂 `create-provider-services.ts:49` 已传，测试 `provider-service.test.ts:251` 的直 `new` 也已同步 ✓。
- **CS-02 的双层守卫**：纯函数层 `compute-replace-result.ts:47-50` 复用既有 `buildReplaceNotFoundError`（不新造错误码），放在 `normalizeForMatch` 之前（空串归一后仍是空串，前后皆可，spec 允许）；zod 层 `vfs-tools.ts:341` 与 `skill-tool.ts:341-345` 各加 `.min(1)`，`skill` 侧保持 `.optional()`（非 edit 动作不要求）。`replaceAll` 死循环那条用例的形状正确——旧实现在这条上会**超时失败而非断言失败**，正是要的牙齿 ✓。diff 里没有混入 `split/join`（RULE 铁律）✓。
- **N-P1-02 与 validate 端的逐字对齐**：实现的两条 spread（`normalize-agent-prompt-layout.ts:82-89`）与 `validate-agent-prompt-layout.ts:307-314` 完全一致，包括 `skillsEnabled === false`（不是 `=== true`）与 `skillsPrefix` 用 `prefixRaw` 原样透传（不 trim）。测试四条覆盖了「`false` 直断言 / `true` 归一后省略 / 非空原样透传 / 空白与缺省省略」四种形态，加上 `全字段白名单往返` 的键集回归锁与一条 `resolveAgentDefinitionFromStorage` 的端到端 round-trip ✓。HEAD 上 wave-e H2 的类型层守卫（`NORMALIZED_OPTIONAL_FIELDS` + `NORMALIZE_FIELD_SENTINELS`）已在同文件就位，spec §1 依赖栏的闭环条件满足 ✓。
- **summarizeToolInput 的 `??` 语义**：单源取 `??`（`tool-summary.ts:57`），`T-TS-07` 同时钉住「`{path:"", dir:"x.md"}` → `""`」与「`{dir:"x.md"}` → `"x.md"`」两个方向——写回 `||` 这条立刻红 ✓。全仓 `function summarizeToolInput` 只剩 core 一处（`grep` 结果：src 一处 + dist 一处），三份副本已清零 ✓。webview 侧按 spec 要求写成「import + export 两步」（`tool-logic.ts:1` + `:11`）而非纯 re-export，本地 `toolCallSummary` 的引用保住了 ✓。`public/chat.ts:355` 的再导出与 `public-chat-allowlist.json` 快照同步更新，快照测试 14/14 绿 ✓。desktop renderer 侧最终走的是 `@shared/logic/chat` 再导出（wave-e X1 改道），链路现成 ✓。
- **CS-02 的 zod 收紧没有误伤既有夹具**：`test/tool/` 下两条新用例实测通过，既有 `skill` / `edit` 工具用例全绿（批二 195/195）。

---

## 附录 · C 类附录（K/F 级杂项，不进 must-fix，由下游 spec-fix 作为步骤闭合）

- **K-1**：`packages/core/src/domain/chat/logic/tool-summary.ts`、`packages/core/src/infra/llm-protocol/logic/sse-data-line.ts`、`packages/core/test/chat/tool-summary.test.ts`、`apps/desktop/test/vfs-batch-staging.test.ts` 四个**新增**文件**缺文件末尾换行**（实测 `lastByte` 分别是 `0x7d` / `0x7d` / `0x3b` / `0x3b`，均非 `0x0a`；git diff 里四处都带 `\ No newline at end of file`）。core 没有 prettier 配置、eslint 也没开 `eol-last`，所以 CI 不会红，但与仓内既有文件的收尾惯例不一致。改法：四个文件各补一个换行符。
- **K-2**：`4829b8d1` **未带任何 CHANGELOG 改动**（`git log fe79b781..046f4d9c -- CHANGELOG.md` 零命中，`CHANGELOG.md` 当前最新段是已发布的 `[1.5.29]`，没有 `Unreleased` 段）。本 commit 含三条用户可感行为变化：① summarizeToolInput 三面统一导致 skill/task 工具摘要在三端同步变化（spec §3 修法 4 明写「提交信息里必须写明这一条」——commit message 写了，但 CHANGELOG 没写）；② M-01 首字后断流不再自动重试（若 judge 拍板保留）；③ CS-08 多选导出目录层级变深一级（spec §8 风险 1 已承认是修复的必然结果）。收尾时须补，否则这三条对用户不可见。
- **K-3**：`packages/core/src/public/chat.ts:355` 的 `export { summarizeToolInput }` 追加在文件**末尾**（`createMessageTranscriptEffectsService` 之后），而该文件其余导出大致按域分组。新增导出追加在末尾是仓内既有习惯还是随手写的，从 diff 看不出规范；若仓内有约定，挪一下更整齐。（低优先级，不阻塞。）
- **K-4**：`apps/desktop/test/vfs-batch-staging.test.ts` 的 `S-D-02-c` 用例会**删除整个 staging 根** `userData/vfs-batch-export`。测试态 `userData` 是 electron-stub 的硬编码共享路径 `/tmp/novel-master-test-user-data`（`electron-stub.mjs:19`），desktop 测试又是多文件并行跑的。当前全 `apps/desktop/test` 只有这一个文件引用该路径（已 grep 确认），所以暂无冲突；但将来若有第二个测试碰 `userData/vfs-batch-export`，`--test-concurrency=2` 下会互相删。建议把该路径挪进 `setupDesktopDbTestEnv` 返回的 `tempDir` 之下（同时意味着要放宽 S-D-02 断言的基准来源——见 spec §10 修法 1 的 `vfsBatchStagingBase()`，测试侧可以 stub `app.getPath`）。
- **F-1（编码）**：`openai-content-mapper.test.ts` 的 5 行改动是 A7b 编码修复（用例名里的 mojibake `�?` → `→`），`tool-definitions.ts` 的 1 行是 `Tool registry 锟?LLM` → `Tool registry — LLM tool definitions`。两处都属编码批次续作，不属业务变更。`node scripts/check-encoding.mjs` 全仓 0 命中可证这两处已彻底修好。**注意**：`public-chat-allowlist.json` 在 `4829b8d1` 里被写入时带了 UTF-8 BOM（实测该 commit 的 blob 首三字节 `EF BB BF`），HEAD 上已被 `3b4c8d9e`（wave-e H1）清掉（现 blob 首字节 `5B`）——本节点只需留痕，不需动作。
- **F-2（注释）**：本 commit 的中文注释密度与质量整体达标，且**把非显然约束写在了代码里**——`parentLogicalOf` 的「锚点绝不能用 `logical` 自身（`relativePathUnderAnchor(p,p)` 返回空串，单选文件会被整个丢掉）」、`computeReplaceResult` 的「空串归一后仍是空串」、`tool-summary.ts` 的「公共尾巴取 `??` 而非 `||`（WebView 旧副本的 `||` 是历史偶然）」、`M-04` 的「`currentModelId` 是软指针」（**这条注释的前提是错的，见 A-1**）、`M-01` 的「先置闩再转发」。符合 F 维「关键逻辑中文注释 + 公开 API 文档注释」的要求。A-1 是唯一的实质性注释缺陷（**断言了一个未核实的契约**），其余注释均与代码一致。
