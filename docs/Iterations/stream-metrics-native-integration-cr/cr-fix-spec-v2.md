# CR Fix Spec（增量第二轮 · v4 收口轮）: stream-metrics-native 三条修复（①多步速率 / ②js-tiktoken 实时估算 / ③上下文用量口径）

> **文件名保持 `cr-fix-spec-v2.md` 不变**（下游引用已指向它），本轮是 **v4 收口轮（第 4 轮终审并入）**：只改文档，不改代码 / 测试 / 业务 spec。

## 元信息

- **repo**: `D:\Dev\Js\novel-master\.worktree\i-stream-metrics-native`
- **branch**: `integration/stream-metrics-native`
- **base_sha**: `83a434d7a74a66eefca7fa7cb860ddf30154b028`
- **head_sha**: `fad16a12620e676b6ae6beccbdcc55460edf928d`（**评审范围**的 head，即 CR 三轮评审覆盖到的最后一笔；执行后的 HEAD **不是**本字段，见下）
- **执行后 HEAD**: `71692b11`（最后一次实质改动提交 = cr-func 遗留 P2 收口；其后仅剩本文件的终态标注与 `docs/.iteration-state.yaml` 的落盘提交，不再产生代码 / 业务文档改动。**当前真实 HEAD 以 `git log -1` 为准**——本文件的状态标注写于自身那次提交之前，故无法自指）
- **prd_path / spec_path**（四份业务文档，只读参考）:
  - ① `docs/Iterations/mobile-perf-2026-09/bugs/stream-multi-step-rate-freeze/{prd.md,spec.md}`
  - ② `docs/Iterations/mobile-perf-2026-09/features/stream-live-token-estimator/{prd.md,spec.md}`
  - ③ `docs/Iterations/mobile-perf-2026-09/bugs/context-usage-caliber-unify/{prd.md,spec.md}`
  - ④ `docs/Iterations/mobile-perf-2026-09/features/stream-metrics-tokens/{prd.md,spec.md}`（被改写的原 spec）
- **review_round**: 1（**修订轮 round 2**）→ 3（**v3 校对轮**）→ 4（**v4 收口轮**）/ **dag_version**: 4
- **状态**: **已执行完毕（dev-ready，2026-09-26）**——由 `code-dev-loop` 承接，**32 条 must-fix 全部落地**；4 条「按现状收窄」经用户**照准**（#1/#2/#3/#5）；两轮 readonly cr-func 均判 `func-ready: yes`，其遗留 6 条 P2 已收口，终态复检（`n10-crfunc-final`）亦判 `dev-ready: yes` 且零 must-fix。分支 `integration/stream-metrics-native`，执行前 `5c63d27e` → 最后一次实质改动提交 `71692b11`（**未 push / 未 merge / 未发版**）。逐条执行结果见文末「执行记录」。
- **说明**: 本文件是**增量第二轮** CR 的修复规格。上一轮整条分支 CR 见同目录 `cr-fix-spec.md`（状态已执行，只读参考，本次**未改动**）。评审为 readonly（只读代码 + 静态推演 + 局部实跑），分三个 scope：
  - `review-scope-metrics` → 覆盖 ① + ②，round 1 产出 7 条 must-fix（`metrics/*`，round 2 后共 9 条）；
  - `review-scope-context-usage` → 覆盖 ③ + `scripts/mock-openai-server.mjs`，round 1 产出 10 条 must-fix（`ctx-usage/*`，round 2 后共 11 条）；
  - `review-scope-full`（**v3 校对轮新增**）→ 覆盖 ① + ② + ③ + ④ 四份业务文档的**全量**一致性，产出 8 条 must-fix（`full/*`，全部 P2）；**v4 收口轮再加 4 条**（`full2/*`，全部 P2）。
- **v4 收口轮修订说明**（2026-09-26，第 4 轮 readonly 终审并入）：第 3 轮落盘的 **28 条方向零误判、行号准确率极高**，剩下的全是**文本收口**问题——共 13 处，按性质分四类：**数字口径不一致 2 处、假陈述 3 处、会打红既有验收门限 / 门限对不上 2 处、覆盖面缺口 3 处**，外加行号措辞漂移 3 处。本轮**只改文档**、**不动任何实现**：
  - **数字口径统一（同源 2 处）**：`ctx-usage/A-3` 私有 helper 调用点数 **9 → 10**（`ctx-usage/A-2` 改法 #1 会在 `message.service.append` 新增第 10 处调用点，四处同改，且 JSDoc 文案**去掉数字**避免再次过期）；新增 `full2/A-2`（② spec `:67` / `:68` 的 core 9→11、mobile 7→9，会被 `metrics/B-1` / `C-2` 自己的验收改陈旧）。
  - **假陈述订正 3 处**：`full/A-3` + deviations #21 的落点（`loadChatPromptTokenLabelResilient` **并不带** `formatCounterKindLabel`）；`ctx-usage/C-orch-2` 改法 #5（desktop 测试**无** provider mock、mobile 两处 mock 随 `full/D-1` 变死 mock）；`full/D-1` 改法 #1 的 grep 措辞（注释提及不算引用，import 照删）。
  - **会打红门限 2 处**：`metrics/B-1` 改法 #6 的新接口字段会打红两处手写假计数器（其中 desktop 那处**正在** `metrics/G-1` / `C-orch-1` 的 `tsc --noEmit` 验收范围内）；`metrics/G-1` 改法 #4 的钩子写法（**不许用裸 specifier**，否则自指死循环；计数读口由测试文件自己 import）+ 行号订正（`:20` 不是 `:21`）。
  - **覆盖面补齐 3 处**：新增 `full2/E-1`（`full/E-1` 的每 delta 读值**desktop 同样成立**，条件改法补 desktop 侧、门限仍只对 mobile）；新增 `full2/C-1`（「见 CR Open questions」是**悬空引用**，OQ 段补第 16 条）；新增 `full2/A-3`（`cr-fix-spec.md` 观察项 ⑤ 缺推翻注记，**低置信可降级**）。
  - **行号 / 措辞漂移 3 处**：`metrics/G-2` 的 `:413` → **`:414-415`**；`metrics/C-1` 注释同步清单补 `session-stream-unit.ts:373-374`；`metrics/C-2` 验收删掉多余的「**再次**调 `primeStreamTokenModelHint`」。
  - **must-fix 重算：合计 32 条**（**P1 × 2、P2 × 30**；v3 校对轮为 28 条 = P1 × 2、P2 × 26，本轮新增 4 条全为 P2）。
  - **P 级分布明细**：`P1 × 2` = `metrics/B-1`（静默丢字符 / 读值倒退）、`ctx-usage/A-1`（会话级切 Agent 挂点缺失 → 静默偏差且落库跨重启）；`P2 × 30` = `metrics/*` 8 条 + `ctx-usage/*` 10 条 + `full/*` 8 条 + `full2/*` 4 条。
  - **本文件只描述改法，不含任何实现代码改动。**
- **v3 校对轮修订说明**（2026-09-26，第 3 轮 readonly 评审）：**现有 20 条 must-fix 方向全部成立、无一条误判**。本轮做的是「**执行前校对**」——把 4 处会让执行方卡住 / 做偏的改法前提改对、补 2 处覆盖面与假事实缺口、补登记 3 处未登记的文档偏离、并纳 5 条新维度发现。本轮**只改文档**：
  - **改错「改法前提」4 处**：`metrics/C-1`（预热落点 + 手段写错）、`metrics/C-2`（验收不可观测）、`metrics/G-1`（断言手段在 ESM 下不可达）、`metrics/C-3`（清单与验收自相矛盾）；外加 `metrics/C-orch-1` × `ctx-usage/C-4` 的**同一处改动重复登记**去重。
  - **补覆盖面 / 假事实缺口 4 处**（其中 2 处为 **P1 级**）：`ctx-usage/A-1` × `A-3`（新挂点未 await 会静默生产一处新的 fire-and-forget）、`ctx-usage/A-2`（(i) 的理由写错，照错句「对齐」会直接打穿 C 组）、`ctx-usage/A-2` 调用面清单注明「不需要改」、`ctx-usage/A-3` 漏两处将成假陈述的 JSDoc。
  - **补登记文档偏离 3 处**：`full/A-2`（③「14 个」全量清一遍）、`full/A-3`（③ spec `:51` / `:52`）、`full/A-4`（① spec 采样器条数 14 / 12 → 17）。
  - **新增 5 条**：`full/E-1`、`full/E-2`（性能，P2）、`full/I-1`（可观测性，P2）、`full/D-1`（误导性死代码，P2）、`full/K-1`（CHANGELOG 未同步，P2）。
  - **must-fix 重算（v3 当时的口径）：合计 28 条**（**P1 × 2、P2 × 26**；round 2 为 20 条 = P1 × 2、P2 × 18，新增 8 条全为 P2）。**⚠️ v4 收口轮已重算为 32 条（P1 × 2、P2 × 30），以 v4 段为准。**
  - **P 级说明**：`ctx-usage/A-1`×`A-3` 的 await 缺口与 `ctx-usage/A-2` 的 (i) 假事实**本身是 P1 级**（前者会静默生产新缺陷，后者照做会打穿 C 组），但它们是**已有条目的改法修正**、不新增条目，故体现在条目内的「⚠️ P1 级」标记上，不计入 P1 条数。
  - **本文件只描述改法，不含任何实现代码改动。**
- **round 2 修订说明**（2026-09-26）：第 2 轮 readonly 复审确认 17 条技术方向**全部成立**，但发现 7 处**文本缺陷会让执行方做偏**，另新增 3 条 must-fix。本轮修订只改文档、不改代码/测试/业务 spec：
  - 修订已有条目 10 条：`metrics/B-1`、`metrics/C-1`、`metrics/C-2`、`metrics/C-orch-1`、`metrics/G-1`、`ctx-usage/A-1`、`ctx-usage/A-2`、`ctx-usage/A-3`、`ctx-usage/C-orch-1`、`ctx-usage/C-orch-2`；
  - 新增 3 条：`metrics/A-4`、`metrics/A-5`（P2，文档一致性）、`ctx-usage/C-4`（P2，desktop 具名再导出闭环）；
  - **must-fix 合计 20 条**（P1 × 2、P2 × 18）。
- **顺带订正的行号 / 数字**（均已实查，执行方以本文件为准，不要回退到 round 1 的标注）：
  - `ctx-usage/C-orch-1` 调用数：7 处 → **9 个调用文件 / 10 条调用语句**；
  - `ctx-usage/A-1` / `A-2` 挂点数：14 → 15 → 16 → **18 个调用点 / 15 个公开入口方法**（round 1 那串数字是按 14 这个错基数推的，见 deviations #16）；
  - `metrics/A-4` 的 8 处措辞位置（round 1 标注的行号有偏移，已逐条订正，见该条表格）；
  - deviations #5 的落点行号是 ④ spec **`:75`**（不是 `:48`）；
  - **v3 校对轮新订正（均已实查）**：
    - 生产侧 `new SessionStreamUnit(` 共 **3 处**，全在 `apps/mobile/src/services/session-stream-unit-manager.service.ts`（`:1096` `startRun` 路径、`:1211` `adoptInterruptedUnit`、`:1268` `adoptConsumptiveUnit`，后者 `:1277` 紧跟 `begin()`）；
    - `git grep -n "字符折算兜底" -- apps packages` **只命中 2 处**（不是 4 处），另 2 处措辞是「真值优先，heuristic」；
    - `git grep -n "InteractionManager" -- apps packages` **零命中**（全仓未用过 RN 空闲化 API）；
    - ③ 目录下 `git grep -n "14 个"` 实查命中 **4 处**（`spec.md:26 / :39 / :65`、`prd.md:49`）；
    - `sliding-token-rate.test.ts` 实跑 **17 条**全绿（base 14 + 本轮 3）；
    - `apps/desktop/shared/logic/format.ts:9-21` 的再导出列表**不是字母序**（`buildStreamMetricsLine` → `formatCharCount` → `formatStreamElapsed` → `slidingTokenRate` → `createTokenRateSampler` → `createIncrementalTokenCounter`），是历史顺序。
  - **v4 收口轮新订正（均已实查）**：
    - `ctx-usage/A-3` 私有 helper `this.invalidatePromptTokens(` 的调用点 **9 → 10**（第 10 处由 `ctx-usage/A-2` 在 `message.service.ts:159`（`append`）新增）；**JSDoc 里不要再写这个数字**；
    - desktop 侧**零** `formatCounterKindLabel` 调用点（`loadChatPromptTokenLabelResilient` 走 `formatChatTokenStatsLabel` → `formatTokenSourceLabel`，与该符号无关）；
    - `apps/desktop/test/chat-prompt-tokens.test.ts` **直连真模块、无 provider mock**；mobile 测试 `:14` / `:23` 的 `serializeToolsForTokenCount` mock 会随 `full/D-1` 变死 mock；
    - `apps/desktop/renderer/hooks/stream-token-estimator.ts` 的静态具名 `import { Tiktoken }` 在 **`:20`**（`:21` 是 ranks 的 default import）；
    - `session-stream-unit.ts` 的两条估算器 `reset()` 在 **`:414-415`**（`:413` 是 `heuristicBaseTokens = 0`）；
    - `metrics/C-1` 要同批改的第二处注释：`session-stream-unit.ts:373-374`「单元创建时同步建」；
    - desktop hook 也是**每 delta 读值**（`useAgentStreamMetrics.ts:249` / `:264` → `:188-194`；250ms 只节流 usage 事件与渲染 tick）——`full/E-1` 的覆盖面此前只写了 mobile，见 `full2/E-1`。


---

## Must-fix（按 P0 → P1 → P2）

> 无 P0。P1 两条均为「静默丢数据 / 静默偏差且落库跨重启」，属本轮必须闭合项。

### metrics/B-1 [P1] 计数器固化路径 encode 失败会静默丢字符、读值可倒退

- **维度**: B（正确性）
- **文件**: `packages/core/src/infra/tokenizer/logic/incremental-token-counter.ts:231-241`（`commitOnce`；模块文档注释 `:39-40`；相关测试 `packages/core/test/infra/tokenizer/incremental-token-counter.test.ts:103-121`）
- **问题**:
  - `commitOnce` 中 `encodePiece(piece)` 返回 `null` 时，代码只跳过 `committedTokens += pieceTokens`，但 `tail = tail.slice(cut)` 照常推进。于是这一段字符**永久蒸发**，且因为「固化部分没加、尾窗又短了」，`tokens` 读值会**倒退**。
  - 评审实跑复现：`tailChars:8 / commitStepChars:8`，先读到 8，固化段 encode 失败后降到 4。
  - 与两处声明冲突：模块文档 `:39-40` 的「计数器不崩、不倒退」；②PRD 验收「保持上一次读值」。
  - 真机触发路径真实存在：js-tiktoken 对 `<|endoftext|>` 一类特殊 token 默认 `disallowedSpecial="all"` 会抛错。
  - 现有测试第 5 条只覆盖**读值路径**失败（`tailChars:256`，尾窗从不触发固化），所以固化路径的失败分支**一行测试都没有**。
- **改法**（失败分支改成「不丢字符 + 有界 + 单调」三件事同时成立）:
  1. 在 `commitOnce` 的失败分支里 `committedTokens += piece.length`——按「1 字符 ≈ 1 token」的最坏上界兜底计入，宁可高估也不丢段，保证 `tokens` 单调不减。
  2. 计数器新增一个**仅用于诊断**的 `unencodableChars` 累计计数（挂在返回对象的读口上，不参与 `tokens` 计算，不进任何投影/持久层）。
     **该字段必须有一个写死的可观测落点，否则它就是只写字段**——本条**钉死取「拼进 `console.warn` 文案」**（round 2 补）：首次失败的一次性告警文案改为含计数的形式，如「不可编码 N 字符，按 1:1 兜底计入」（N = 本次失败的 `piece.length`）。
     **不许写成「仅计数备用 / 供将来排查」**——只写不读的字段在 review 里等于埋雷，执行方清理死代码时会顺手删掉，届时这个静默丢段的信号就彻底没了。
  3. 首次失败时 `console.warn` 一次并记一个模块级/闭包级「已告警」标志，后续同类失败静默（避免每段刷屏）。
     - ⚠️ **v3 校对轮：告警标志必须按路径分开（两个，不是一个）**。固化路径与读值路径是**两种语义完全不同的失败**（兜底计入 vs 保持上次读值），共用一个标志会让「先发生过一次读值失败」把后续的固化失败静默掉——而固化失败才是本条要治的「静默丢字符」。**取「固化一个标志 + 读值一个标志」**。
     - ⚠️ **读值路径的 encode 失败现在是完全静默的**（`incremental-token-counter.ts` 的读值分支 `:225` 附近没有任何日志），这正是「读值不可用」在真机上完全不可排查的原因。**读值路径首次失败也要 `console.warn` 一次**，文案写「**尾窗不可编码，保持上一次读值**」。
  4. `tail = tail.slice(cut)` 保持原样，内存仍有界（这是固化路径存在的意义，不能因为失败就无限攒尾窗）。
  5. 模块文档 `:39-40` 补一句区分两种失败：**读值路径失败 = 保持上一次成功值；固化路径失败 = 按 1:1 字符兜底计入，宁可高估不丢段。**
  6. **`IncrementalTokenCounter` 公开接口同步加 `readonly unencodableChars: number`**（v3 校对轮补，否则改法 #2 钉的是个「返回对象上挂了私有字段」，读口拿不到、断言也写不出来）。
     - 该接口经 `packages/core/src/public/format.ts` 与 `apps/desktop/shared/logic/format.ts` **双层 `export { ... }` 逐个具名转出**（见 `metrics/C-orch-1` 改法 #2），但**导出面不需要改**——新字段是接口的成员而非新导出名，两层 barrel 都是整类型转出。
     - **不进入任何投影 / 持久层**：`SessionStreamUnitMetrics` / `SessionRunState` 都不加它（`metricsAcc` 有精确 `toEqual` 形状用例，加字段会红）。
     - ⚠️ **v4 收口轮：接口加字段会打红两处「手写假计数器」，必须同批补，否则验收门限当场红**。加 `readonly unencodableChars: number` 之后，下面两处的**对象字面量**会因少一个属性直接报 **TS2741**（该字段是必填、非可选）：
       | 落点 | 说明 | 是否在既有验收门限内 |
       |---|---|---|
       | `apps/desktop/test/use-agent-stream-metrics-hook.test.tsx:266` | `createMetricsHarness(() => {...})` 里手写的假估算器字面量 | **是**——`metrics/G-1` / `metrics/C-orch-1` 的验收命令 `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` 就在这处范围内 |
       | `apps/mobile/__tests__/session-stream-unit-pipeline.test.ts:1162` | `createFakeEstimator()` 返回的假估算器字面量 | 否（mobile 走 jest），但会让该文件红 |
       - **两处都补 `unencodableChars: 0`**（假计数器不需要真的计数，`0` 即可）。
       - **`reset()` 不清零该诊断计数**：`unencodableChars` 是**跨 run 的累计诊断量**，语义是「这个计数器一生里吞掉过多少不可编码字符」。清零会让「切模型后又开始丢字」这类现象在日志里消失。**随对象消亡即可**，不需要在 `reset()` 里做任何处理——**执行方不要顺手在 `reset()` 里加一行归零**。
- **验收 / 测试**:
  - core 补 2 条（`incremental-token-counter.test.ts`）：①固化段 encode 抛错后，`tokens` 不下降、后续 push 继续增长、总量不缺段（断言值等于「成功段 + 失败段字符数 1:1 + 尾窗」），**并顺带断言 `unencodableChars > 0`**（把上一条改法 #2 + #6 的字段钉住，防止它被当死代码删）；②读值路径抛错仍保持上一次成功值（保留现有第 5 条不动），**并断言该次 `unencodableChars` 不变**（钉住「只统计固化路径」这条口径）。
    - ⚠️ 「只统计固化路径」的依据：读值路径失败时尾窗**没有被消费、没有丢字**，把它计进 `unencodableChars` 会让这个字段同时表达「丢了字」和「暂时读不出」两件事，排查时无法区分。字段语义写死为「**已按 1:1 兜底计入 `tokens` 的不可编码字符数**」，读值路径的失败只走告警、不进计数。
  - mobile 补 1 条端到端（`session-stream-unit-pipeline.test.ts`）：注入对特定段落抛错的假 `encode`，断言投影 `completionTokens` **单调不减**。
  - desktop 补 1 条端到端（`use-agent-stream-metrics-hook.test.tsx`）：同上，断言 `completionTokens` 单调不减。
- **来源**: review-scope-metrics / round 1

### ctx-usage/A-1 [P1] 会话级「切 Agent」入口无失效挂点（PRD 验收点名的路径）

- **维度**: A（失效挂点完整性）
- **文件**: `packages/core/src/service/chat/impl/session.service.ts:272-311`（`updateSessionAgentConfig`）
- **问题**:
  - 这是双端用户实际点的入口：mobile `src/components/provider/agent-picker.ts:87`（只传 `agentId`）、`ModelPickerModal.tsx:125`、desktop `src/main/ipc/handlers/sessions.ts:222 / :247`。
  - `modelId` 变更被 `savedModelId` 指纹兜住，但 **`agentId` 变更时指纹不变** → 换 agent（system 段 / prompt layout 变了）之后，旧的 `promptTokens` 照单全收。
  - 危害放大：这个旧值是以 `counterKind='api'` 的身份进入压缩阈值判定的，**跳过 0.85 安全垫**；而且已经落库 KKV，跨重启继续生效。
  - 与 ③ spec 变更点表 #6「14 个失效挂点」声称覆盖「切模型 / 切 Agent」直接矛盾——实际覆盖的是**工作区级** `persistent-state`，会话级 `updateSessionAgentConfig` 漏了。
- **改法**:
  1. **钉死取「就地自建」，删除注入方案**（round 2 补，替换 round 1 的「二选一，倾向注入」）：在 `updateSessionAgentConfig` 里就地 `createSessionKkvService(this.deps.conn)`。
     - 依据：同文件 `deleteSessionTree` 已经在用 `createSessionKkvService(tx)`（`session.service.ts:218`），`message.service.ts:85-90` 是同款做法；改注入要动 `SessionServiceDeps` + 三端装配 + 测试 fixture，**收益为零**（这条挂点只在写路径上跑一次，构造开销可忽略）。
  2. 在 `updateSessionAgentConfig` 成功写回之后调用 **`await invalidateSessionApiPromptTokenEntry(sessionKkv, sessionId);`**；**收窄口径写死**为：
     `validated.agentId !== baseline.agentId || validated.modelId !== baseline.modelId`
     （`baseline` 是 `updateSessionAgentConfig` 内 partial-overlay merge 的基线，`session.service.ts:278` 现成；`validated` 是 merge 之后的返回值）。
     - ⚠️ **v3 校对轮：`await` 不能省**。本条会让 `invalidateSessionApiPromptTokenEntry(` 在 `packages/core/src/service` 下**多出第 9 个调用点**，而 `ctx-usage/A-3` 的整个论点就是「这个删除必须被 await，否则进程退出会复活陈旧行」。round 2 的示例写的是裸调用（无 `await`），执行方照抄就会**在修 A-3 的同一个 PR 里新生产一处 fire-and-forget**——那比不改还糟，因为它披着「已闭合 A-3」的外衣。`updateSessionAgentConfig` 本身是 `async`（`:272`），加 `await` 零成本。
     - ⚠️ **不要写成「patch 里出现 `agentId` / `modelId` 就清」**：overlay 语义下 patch 常常带与当前相同的值（前端表单整体回传、CLI 重放同配置），那会把**无效写**也清掉，**收窄白写**，还多一次 KKV 写。
     - 覆盖完整性依据：`SessionAgentConfig` **只有 `agentId` + `modelId` 两个字段**（`packages/core/src/domain/chat/model/session-agent-config.ts:18-21`），其 zod schema 是 `.strict()`（`session-agent-config.schema.ts:10-15`，多一个键直接 parse 失败）——**不存在 prompts / system / 温度之类的会话级覆盖字段**，所以「`agentId` 或 `modelId` 变化」就是配置变化的**完整**判定，上面的比较口径不漏项。
  3. ③ spec 变更点表 #6 的**括号枚举同步加 `session.service.updateSessionAgentConfig`**（A-1 新增项），标题数字**不在本条写死**。
     - ⚠️ **v3 校对轮：改法 #3 的标题措辞与 deviations #16 互斥，本条以 #16 为唯一口径**。round 2 在本条里写「标题数字…订正为 **18 个失效挂点**」、在下一行又写「落地后是 **18 个调用点 / 15 个公开入口方法**」——**同一段里两个口径并存**，执行方不知道该往标题里填哪个。更糟的是 round 2 的「18 个失效挂点」是**旧口径**（「挂点」= 公开入口方法数），而 deviations #16 已定死统一写「**18 个调用点 / 15 个公开入口方法**」。
     - **本条只保留增量**：「枚举里加上 `session.service.updateSessionAgentConfig`」这一件事。**所有数字统一由 deviations #16 + `full/A-2` 负责**，本条不再出现任何绝对数字。
- **验收 / 测试**:
  - `packages/core/test/infra/tokenizer/prompt-token-invalidation.test.ts` 补一条：`seedRow` 后调 `sessions.updateSessionAgentConfig(session.id, { agentId: "other-agent" })`，断言 KKV 行消失；**再补一条反向用例**：patch 传**与当前相同**的 `agentId` / `modelId` → 断言 KKV 行**仍在**（钉住改法 #2 的收窄口径，防退化成「patch 里出现就清」）。
  - 读侧一条改为：**seed 一条 `savedModelId` 相同的新行后（模拟「A-1 挂点失效/被绕过」的坏态），不调 `updateSessionAgentConfig`、直接调读口 `resolveCurrentPromptTokens` → 断言 `source === 'local'`**。
    - ⚠️ round 1 写的「同 `savedModelId`、但会话已换 agent layout → 解析结果回退 `local`」是把第 1 条重测一遍：读口**只**用 `savedModelId` 指纹（`resolve-current-prompt-tokens.ts:68`），**根本没有 agentId / prompt layout 指纹**，所以换没换 agent 它都判 `local`，这条断言不构成独立覆盖。
    - 请**在 ③ spec 留痕这条设计属性**：「**读口无 agent 指纹，切 agent 的正确性完全依赖 `updateSessionAgentConfig` 这一个失效挂点**」——没有第二道防线，所以这个挂点必须被上面那条用例钉住。
- **来源**: review-scope-context-usage / round 1

---

> 以下全部为 P2。

### metrics/A-4 [P2] 维度 A｜文档一致性：8 处「未注入 = 旧行为」的绝对措辞在 usage 到达后已不成立

- **维度**: A（文档一致性）
- **文件**（round 2 实查逐一订正了行号；round 1 标注的行号与实际有偏移，以本清单为准）:
  | # | 文件:行 | 原文要点 |
  |---|---|---|
  | 1 | ① `bugs/stream-multi-step-rate-freeze/spec.md:49` | 「**与旧口径严格一致** → 既有 200+ 用例零行为变化」 |
  | 2 | ② `features/stream-live-token-estimator/prd.md:30` | 「无注入 = 旧启发式行为（既有测试与极简 runtime 零变化）」 |
  | 3 | ② `features/stream-live-token-estimator/prd.md:37` | 「**零回归**：不注入估算器的既有 path（含全部既有用例）行为不变」 |
  | 4 | ② `features/stream-live-token-estimator/spec.md:27` | 变更点表 #4「未注入 = 旧行为」 |
  | 5 | ② `features/stream-live-token-estimator/spec.md:69` | 「零回归：不注入估算器的既有 path 全绿」 |
  | 6 | ④ `features/stream-metrics-tokens/prd.md:26` | 「估算器不注入时保持旧启发式行为不变」 |
  | 7 | ④ `features/stream-metrics-tokens/spec.md:49` | 「与旧口径严格一致（既有用例零行为变化）」 |
  | 8 | ④ `features/stream-metrics-tokens/spec.md:79` | 「**未注入 = 旧行为**……200+ 既有用例零变化」 |
- **问题**:
  - ① 引入「基线 + 增量」之后，「未注入路径 = 旧口径」这个说法**只在 usage 到达之前成立**。旧口径的特征是「usage 之后 heuristic 不回写、读值冻结在真值上」，而 ① 恰恰把那个门拆了（`spec.md:49` 自己写着「不再有『usage 后 heuristic 不再回写』的门」）。所以 usage 到达之后，未注入路径的行为**已经和旧口径不一样了**——继续写「严格一致 / 零变化」是**假陈述**。
  - **同一份文档自相矛盾**：① `spec.md:57` 明写「原 T-M5 断言改写为『usage 后 delta 继续叠加』」，而 `:49` 同时宣称与旧口径严格一致。这两句放在一起本身就打架。
  - 后果：验收人按「零变化」理解，会把「usage 后数字继续动」当成回归；反过来按 `:57` 理解，又会认为 `:49` 是漏改的旧文案。两种读法都指向「必须收窄措辞」。
- **改法**（8 处统一收窄为**带时限的**表述）:
  - 把「与旧口径严格一致 / 零行为变化 / = 旧行为」一律改写为：「**未收到 usage 前**与旧口径严格一致；**usage 到达后**按 ① 的『基线 + 增量』口径（这正是 ① 的修复目标）」。
  - 「200+ 用例零行为变化」这类**测试结论**可以保留，但必须限定为「**未收到 usage 前**」或改为「既有用例仍全绿（断言已按 ① 的基线+增量口径改写，见 `spec.md:57`）」，不能继续当成行为等价声明。
  - ① `spec.md:49` 与 ④ `spec.md:49` 是矛盾双方的正面，**两条要一起改**，改完顺手对读一遍。
- **验收 / 测试**:
  - 改完后 `git grep -n "零变化\|严格一致\|旧行为" -- docs/Iterations/mobile-perf-2026-09` 在上表 8 处所在段落内，**不再出现未加时限限定的绝对表述**（`rollback-large-jank` 那一族是另一个 feature 的回滚语义，不在本次范围）。
- **Spec deviations**: 同步把本文件 deviations 表 **#12 由「一致」改判为「open → 由 metrics/A-4 闭合」**。
- **来源**: review-scope-metrics / round 2

### metrics/A-5 [P2] 维度 A｜文档一致性：「单元创建时同步构造」与 C-1 落地后的代码矛盾

- **维度**: A（文档一致性）
- **文件**:
  - ② `features/stream-live-token-estimator/spec.md:49` —「按编码名缓存单例、**单元创建时同步构造**（落在「run 开始到首字」之间，用户已接受）」
  - ② `features/stream-live-token-estimator/spec.md:74` —「缓解：按编码名缓存 + **单元创建时构造**（不在 delta 路径上）；若后续发现影响体感，可改为应用启动后空闲预热」
  - ④ `features/stream-metrics-tokens/spec.md:76` —「按编码名缓存单例、**单元创建时同步构造**（落在「run 开始到首字」之间）」
- **问题**:
  - `metrics/C-1` 把工厂调用从构造函数**下移到 `begin()`**、并把编码表构造挪到**会话切换时空闲预热**。C-1 一落地，这三处「单元创建时同步构造」立刻变成**假陈述**。
  - 而 C-1 的条目里**原本没有任何文档同步步骤**——执行方按 C-1 改完代码就会收工，三份 spec 的假陈述留在仓库里，下一个人照着 spec 理解代码就会得出错误结论（`:74` 甚至还挂着「可改为应用启动后空闲预热」这句**待办**，而 C-1 做的正是这件事）。
- **改法**:
  1. 把三处统一改写成：「编码表按编码名缓存单例；**构造时机＝会话切换时空闲预热，未就绪时在 `begin()`（run 起手）同步兜底**」。
  2. ② `spec.md:74` 的「若后续发现影响体感，可改为应用启动后空闲预热」**这句待办删掉**——C-1 已经把它做掉了，留着会让人以为还没做。
  3. 在 **② 与 ④** 两份 spec 的对应位置登记成一条 **spec_deviation**：「构造时机由『单元创建』改为『空闲预热 + `begin()` 兜底』」（见本文件 Spec deviations **#15**；③ 不涉及编码表构造，不动）。
  4. ② `spec.md:49` 里的实测数字（cl100k 约 180–250ms、o200k 约 420ms）**保留**，只改时机描述。
- **验收 / 测试**:
  - 三处措辞与 `metrics/C-1` 落地后的代码一致（执行时逐条对照 `session-stream-unit.ts` 的 `begin()` 与 `primeStreamTokenModelHint`）。
  - `git grep -n "单元创建时同步构造\|单元创建时构造" -- docs/Iterations/mobile-perf-2026-09` 无残留命中。
- **来源**: review-scope-metrics / round 2

### metrics/C-1 [P2] 估算器在构造函数里同步建，水合路径白付 180–420ms

- **维度**: C（性能 / 生命周期）
- **文件**: `apps/mobile/src/services/session-stream-unit.ts:373-391`（构造 inject 处）、`apps/mobile/src/services/stream-token-estimator.ts:86-109`（`getOrCreateEncoding`）
- **问题**:
  - 估算器在 `SessionStreamUnit` **构造函数内同步构造**（首建编码表 180–420ms）。
  - `startRun` 建单元 → **推后首个 run 的请求发出**。
  - `adoptInterruptedUnit`（启动水合 / 子会话懒建）也会白付这一次。水合是分片让路的 boot 路径，这一下就是**启动卡顿**。
  - ②spec 只登记了「落在 run 开始到首字之间」，**漏了水合这条路径**。
  - 附带问题：`getOrCreateEncoding` 构造失败时缓存 `null` 且**不再重试**，一次瞬时失败会让整个进程生命周期退回启发式。
- **改法**:
  1. 把工厂调用从构造函数**下移到 `begin()`**。水合/中断单元走 `settleAsInterrupted` + `hydrate`，**不经 `begin()`**，天然免付；真实 run 仍在请求发出前建（不推迟首个 delta）。
     - **顺序写死：`begin()` 内「先建估算器、后 `reset()`」。** 现有 `begin()`（`session-stream-unit.ts:412-415`）是 `rateSampler.reset()` → `heuristicBaseTokens = 0` → 两条估算器 `reset()`；新代码把两次 `factory(...)` 调用插在这批 reset **之前**（新建计数器天然已归零，紧随其后的 reset 是幂等的，但顺序必须写成「先建后重置」以免读代码的人以为可以省掉）。
     - **注释同步（读值不变，属注释问题）**：① `hydrateFromRunState` 里的防御性重锚注释（`session-stream-unit.ts:502-505`）现在写的是「而估算器从空开始」——C-1 落地后**水合单元压根没有估算器**（构造函数不再建、也不经 `begin()`），`estimateIncrementTokens()` 走的是启发式分支。该注释要改成如实描述「本单元无估算器（未经 `begin()`），重锚等价于 `读值 − ceil(chars/3.35)`」。**`reanchorHeuristicBase` 的算式与调用点都不动，读值不变。**
       ② ⚠️ **v4 收口轮：还有第二处**——`session-stream-unit.ts:373-374` 构造函数里那句「**单元创建时同步建**」的注释，C-1 一落地（工厂调用下移到 `begin()`）同样会变成**假陈述**，与 `metrics/A-5` 要改的三份 spec 属**同一类问题**（代码注释 / spec 措辞一起过期）。**同批改**，改写与 A-5 的 spec 措辞对齐：「构造时机＝会话切换时空闲预热，未就绪时在 `begin()` 同步兜底」。**只改注释，不动该处已删掉的工厂调用**。
  2. 在 `primeStreamTokenModelHint` 里顺带把编码表作为**预热**跑掉——会话切换时就把编码表建好，`begin()` 时命中缓存。
     - **预热对象写死**：`.then` 里要预热 **`resolveStreamTokenEncodingName(vendorModelId)` 解析出的那张编码表**（`getOrCreateEncoding(该名字)`），**并同时预热 `cl100k_base` 兜底那张**。只热解析出的那张是不够的：解析出的名字与 `begin()` 时读到的提示之间存在时序差，**提示没赶上的首 run 仍会在 `begin()` 里同步建 180–420ms，优化就落空了**；兜底那张必须提前备好，才能保证「没赶上」这条路上也不卡。
     - ⚠️ **v3 校对轮：预热代码的落点改写**。round 2 写的是「调用点是 `apps/mobile/src/runtime/novel-master-context.tsx:265` 的**会话切换 effect**，在 effect 里同步 `getOrCreateEncoding(...)`」——**这是错的，会让执行方直接卡住**：
       1. `getOrCreateEncoding` 是 **`apps/mobile/src/services/stream-token-estimator.ts:86` 的模块私有函数**（没有 `export`），`novel-master-context.tsx` **根本 import 不到**，在 effect 里调不到它。`:265` 那一行只是调 **`primeStreamTokenModelHint(runtime, scope.sessionId)`** 这个**已导出**的公开函数。
       2. **写死落点＝`apps/mobile/src/services/stream-token-estimator.ts:218` 的 `.then(vendorModelId => { ... })` 回调内、`vendorModelHintBySession.set(sessionId, vendorModelId)`（`:226`）之后**。预热代码写在**自己模块内**，不外泄私有函数、不动 `novel-master-context.tsx`。
       3. `:265` 的 effect **一个字都不用改**——它调的就是被改的 `primeStreamTokenModelHint`，预热自动生效。
     - ⚠️ **v3 校对轮：空闲化手段写死 `setTimeout(..., 0)`**。round 2 写「`setTimeout(..., 0)` 或 RN 的 `InteractionManager.runAfterInteractions`」——选后者等于让执行方去验一条**本仓从没走过的路**：`git grep -n "InteractionManager" -- apps packages` **零命中**，全仓从未用过这个 API，且它还需要在 mobile jest setup 里额外 mock（否则单测直接炸）。**本条取 `setTimeout(..., 0)`**。
       - （若将来坚持改用 `InteractionManager.runAfterInteractions`，必须**同时**写明「需在 mobile jest setup 里 mock」，否则 `session-stream-unit-pipeline.test.ts` 全红。这条备选只作留痕，不在本轮改法内。）
     - **顺序写死**：预热放在 `.then` 回调里 `set` 完缓存**之后**，即「先落提示缓存、再顺手把两张表建了」；不放在 `set` 之前，避免提示还没可用就占了主线程。
     - **「空闲化」的语义边界要写清**：`setTimeout(..., 0)` 只是把 180–420ms 从「点发送」搬到「切会话之后的下一个宏任务」，**不等于不卡**。② spec `:74` 那句「若后续发现影响体感，可改为应用启动后空闲预热」的待办由 `metrics/A-5` 删掉，本条**不改应用启动预热**——真机复验项（见「合并后 QA」表 `metrics/C-1` 第 ③ 行）就是盯「切会话路径也不卡」。
  3. `getOrCreateEncoding` 失败缓存 `null` 处加注释：「一次性降级，重试留给下次冷启动」，说明这是有意的策略而非 bug。
- **生产侧构造点枚举（v3 校对轮补，免得执行方以为只有 `startRun` 一处）**:
  - `git grep -n "new SessionStreamUnit(" -- apps packages` 在**生产代码**里共 **3 处**，全在 `apps/mobile/src/services/session-stream-unit-manager.service.ts`：
    | 路径 | 行 | 说明 |
    |---|---|---|
    | `startRun` 路径 | `:1096` | 真实 run 起手 |
    | `adoptInterruptedUnit` | `:1211` | 启动水合 / 中断单元，**不经 `begin()`** |
    | `adoptConsumptiveUnit` | `:1268`（`:1277` 紧跟 `begin()`） | `task` 派生的消费型子会话单元 |
  - **改法本身（下移到 `begin()`）对三处都正确**，不需要逐处分支：前两者走 `begin()` 之外的路径（`settleAsInterrupted` + `hydrate`）天然免付，第三处 `:1268` new 完 `:1277` 立刻 `begin()`，构造仍在请求发出前完成、不推迟首个 delta。执行方**只需在文件清单里带上 `:1268` / `:1277` 这两行**以便对照，不必改逻辑。
- **验收 / 测试**:
  - mobile `session-stream-unit-pipeline.test.ts` 补 1 条（把 `tokenEstimatorFactory` 换成 `jest.fn()`）：
    - **水合/中断单元**（`adoptInterruptedUnit` → `settleAsInterrupted` → `hydrateFromRunState` 路径）构造完成后，断言工厂调用次数为 **0**；
    - **另起一个 idle 单元走 `startRun` 路径**，等它的 `begin()` 被调用后，断言次数为 **2**（text + thinking 两条）。
    - ⚠️ **不能在同一个水合单元上调 `begin()` 来凑第二条断言**：`begin()` 开头是守卫 `if (this.destroyed || this.status !== 'idle') return false;`（`session-stream-unit.ts:404-407`），水合单元的状态是 `interrupted`，调 `begin()` **直接返回 `false`**，工厂根本不会被调用，断言「次数为 2」**必然跑不过**。round 1 的验收写法正是踩了这个坑。
- **来源**: review-scope-metrics / round 1

### metrics/C-2 [P2] 会话级 vendorModelId 提示缓存只增不失效，换模型后沿用旧编码

- **维度**: C（缓存时效）
- **文件**: `apps/mobile/src/services/stream-token-estimator.ts:55`（`vendorModelHintBySession` 声明）、`:171-173`（读）、`:206-232`（prime + FIFO 淘汰）、`:242-252`
- **问题**:
  - `vendorModelHintBySession` **无 TTL**，且**负结果 `null` 也被缓存**；只靠 FIFO 32 上限淘汰。
  - 用户在会话内换模型后，本会话后续 run 继续按**旧编码**估算（cl100k 估 o200k 中文约 ±10% 偏差），**静默发生**、无任何提示。
- **改法**:
  1. 缓存值从 `string | null` 改成 `{ vendorModelId: string | null; atMs: number }`。
  2. 读口（`:171-173`）命中但 `Date.now() - atMs > 10 * 60_000`（10 分钟）时返回 `undefined`——触发 cl100k 兜底并重新 prime。
  3. **in-flight 去重保留**（`vendorModelHintInFlight` 不动），避免过期瞬间并发重复 prime。
  4. **同步语义不变**：读口仍是同步返回，prime 仍是 fire-and-forget。
  5. **必须同时解掉「prime 被过期条目挡死」的死锁（round 2 补，否则本条改法是坏的）**：只做 1–4 会产出一段坏代码。读口（`stream-token-estimator.ts:171-173`）判定过期返回 `undefined` 之后，调用方 `createSessionStreamTokenEstimator`（`:246-251`）会调 `primeStreamTokenModelHint` 重新解析——而 prime 的早退守卫是 `if (vendorModelHintBySession.has(sessionId) || vendorModelHintInFlight.has(sessionId)) return;`（`:210-215`）。**过期条目还留在 map 里，prime 直接 return、永不刷新**，该会话此后**永久退回 cl100k**（直到被 32 上限 FIFO 偶然淘汰），TTL 等于白加。
     - **写死取「读口判定过期时直接 `vendorModelHintBySession.delete(sessionId)`」**：过期即淘汰，**prime 的 `has` 早退守卫保持原样不动**。理由：改动面最小、语义单一——缓存自己负责时效淘汰，不把时钟判定复制到 prime 里（否则读口与 prime 两处各判一次 `atMs`，将来必然漂移）。
- **验收 / 测试**（⚠️ **v3 校对轮整段重写：round 2 的验收不可观测，执行方照做会写不出断言**）:
  - **为什么原验收测不了**：`vendorModelHintBySession` 是 `stream-token-estimator.ts:55` 的**模块私有 `Map`**，该文件**没有任何 `__test` 导出**。round 2 写的「断言过期条目已被删」需要从测试侧直接观察这个 Map——**做不到**（要么改成导出内部状态、要么只能间接观察）。
  - **取「可观测代理」验收**（不改模块导出面）：构造一条过期条目 → 经**读口**（`createSessionStreamTokenEstimator`）拿到 cl100k 兜底（`hint === undefined`）→ **在读口那步之后等一次微 / 宏任务（`await new Promise(r => setTimeout(r, 0))`），断言 `runtime.sessions.getSessionAgentConfig` 计数 +1**。
    - ⚠️ **v4 收口轮：删掉「**再次**调 `primeStreamTokenModelHint`」这一步——它多余，而且按原字面写会让执行方困惑**。读口在 `hint === undefined` 时**已经自动调过一次 prime**（`createSessionStreamTokenEstimator` 的既有逻辑，见 `stream-token-estimator.ts:246-251`），手动再补一次调用会撞上 `has()` / in-flight 早退守卫（`:210-215`）——**要么直接 `return`、要么在 in-flight 集合里**，**根本不会产生第二次 `getSessionAgentConfig`**，断言必然失败。执行方若照 round 3 的字面写法做，会误判成「改法 #5 的 `delete` 没落地」而回头去改已正确的代码。**本条断言靠的是「读口自己触发的那一次」，不是测试手动补的那一次。**
    - 这条断言的因果链正是改法 #5：`getSessionAgentConfig` 只在 `resolveStreamTokenVendorModelId`（`:181`）里被调，而 prime 的早退守卫是 `has()`（`:211`）。**只有过期条目已从 Map 里 `delete` 掉，`has()` 才会放行**、才会走到 `getSessionAgentConfig`。所以「读口之后计数 +1」＝「`has` 没挡住」＝「过期条目已删」——**把不可观测的内部状态换成了可观测的外部行为**。
    - 反向对照：若把改法 #5 的 `delete` 去掉，这条断言**必须变红**（`has` 挡住 → 不再解析 → 计数不增）。执行方请用这一条自验改法真的落地了。
  - 造时间差的手段：**取 `jest.spyOn(Date, 'now')`**（`readVendorModelHint` 的过期判定读的就是 `Date.now()`）。「把 `atMs` 做成可注入参数（可控时钟）」**降为备选**——它要动 `primeStreamTokenModelHint` 的签名与三处调用方（`createSessionStreamTokenEstimator:249`、`novel-master-context.tsx:265`、以及本条新增的预热调用），为一条断言不值得。
  - 用例放在 `apps/mobile/__tests__/stream-token-estimator.test.ts`（既有文件），补 2 条：①过期条目不被采信（读口走 cl100k 兜底）＋重新 prime 后取到新值；②上面那条「过期条目已删」的代理断言。
- **来源**: review-scope-metrics / round 1

### metrics/C-3 [P2] 旧语义注释残留

- **维度**: C（文档一致性）
- **文件**（⚠️ **v3 校对轮：两处措辞不同，别按同一个词 grep**）:
  - **措辞 A「字符折算兜底」**（`git grep -n "字符折算兜底" -- apps packages` **只命中 2 处**）：
    1. `apps/mobile/src/hooks/useAgentStreamMetrics.ts:16` — 「usage=事件真值（run 级累计）；heuristic=字符折算**兜底**」
    2. `apps/mobile/src/services/session-stream-unit.ts:169` — 同上（评审未点名，grep 时**同样命中**，见下）
  - **措辞 B「真值优先，heuristic」**（`git grep -n "真值优先，heuristic" -- apps packages` **另外 2 处**，措辞与 A 不同）：
    3. `packages/core/src/domain/session-run-state/model/session-run-state.ts:47` — 「usage **真值优先**，heuristic **兜底折算**」
    4. `packages/core/src/domain/format/format-stream-metrics-line.ts:18` — 同上（评审未点名，grep 时**同样命中**）
- **问题**:
  - 新语义下 heuristic 是**永远参与增量**的读值成分，不是「兜底」。注释会把后续维护者带回旧模型。
  - **评审扩项（只读 grep 实跑补的）**：A、B 两种措辞合计实际命中 **4 处**，比评审点名的 2 处多 2 处（`session-stream-unit.ts:169`、`format-stream-metrics-line.ts:18`）。四处一起改，否则收口不干净。
- **改法**:
  - 统一按 desktop hook `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:30` **已改好的措辞**改写：`usage = 基线来自事件真值（run 级累计），读值 = 基线 + 增量；heuristic = 基线为 0 的纯估算`。
    - ⚠️ **v3 校对轮：删掉 round 2 那处自相矛盾的「已改好的参照」**。round 2 写的是「按 desktop hook `:30` 与 **`session-run-state.ts:16-20`** 已改好的措辞改写」——但 `session-run-state.ts:16-20` 是**同一个文件里另一处**：`StreamTokenSource` 类型的 JSDoc，它确实已改好；可本条目**同时**把该文件的 **`:47`** 列为待改点。**同一文件既当「待改点」又当「已改好的参照」**，执行方会困惑到底哪句算标准。**保留 `:47` 为待改点，参照只留 desktop hook `:30` 一处。**
- **验收 / 测试**（⚠️ **v3 校对轮：拆成两条 grep，round 2 的一条 `\|` 组合模式在 Windows 下不可靠**）:
  - `git grep -n "字符折算兜底" -- apps packages` **无输出**；
  - `git grep -n "真值优先，heuristic" -- apps packages` **无输出**。
  - ⚠️ **Windows cmd 下的假阴性提醒**：上面两条模式里含**全角逗号**（`真值优先，heuristic`）。在 Windows cmd 的 `git grep` 里，含全角标点的模式**可能匹配不到却返回成功**（编码 / 代码页问题），造成「grep 无输出＝已改干净」的假结论。**执行方请用 PowerShell `Select-String` 复核一遍**，或改用 ASCII 锚点（例如 `heuristic` + `兜底` 分两次搜、或搜 `真值优先` 三个字）。

- **来源**: review-scope-metrics / round 1（文件清单由本轮复核扩到 4 处）

### metrics/C-orch-1 [P2] 「基线 + 增量」公式双端各写一遍且命名不一致

- **维度**: C-orch（跨端一致性）
- **文件**: `apps/mobile/src/services/session-stream-unit.ts:592-628`（读值 `:615`、重锚 `:624-625`、`:506`/`:700` 调用） vs `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:176-194`（读值 `:192`）、`:272-286`（重锚 `:278`）
- **问题**:
  - 同一口径两处实现，命名还不同：mobile 用 `heuristicBaseTokens` / `reanchorHeuristicBase`，desktop 用 `baseTokens` + 内联算式。
  - `heuristic` 前缀在 ① 之后已属**误导**（基线可能来自 usage 真值）。
- **改法**:
  1. 在 `packages/core/src/domain/format/` 新增两个**纯函数**并从 `public/format.ts` 转出：
     - `composeStreamTokens(base, increment) = max(0, base + increment)`
     - `reanchorStreamTokenBase(truth, increment) = truth - increment`
  2. **同时加进 `apps/desktop/shared/logic/format.ts:9-21` 的显式具名再导出**（round 2 补的必做步骤，**v3 校对轮订正插入方式**）：该文件是 desktop renderer 对 `@novel-master/core/format` 的薄再导出，文件头**明文写着「禁止 `export *`」**，只从 `public/format.ts` 转出是不够的——desktop 侧 `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:26` 与 `apps/desktop/renderer/hooks/stream-token-estimator.ts:19` 都是 `from "@shared/logic/format"` 取符号，**新函数不加进去 desktop 侧 import 不到**。需要的话把配套类型一起加。
     - ⚠️ **插入方式写死：`追加到现有列表末尾，不重排既有条目`**。round 2 写的是「保持字母序（现有列表已排序）」——**这是假事实**。实查 `format.ts:9-21` 的现状是 `buildStreamMetricsLine` → `formatCharCount` → `formatStreamElapsed` → `slidingTokenRate` → `createTokenRateSampler` → `createIncrementalTokenCounter` → 常量 → 类型，**既不是字母序也不是逆字母序，是历史追加顺序**。执行方若「按字母序插进去」就会顺手把整份列表重排，**diff 噪声从一个 PR 扩大到整个文件**，还可能与其他人的并行改动冲突。
     - 正确做法：在 `createIncrementalTokenCounter,` 那一行**之后**、`SLIDING_TOKEN_RATE_WINDOW_MS,` 之前（或列表末尾，取决于你怎么分组）**追加**两个函数名，既有 6 行一个字不动。
     - 同批同改的姊妹条目见 `ctx-usage/C-4`——**本条改法 #2 即 `ctx-usage/C-4` 改法 #1 所指的那处改动，两者已在 v3 校对轮去重**（归属本条 / metrics scope，ctx-usage scope 执行方不要动该文件）。
  3. 双端改为调用这两个函数，删掉本地算式。mobile 侧基线字段统一改名 `baseTokens`（`heuristicBaseTokens` 顺带改名，**私有字段、不进投影**，既有 `toEqual` 形状用例不受影响）；`reanchorHeuristicBase` 改为调用 core 函数。
  4. **保留 `reanchorHeuristicBase` 内的 `this.metricsAcc.completionTokens = Math.max(0, value);` 这一行**（`session-stream-unit.ts:626`）——要么原样保留、要么改写为 `composeStreamTokens(value, 0)`，**二选一都行，但不许删**。它是读值的收敛点（夹负 + 写回 metrics），值上恒等于 `Math.max(0, value)`，属命名收敛、不是行为变更；实现方极易把它当成被 core 函数取代的冗余算式一并删掉。
- **验收 / 测试**:
  - core 补 2 条单测：①负基线被夹到 0（`composeStreamTokens(-5, 3) === 0`）；②重锚恒等式（`composeStreamTokens(reanchorStreamTokenBase(t, i), i) === max(0, t)`）。
  - 双端既有用例**零改动**应仍全绿。
  - desktop `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` 无新增报错（验证改法 #2 的再导出闭环真的通了）。
- **来源**: review-scope-metrics / round 1

### metrics/G-1 [P2] desktop 估算器绑定零测试覆盖

- **维度**: G（测试覆盖）
- **文件**: `apps/desktop/renderer/hooks/stream-token-estimator.ts:1-60`（新增测试放 `apps/desktop/test/stream-token-estimator.test.ts`）
- **问题**:
  - desktop 绑定是唯一用**裸 default import** 拿 ranks 的一份（**`:20`**，⚠️ **v4 收口轮行号订正**：round 3 写的是 `:21`，那是 ranks 的 `default` import 行、不是 `Tiktoken` 那一行；静态具名 `import { Tiktoken }` 在 **`:20`**，且没有 mobile 那份的 `(mod.default ?? mod)` 兜底），却**一行断言都没有**。
  - 打包形态或依赖版本一变，坏的是**生产 renderer**，CI 不报。
- **改法**:
  - 新增 `apps/desktop/test/stream-token-estimator.test.ts`（tsx / `node --test` 环境），4 条断言：
    1. `createDesktopStreamTokenEstimator()` 返回非 null，`push("hello world")` 后 `tokens === 2`；
    2. 两次调用返回**独立实例**（`a.push(...)` 不影响 `b`）；
    3. `reset()` 后归零；
    4. 模块级编码**单例复用**：断言**连续两次 `createDesktopStreamTokenEstimator()` 只触发一次编码表构造**。
       ⚠️ **不要用「第二次调用构造耗时 `< 5ms`」这类计时断言**：CI 机器抖动会误红，且它无法区分「命中了模块级缓存」与「没命中但这次构造恰好很快」——正是本条要防的那种退化它测不出来。
       - ⚠️ **v3 校对轮：断言 #4 的手段整段改写**。round 2 写的是「patch / monkey-patch `js-tiktoken/lite` 的 `Tiktoken` 构造函数做构造计数」——**在 desktop 测试里这条路走不通**。desktop 走 `npx tsx --test`（**真 ESM**），而 `apps/desktop/renderer/hooks/stream-token-estimator.ts:20`（⚠️ **v4 收口轮行号订正**：round 3 两处都写成 `:21`，那是 ranks 的 `default` import 行；静态具名 `import { Tiktoken }` 在 **`:20`**）是**静态具名导入** `import { Tiktoken } from "js-tiktoken/lite";`。ESM 的具名导入在模块求值时就已绑定到原导出，测试侧再 monkey-patch 模块对象**打不进去**（改到的是测试自己那份 module namespace 副本，源模块早已取值）。
       - **取「仓库已有的 ESM loader 钩子」机制**（本仓已经在用、有现成范式）：
         1. **新增 `apps/desktop/test/js-tiktoken-hook.mjs`**：包一层 `js-tiktoken/lite`，把 `Tiktoken` 换成**带构造计数**的版本，对外暴露计数读口 `__test__.constructionCount`。
         2. 在既有 `apps/desktop/test/register-electron-mock.mjs` 里加一行 `register("./js-tiktoken-hook.mjs", import.meta.url);`——该文件**已经**用 `module.register` 注册了 `electron-hook.mjs` / `core-at-alias-hook.mjs`（`.test-native` 在位时还有 `better-sqlite3-hook.mjs`），本仓的钩子机制是**验证过的**，不是在开新路。
         3. 断言读 `__test__.constructionCount`：连续两次 `createDesktopStreamTokenEstimator()` 前后计数**只 +1**。
       - ⚠️ **v4 收口轮：钩子文件里取原 `Tiktoken` 的写法有坑，写错会自指死循环**。钩子要被 `js-tiktoken/lite` 自己也解析一遍，若在钩子里写 `import { Tiktoken } from "js-tiktoken/lite"`（**裸 specifier**），`module.register` 的 resolve 钩子会把它**拦回钩子自己** → 无限递归 / 栈溢出，测试直接起不来。**必须用 `createRequire(import.meta.url).resolve("js-tiktoken/lite")` 拿到绝对路径后以真实绝对 file URL 加载，或用其它绕开自定义 resolve 钩子的等价手段**——**不许用裸 specifier**。
       - ⚠️ **v4 收口轮：计数读口由「测试文件自己」取，不是从钩子实例上取**。钩子对**所有 importer 生效**，所以测试文件与被测源码**拿到的是同一个 `js-tiktoken/lite` 模块实例**。读法：`import { __test__ } from "js-tiktoken/lite"`（**在测试文件里直接 import，不是 require 钩子文件**），然后读 `__test__.constructionCount`。
         - 钩子是 `.mjs`、测试是 `.ts`（tsx 运行），`__test__` 是**钩子动态挂上去的、不在 `js-tiktoken` 的类型声明里**，所以需要**一处类型 cast 或模块声明**（例如 `import type { TiktokenTestHandle } from "./js-tiktoken-hook.mjs"` 后 cast，或在测试文件里加 `declare module "js-tiktoken/lite" { export const __test__: { constructionCount: number } }`）。**别为了「拿到类型」去改 `js-tiktoken` 包的类型或用 `any` 糊过去**，写清楚这处 cast 是干什么的。
       - **范围声明**：**新增 `js-tiktoken-hook.mjs` 是本条唯一允许的新增基建**。除它与新测试文件外，不许为这条断言再动 `apps/desktop/package.json`、构建配置或任何生产代码。
- **验收 / 测试**（⚠️ **v3 校对轮订正命令路径**）:
  - round 2 写的 `node scripts/run-tests.mjs test/stream-token-estimator.test.ts` **路径不对**——`scripts/run-tests.mjs` 在 **`apps/desktop/scripts/run-tests.mjs`**，必须**相对 `apps/desktop` 目录**执行：
    ```
    cd apps/desktop && node scripts/run-tests.mjs test/stream-token-estimator.test.ts
    ```
  - 该命令全绿，且 `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` 无新增报错。
- **来源**: review-scope-metrics / round 1

### metrics/G-2 [P2] 注入路径的失败分支无用例

- **维度**: G（测试覆盖）
- **文件**: `apps/mobile/__tests__/session-stream-unit-pipeline.test.ts`、`apps/desktop/test/use-agent-stream-metrics-hook.test.tsx`、`apps/mobile/__tests__/session-stream-unit-accum-perf.test.ts:160-181`
- **问题**: 以下分支**全无测试**：
  - 工厂返回 `null`（应整条回退启发式）；
  - 只建其一成功（代码刻意「两条都建成才启用」，半套状态会让正文/思考增量口径不一致）；
  - 工厂抛错（`try/catch` + `console.warn`）；
  - 跨 run `reset`（防止上一 run 的计数串入，**`session-stream-unit.ts:414-415`**——⚠️ **v4 收口轮行号订正**：round 3 写的是 `:413`，但 `:413` 是 `heuristicBaseTokens = 0`，两条估算器 `reset()` 在 `:414-415`）；
  - `hydrateFromRunState` 的**防御性重锚**（水合用例只断言 `partialText`，根本没碰 `completionTokens`）。
- **改法**:
  - mobile pipeline 补 2 条：①工厂返回 `null` → 读值等于 `ceil(chars / 3.35)` 的启发式值；②同会话二次 `start` → 首读为 0，不带上一 run 的估算。
  - desktop hook 补 1 条：工厂 `null` 与工厂抛错各占一半断言，回退后读值等于启发式值。
  - `session-stream-unit-accum-perf.ts:160-181` 那条水合用例**加一行**对 `completionTokens` 的断言（覆盖 `tokenSource === 'usage'` 那一行）。
- **验收 / 测试**: mobile jest + desktop `run-tests.mjs` 全绿；**不注入路径的既有用例数量不得变动**（防止为了补测试把老用例改掉）。
- **来源**: review-scope-metrics / round 1

### ctx-usage/A-2 [P2] `message.append` 未挂失效（PRD「消息增」缺环）

- **维度**: A（失效挂点完整性）
- **文件**: `packages/core/src/service/chat/impl/message.service.ts:122-160`（`append`）
- **问题**:
  - `append` 之后 prompt 已经变了，但旧值仍以 api 口径留着（**不吃 0.85 安全垫的低估窗口**被拉到跨重启）。
  - 改动前热层也有这个窗口（**非本 diff 引入**），但 ③PRD 把「消息增删改」写成硬验收项，变更点表 #6 的挂点枚举**独缺「增」**。
  - **非测试调用面（round 2 实查补全，共 6 处）**：
    1. `packages/core/src/service/agent/logic/run-agent-turn.ts:422`（用户发言）
    2. `packages/core/src/service/agent/impl/chat-agent-session.ts:45`（`this.messages.append(...)` 薄包装，run 内入口）
    3. `apps/desktop/src/main/ipc/handlers/messages.ts:125`（desktop IPC handler）
    4. `apps/cli/src/message/commands.ts:141`（CLI 取证/调试面）
    5. `apps/cli/src/model/commands.ts:86`
    6. `apps/cli/src/model/commands.ts:92`
    - mobile 侧**没有**直接的 `messages.append` 调用点（走 webview/bridge 进 desktop handler 或 runner），`git grep -n "messages\.append(" -- apps packages` 去掉 test 后就是上面这 6 条。
    - round 1 只列了其中 2 处（`run-agent-turn.ts:422` 与 desktop handler），CLI 与 `chat-agent-session` 两面被漏——执行方容易以为「挂 `append` 一次就全覆盖了」。
    - ⚠️ **v3 校对轮：这份清单是「覆盖面说明」，不是「改动清单」**。**上面这 6 处本轮不需要改任何一个文件**——`git grep` 复核覆盖面即可。列它们出来只是为了让执行方确信「把失效挂点挂在 `append` 内部（改法 #1）就等于一次覆盖全部 6 条调用路径」，不必逐个去调用方加删除逻辑。**在任一调用方里再插一次 `invalidate` 反而会重复删、且 CLI 那 3 处拿不到 `sessionKkv`。
- **改法**（**只取「挂失效」方案，没有第二条路**）:
  1. `append` 在 `await this.deps.messages.insert(message)` 之后加 `await this.invalidatePromptTokens(sessionId);`，复用该类已有的私有 helper，不新写删除逻辑。（该 helper 在 `ctx-usage/A-3` 里被改成 `private async` 并 `await`，本条直接吃到 `async` 语义。）
  2. ⚠️ **本条不设「收窄登记」逃生口**（round 2 删除，替换 round 1 的「若执行方想改走收窄路线，必须在 ③ spec 显式登记」）：③PRD 把「消息增删改」写成**硬验收项**，A-1 + A-2 正是为了让变更点表 #6 的枚举真正覆盖它。留逃生口等于把一条硬验收重新打开成待议——**要收窄必须先改 PRD，不是改 spec**。
  3. **两条必须写进改法的产品语义（需用户拍板，见 Open questions #11）**：
     - **(i) 标签回落**：append 一清值，**run 期间**占用标签会从「上次请求」回落为「预估」，直到本轮 run 结束、runner 写回新的 api 值为止。回落期间**数字本身也会明显偏低**（比普通「预估」更扎眼），但**原因不是「本地估算不算 tools」**——见下方 ⚠️ 的口径订正。
       - ⚠️ **v3 校对轮：(i) 的理由原文是错的，属 P1 级假事实，照错句「对齐」会直接打穿 C 组**。round 2 与 Open questions #11(i) 都写「**本地预估不含 tools 段**（本地 `countPromptLlmInput` 只拼 messages + system）」——**错**。实查：`countPromptLlmInputHeuristicOnly` **是拼 tools 的**（`packages/core/src/infra/tokenizer/logic/count-prompt-llm-input.ts:80-82`）；`token-ratio.trigger.ts:66-68` 明确传 `...(evaluation.tools != null ? { tools: evaluation.tools } : {})`，注释写着「压缩评估路径**必须**传 tools：本地估算含 tools 段后与 API 口径才可比」。**缺 tools 的是 UI 读口**，不是 core 的本地估算。
         - **执行方若照这句错话去「对齐口径」，第一反应会是去删 core 里 `count-prompt-llm-input.ts:80-82` 的 tools 拼接**——那会让压缩评估的估算整体偏小、阈值系统性偏低，**直接打穿 C 组（tools 补计数）与整条压缩链**。这条错句必须改掉。
       - **改法句改为**：
         > 「回落期的**预估**不含 tools 段，是因为 **UI 读口拿不到 tools**（`session-prompt-input` 不产 tools，双端显式传 `undefined`，见 desktop `chat-prompt-tokens.service.ts:106-111` / mobile `:74-79`）；**本地 `countPromptLlmInputHeuristicOnly` 本身是拼 tools 的**，压缩评估路径照常含 tools（`token-ratio.trigger.ts:66-68`）。」
       - 附带的**正确落点**（不是本条改法，登记在此免得再被当成一处「顺手对齐」的机会）：双端 UI 读口那两行 `+ serializeToolsForTokenCount(undefined)` 是恒等空串的误导性死代码，由 **`full/D-1`** 单独处理；**core 侧 `:80-82` 的拼接保留不动**。
     - **(ii) 压缩判定整个 run 内不再吃 api 值**：step-1 的压缩评估发生在 usage 写回之前，而 append 已经把旧值清了，所以**整个 run 期间压缩判定都走 `heuristic + 0.85 安全垫`**。这**比现状更准**——现状拿的是上一轮的 api 值、不含本轮新增的用户消息，系统性低估、压缩偏晚。但它**是一次未登记的行为变更**（改前整个 run 用 api 值，改后全程启发式），必须显式登记、请用户确认。
- **验收 / 测试**:
  - `prompt-token-invalidation.test.ts` 补「`message.append` 后 KKV 行被清」。
  - 本条**只有「挂失效」一种落地方式**（见改法 #2），③ spec 变更点表 #6 的枚举同步加 `append`。
- **来源**: review-scope-context-usage / round 1

### ctx-usage/A-3 [P2] 失效的 KKV 删除未被 await（进程退出会复活陈旧行）

- **维度**: A（持久层时序）
- **文件**: `packages/core/src/infra/tokenizer/logic/session-api-prompt-token-store.ts:222-242`（`invalidateSessionApiPromptTokenEntry`） + **七个 async 调用方 + `agent-runner` 两处 fire-and-forget（表中共 9 行）**
- **问题**:
  - 热层是**同步清**的（同进程内不会读到陈旧值），但 KKV 删除是 `void ...delete().catch(...)`，**不被 await**。进程在 promise 落地前退出，KKV 行会**复活**。
  - 这些调用方本来就在 async 路径上，完全可以等。
  - `agent-runner` 收尾那两处保持 fire-and-forget 是**对的**（run 收尾不等 IO），不要一起改。
- **调用方完整清单（v3 校对轮订正：现状 8 处调用 / 6 个 async 调用方 + agent-runner 2 处 fire-and-forget；**`ctx-usage/A-1` 落地后为 9 处调用 / 7 个 async 调用方**）**:
  | # | 文件:行 | 现状 | 改法 |
  |---|---|---|---|
  | 1 | `packages/core/src/service/chat/impl/message.service.ts:85-90` | 私有 helper `invalidatePromptTokens`，内部转调 | 改 `private async`，**10 个调用点全部 `await`**（见下） |
  | 2 | `packages/core/src/service/chat/impl/message-transcript-effects.service.ts:174` | 未 await | `await`（round 1 漏列） |
  | 3 | `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:237` | 未 await | `await` |
  | 4 | `packages/core/src/service/compaction-conditions/run-compaction.ts:82` | 未 await | `await` |
  | 5 | `packages/core/src/service/persistent-state/impl/persistent-state.service.ts:140` | 未 await | `await` |
  | 6 | `packages/core/src/service/vfs/logic/clear-session-prompt-caches.ts:32` | 未 await | `await`（round 1 漏列） |
  | 7 | **`packages/core/src/service/chat/impl/session.service.ts`**（`updateSessionAgentConfig` 写回之后，行号随 A-1 落点定） | **该调用点不存在** | **A-1 落地时新建，必须 `await`**（见下方改法 #5） |
  | 8 | `packages/core/src/service/agent/impl/agent-runner.ts:873` | 未 await | **保持 fire-and-forget**，显式 `void` + 注释 |
  | 9 | `packages/core/src/service/agent/impl/agent-runner.ts:909` | 未 await | **保持 fire-and-forget**，显式 `void` + 注释 |
  - ⚠️ **v3 校对轮：第 7 行是 A-1 带来的第 9 个调用点，round 2 漏列**。`ctx-usage/A-1` 会在 `updateSessionAgentConfig` 里新增一处 `invalidateSessionApiPromptTokenEntry(`，它是**本表之外的新调用方**，必须一并 `await`——否则 A-1 会静默生产一处新的 fire-and-forget（正是本条要治的病）。**A-1 改法 #2 的示例已同步写成 `await ...`**，两处必须一起改、一起验收。
  - 计数口径因此由「**共 8 处调用 / 6 个 async 调用方**」改为「**A-1 落地后共 9 处调用 / 7 个 async 调用方**」（6 个既有 async 调用方 + A-1 新增的 1 个；`agent-runner` 2 处 fire-and-forget 不计入 async 一侧）。
- **改法**:
  1. `invalidateSessionApiPromptTokenEntry` 返回类型改为 `Promise<void>`；**内部热层仍同步清**、`catch` 保留（语义不变，只是多一个可 await 的句柄）。
  2. **七个** async 调用方（含 A-1 新增的 `session.service.updateSessionAgentConfig`）改为 `await`。
  3. **async 传染必须写死（否则改出来是静默半成品）**：`message.service.ts:85` 的 `private invalidatePromptTokens(sessionId: string): void` **必须**改成 `private async invalidatePromptTokens(sessionId: string): Promise<void>`，其 **10 个调用点全部 `await`**：
     `:159`（**append**——`ctx-usage/A-2` 新增的第 10 处，落点在 `messages.insert` 之后）、`:201`（delete）、`:217`（updateContent）、`:311`（hide）、`:323`（show）、`:343`（hideRange）、`:365`（showRange）、`:396` / `:411` / `:426`（truncateAfter 的三处）。
     ⚠️ **v4 收口轮：计数从 9 改为 10**。round 3 的 v3 校对轮把这里的调用点清单**少算了一处**（未计入 A-2 新增的 `append`），而 `ctx-usage/A-2` 改法 #1 会在 `message.service.append` 里**新增第 10 处** `this.invalidatePromptTokens(`。**A-2 与 A-3 必须同批改**：A-2 新增调用点时就带 `await`（它已经吃到了 A-3 的 `async` 语义），A-3 的清单与自查 grep 若不跟着改成 10，执行方按旧清单核对会**漏掉 append 那一处**、以为已经点完。
     ⚠️ TypeScript 不会因为「调用方丢弃了一个 Promise」而报错——漏改任何一个调用点，代码照样编译、测试照样全绿，只是那个挂点悄悄退回 fire-and-forget，正是本条要治的病。所以这是**静默半成品**，必须逐个点名核对，不能靠编译器和测试兜底。
     **自查命令（v3 校对轮补第二条，覆盖到 A-1 的新调用点；v4 收口轮订正期望值）**：
     - `git grep -n "this.invalidatePromptTokens(" -- packages/core/src/service/chat/impl/message.service.ts` 应命中 **10 处调用（外加 `:85` 的声明共 11 行），且每处调用前都有 `await`**。
     - `git grep -n "invalidateSessionApiPromptTokenEntry(" -- packages/core/src/service` —— **除 `agent-runner.ts` 的 `:873` / `:909` 两处外，其余每一处前面都必须有 `await`**。这条命令是本条改法 #1+ #2+ #5 的**总闸门**：它一次覆盖了 `message.service` 私有 helper 内的转调、其余 5 个既有 async 调用方、以及 A-1 新增的那个。**漏一处就当场看得见**。
  4. `agent-runner` 两处显式写 `void` + 注释「run 收尾不等 IO」，把意图钉在代码里。
  5. **⚠️ v3 校对轮新增：两处 JSDoc 会因本条变成假陈述，必须同批改**。它们现在都写着「删除是 fire-and-forget」，本条把删除改成 `await` 之后，这两句就**从描述事实变成了描述历史**：
     - `packages/core/src/service/chat/impl/message.service.ts:83` —「所有调用点都在事务之外，KKV 删除是 fire-and-forget（见 helper 注释）」→ 改为「**已 await**（KKV 删除在事务外落地，失败只吞 warn）」。其中「所有调用点都在事务之外」这半句**保留**，并写成「**所有调用点都在 `conn.transaction` 块外**」——**v4 收口轮：这句话里不要写任何数字**。此处此前写死了一个具体调用点数（本轮已移除，理由见上），而 `ctx-usage/A-2` 落地后会再变一次；**数字会再次过期，且过期的数字在 JSDoc 里没人会去核对**。本轮已实查确认无事务风险（若在事务内 `await` 一个 KKV 写入会跨事务持锁），这是「敢改成 `await`」的依据，写进改法依据免得下一个人重新怀疑一遍。
     - `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:236` —「在事务外，删除是 fire-and-forget，见 helper 注释」→ 改为「**已 await**（KKV 删除在事务外落地，失败只吞 warn）」。
- **验收 / 测试**:
  - `prompt-token-invalidation.test.ts` 与 `compaction-conditions/run-compaction.test.ts` 里的 `waitRowGone` **轮询改为直接断言**（await 之后立即应为 `null`）。
  - `session-api-prompt-token-store.test.ts` 的**两条**都要改 `await`（round 1 只点了一条）：`:257`「失效：热层与 KKV 行双删（跨重启不复活）」（调用点 `:270`）与 **`:284`「失效：KKV delete 抛错只吞掉（热层已清）」（调用点 `:295`）**。
- **来源**: review-scope-context-usage / round 1

### ctx-usage/A-4 [P2] `atMs` 缺失退化为 0 与其「时效判定」用途冲突

- **维度**: A（数据契约）
- **文件**: `packages/core/src/infra/tokenizer/logic/session-api-prompt-token-store.ts:110-121`（`atMs` 兜底行 `:112`；注释 `:19-20`、`:82-84`）；③ spec `:36`（「旧格式值照常解析（向后兼容）」）
- **问题**:
  - `prompt_tokens` 是本轮**新增的域**，线上不可能有旧格式行——「旧格式兼容」是**空转**。
  - `atMs` 缺失/非法退化为 `0`，会让基于时间的判据把它当「永远过期」，或被 `=== 0` 守卫**静默放行**——两种都不对。
  - `promptTokens = 0` 这条路径是**合法**的，要保留（不能顺手一起拒）。
- **改法**:
  1. `atMs` 与 `promptTokens` 同为**必填**：`typeof atMs !== "number" || !Number.isFinite(atMs)` 时**整体按 miss 返回 `null`**（与 `promptTokens` 的校验放在一起做）。
  2. 三处「旧格式值照常解析（向后兼容）」注释（store `:19-20`、`:82-84`，以及 ③ spec `:36`）统一改为「**字段缺失 / 类型不对一律当 miss**」。
  3. 保留 `promptTokens === 0` 为合法值（`>= 0` 的现有判断不动）。
- **验收 / 测试**:
  - `session-api-prompt-token-store.test.ts:132-136` 的「`atMs` 退化为 0」断言**反转**为「返回 `null`」。
  - `resolve-current-prompt-tokens.test.ts` 补一条：「只有 `promptTokens` 无 `atMs` ⇒ 判 `local`」。
- **来源**: review-scope-context-usage / round 1

### ctx-usage/C-1 [P2] CLI 是 tools 拼接的第四处漏网点（与 spec「三处统一」不符）

- **维度**: C（口径覆盖）
- **文件**: `apps/cli/src/prompt/commands.ts:128`（heuristic 档 `serializePromptLlmInput`）、`:151`（`countPromptLlmInput`）；③ spec `:45`
- **问题**:
  - `serializePromptLlmInput` 的**非测试**调用方共四处：core heuristic-only（`count-prompt-llm-input.ts:81`）、node driver（`tokenizer-driver-node/src/count-prompt-llm-input.ts:61`）、RN driver（`tokenizer-driver-rn/src/count-prompt-llm-input.ts:174`）——这**三处都拼 tools**；CLI 这**两处没拼**。
  - ③ spec `:45` 写的是「**三处统一**」，与代码不符。
- **改法**（**取方案 2：登记收窄，不改 CLI 行为**）:
  - 判定 CLI 为**取证 / 调试面**，不参与压缩判定 → 不要求它与压缩评估同口径。
  - 在 `commands.ts:128` 与 `:151` 两个调用点各加一条**中文注释**：说明「此处不计 tools，与压缩评估存在口径差，仅供人工核对」。
  - 在 ③ spec C 组「范围收窄」段**显式登记 CLI 也不含 tools**（原文只登记了 UI 读口，漏了 CLI）。
- **验收 / 测试**: spec 收窄段更新即可；两处注释落点。CLI 无测试基建要求。
- **来源**: review-scope-context-usage / round 1

### ctx-usage/C-orch-2 [P2] 「上次请求 / 预估」映射三处各写一遍

- **维度**: C-orch（跨端一致性）
- **文件**: `apps/desktop/src/main/services/chat-prompt-tokens.service.ts:30`（必填签名）、`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:73`（取响应类型）、`apps/mobile/src/services/chat-prompt-tokens.service.ts:35`（可选签名）
- **问题**:
  - 同语义**三份拷贝**，签名已经在漂移（desktop main 必填 / mobile 可选 / renderer 取响应类型）。
  - 改一处忘另两处，就会出现**主进程标签与 chip 打架**。
- **改法**:
  1. core 新增 `packages/core/src/infra/tokenizer/logic/format-token-source-label.ts`，导出 `formatTokenSourceLabel(source: 'api' | 'local' | undefined): string`——未知一律「预估」。
  2. 经 `infra/tokenizer/index.ts` 与 `public/provider.ts` 导出，**同步更新** `packages/core/test/package-exports/snapshots/public-provider-allowlist.json`（新增导出名，否则快照测试会红）。
  3. 三处改为引用该函数，删掉本地三元表达式与重复的 JSDoc。
  4. mobile 侧 `apps/mobile/__tests__/chat-prompt-tokens.test.ts` 里的 jest mock **同步**（mock 的是 core provider 模块，不同步会解不出新符号）。
  5. **顺手项（与 `full/A-3` 同批改）**：`apps/desktop/src/main/services/chat-prompt-tokens.service.ts:27` 与 `apps/mobile/src/services/chat-prompt-tokens.service.ts:32` 的 JSDoc 里仍写着「与分词器维度标签（`formatCounterKindLabel`，api/heuristic 都显示「自动」）」。这两个文件**本次本来就要改**（第 3 步），顺手把那一段 JSDoc 一起收掉——本 diff 已经摘掉 `formatCounterKindLabel` 的**最后三个生产调用点**（desktop main service、SessionDetailDrawer、mobile service），它**仅剩导出 + 1 条 mobile 测试断言**（见 `full/A-3` 与 Spec deviations #11 / #18），留着会一起过时。
     （同类「显式具名再导出闭环」漏网点见 `metrics/C-orch-1` 改法 #2 与 `ctx-usage/C-4`；后两者已在 v3 校对轮去重为同一处改动。）
     - ⚠️ **v4 收口轮：补两条实查结论，堵住「按对称性去找不存在的 mock」**。改法 #4 说「mobile 侧 jest mock **同步**」，执行方很容易顺手把 desktop 也找一个 provider mock 改一遍——**desktop 侧没有**：
       1. **`apps/desktop/test/chat-prompt-tokens.test.ts` 直接用真模块、无 provider mock，改法 #3 落地后 desktop 侧无需任何同步动作。**（本仓 desktop 测试不在 jest 环境内，core provider 符号是直连的。）**执行方不要去找这个不存在的 mock。**
       2. **`apps/mobile/__tests__/chat-prompt-tokens.test.ts` 的 `serializeToolsForTokenCount` mock（`:14` 声明、`:23-24` 接进 provider mock、`:84` 的 `mockClear`）会随 `full/D-1` 变成死 mock**（`full/D-1` 删掉双端 UI 读口那两处恒等空串拼接之后，mock 的目标已无人调用）。**与 `full/D-1` 同批清掉这三处**，别留着让 lint 报 unused、或让下一个人以为 UI 侧还在拼 tools。**注意别把这个 provider mock 整个删掉**——同一份 mock 里的 `formatCounterKindLabel`（`:25`）仍被 `:230-233` 的 T-S7 断言使用（见 Open questions #16）。
- **验收 / 测试**:
  - desktop `test/chat-prompt-tokens.test.ts` 的 T-T9 / T-T9b 与 mobile 四条标签断言**保持不变**（本次是纯重构，不改行为）。
  - 可加一条 core 单测钉住 `undefined → "预估"`。
- **来源**: review-scope-context-usage / round 1

### ctx-usage/C-orch-1 [P2] `CreatePersistentStateOptions.sessionKkv` 是死参数（「注入」从未发生）

- **维度**: C-orch（接口诚实性 / 文档诚实性）
- **文件**: `packages/core/src/service/persistent-state/create-persistent-state.ts:14-37`；③ spec `:39`（「工厂注入 `createPersistentState(conn, options?)`」）
- **问题**:
  - 全仓 **9 个调用文件 / 10 条调用语句**（round 2 实查订正，round 1 写的「7 处」有误），**全部单参**，永远走 `options?.sessionKkv ?? createSessionKkvService(conn)` 的**右分支**。清单（以实查为准）：
    - 生产 3 处：`apps/cli/src/runtime.ts:185`、`apps/desktop/src/main/runtime/create-desktop-runtime.ts:72`、`apps/mobile/src/runtime/create-mobile-runtime.ts:64`
    - 测试 6 个文件 / 7 条：`apps/cli/test/helpers.ts:255`、`packages/core/test/helpers/novel-master.ts:67`、`packages/core/test/helpers/sql-counting-connection.ts:203`、`packages/core/test/persistent/multi-consumer-contract.test.ts:17` 与 `:18`（同一文件两条）、`packages/core/test/provider/provider-model.service.test.ts:272`、`packages/core/test/session-copy.perf.ts:61`
  - 留一个**永不生效**的公开选项属「同语义多信号」，还让 ③ spec 的「注入」措辞失真。**结论不变：注入从未发生。**
- **改法**（**取方案 1：删死参数**）:
  1. 删除 `CreatePersistentStateOptions` 接口与 `createPersistentState` 的第二参。
  2. `DefaultPersistentState` 构造器**内部自建** `createSessionKkvService(conn)`（语义零变化，三端装配继续零改动）。
  3. ③ spec 变更点表第 7 行（第 `:39` 段）措辞由「**注入**」改为「**工厂自建**」。
- **验收 / 测试**: `npm run typecheck` 过；`packages/core/test/persistent/multi-consumer-contract.test.ts` 仍绿。
- **来源**: review-scope-context-usage / round 1

### ctx-usage/C-4 [P2] 维度 C｜desktop 具名再导出漏点（与 `metrics/C-orch-1` 改法 #2 是同一处改动）

- **维度**: C（跨端一致性 / 编译闭环）
- **文件**: `apps/desktop/shared/logic/format.ts:9-21`（**归属说明**：本文件那处改动由 `metrics/C-orch-1` 改法 #2 执行，本条不再自己动它；本条自己负责的是下面改法 #2 / #3 的**另两个 barrel 核查**）
- **问题**:
  - 该文件是 desktop renderer 对 `@novel-master/core/format` 的**显式具名再导出**，文件头第 3 行**明文写着「禁止 `export *`」**。`metrics/C-orch-1` 新增的 `composeStreamTokens` / `reanchorStreamTokenBase` 只从 `packages/core/src/public/format.ts` 转出是**不够的**——不加进这个文件，desktop 侧（`apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:26`、`apps/desktop/renderer/hooks/stream-token-estimator.ts:19`，都是 `from "@shared/logic/format"`）根本 import 不到。
  - 这与 `ctx-usage/C-orch-2` 属于同一类「再导出闭环」漏网点：新增导出只改了上游 barrel、没改下游 barrel，编译期才炸。三条一起核，别只盯一条。
- **改法**:
  1. ⚠️ **v3 校对轮：改法 #1 收敛为一句，不再重复描述同一处改动**。round 2 的 #1 与 #2 说的**是同一处改动**（把 `composeStreamTokens` / `reanchorStreamTokenBase` 加进 `apps/desktop/shared/logic/format.ts:9-21` 的具名再导出），挂在两个条目下会让执行方以为要改两遍、或以为两个 scope 各改一次（并行分支上就是一次冲突）。
     - **本条即 `metrics/C-orch-1` 改法 #2，同一处改动，归属 metrics scope；本 scope 执行方不要动 `apps/desktop/shared/logic/format.ts`**。要改就去 `metrics/C-orch-1` 改法 #2 看落点与验收（那里已写死「**追加到现有列表末尾，不重排既有条目**」——该列表是历史顺序，不是字母序）。
  2. **同批核一遍 `apps/mobile` 是否有同类具名 barrel**（已实查，结论可直接采纳）：**mobile 没有**——`apps/mobile` 全仓直接 `import { ... } from '@novel-master/core/format'`（见 `stream-token-estimator.ts:31-34`），中间没有再导出层，所以 mobile 侧不需要同步动作。写在这里是为了让执行方不用再排查一轮。**这是本条独立于 metrics 的价值，留存。**
  3. 若 C-orch-2 的 `formatTokenSourceLabel` 走 `public/provider.ts` 导出，也一并核 `apps/desktop/shared/logic/provider.ts` 有没有对应的具名再导出需要加。**这也是本条独立于 metrics 的价值，留存。**
  - 顺带说明本条与 C-orch-2 的关系：三者（`metrics/C-orch-1` 改法 #2、本条 #2、本条 #3）属**同一类「再导出闭环」漏网点**——新增导出只改了上游 barrel、没改下游 barrel，编译期才炸。**但落点是三个不同文件**，请一次核全，别只盯一处。
- **验收 / 测试**:
  - desktop `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` **无新增报错**。
  - mobile / desktop 本轮改动的文件里，所有 import 的符号**全部解析得到**（`npm run typecheck` 过）。
  - 改法 #2 / #3 的两个 barrel 核查各自留一行结论（mobile 无同类 barrel = 无需动作；`shared/logic/provider.ts` 若 `formatTokenSourceLabel` 需转出则已加），**别让这两项以「应该没问题」的口头形式消失**——它们是本条在 v3 校对轮去重之后**仅剩的独立价值**。
- **来源**: review-scope-context-usage / round 2

### ctx-usage/D-1 [P2] mock 运行日志措辞与实现自相矛盾

- **维度**: D（mock / 取证工具）
- **文件**: `scripts/mock-openai-server.mjs:521`（请求日志模板；头注释在 `:32-38`、`:70`）
- **问题**:
  - 每条请求日志仍打印「近似 token=字符数÷3.35」，而实现（`approxTokens` `:186-203`）已经是「**CJK≈1 词元/字 + 其余÷3.35**」。
  - 做验收的人读日志会得到**相反结论**。
- **改法**: 日志模板改为
  `prompt_tokens≈${promptTokens}（CJK≈1 词元/字，其余字符÷${CHARS_PER_TOKEN}；非真实 tokenizer）`
  与 `approxTokens` 的 JSDoc 措辞保持一致。
- **验收 / 测试**: 起 mock 发一次请求，肉眼核对措辞。`scripts/` 不在任何 test runner 内，**无自动化测试要求**。
- **来源**: review-scope-context-usage / round 1

### ctx-usage/D-2 [P2] `isCjkCodePoint` 漏谚文与半角片假名

- **维度**: D（mock / 取证工具）
- **文件**: `scripts/mock-openai-server.mjs:173-182`
- **问题**:
  - 漏 `0xAC00–0xD7A3`（谚文，真 tokenizer 约 0.5~1 词元/字）、`0xFF61–0xFF9F`（半角片假名）、增补平面汉字（`0x20000–0x3FFFF`）。
  - 这些字符掉进 `other` 被 ÷3.35，与「CJK 感知」的宣称不符。
- **改法**: 补三段判断
  - `(cp >= 0xac00 && cp <= 0xd7a3)`（谚文音节）
  - `(cp >= 0xff61 && cp <= 0xff9f)`（半角片假名）
  - `(cp >= 0x20000 && cp <= 0x3ffff)`（增补平面汉字）
  并把函数上方的注释改成与**实际区间一一对应**的说明（现在注释与代码区间已不同步）。
- **验收 / 测试**: 起 mock 发一条含谚文的混排请求，核对量级。**无自动化测试要求**。
- **来源**: review-scope-context-usage / round 1

### ctx-usage/G-1 [P2] 「runner → trigger → 读口」接线无测试（删掉传参不会变红）

- **维度**: G（测试覆盖）
- **文件**: `packages/core/test/agent/agent-runner-token-cache.test.ts`（新增用例），相关实现 `packages/core/src/service/agent/impl/agent-runner.ts:448-455`（`tools` 与 `sessionKkv` 两行）
- **问题**:
  - `serialize-tools-for-token-count.test.ts` / `mobile-prompt-token-counter.test.ts` / `token-ratio-trigger.test.ts` 都是**直接调 helper/driver 或手工构造 context**，没有一条走**真实链路**。
  - 把 `agent-runner.ts` 里的 `tools` / `sessionKkv` 两行**删掉也不会有测试变红**。
- **改法**: 补端到端用例：
  1. 装配真实 runner（注入 `sessionKkv`）+ `TokenRatioConditionTrigger`（阈值设成**必触发**），跑一轮 completed；
  2. `clearAll()` 模拟重启后再跑一轮，断言第二轮用的是 **KKV 里的 api 值**；
  3. 再补一条「把某个 tool 的 description 换成极长（≥10KB）→ 第二轮**本地档** `tokenCount` 明显变大」，证明 `tools` 确实进了压缩评估的估算串。
- **验收 / 测试**: 新用例必须**能捕获 `agent-runner.ts` 传参被删**——自验方式：临时注释掉 `:453` 或 `:454` 任一行，新用例应当变红。
- **来源**: review-scope-context-usage / round 1

---

## `full/*`（review-scope-full，v3 校对轮新增，全部 P2）

> 这 8 条来自第 3 轮**全量** readonly 评审（`review-scope-full`），覆盖 ① + ② + ③ + ④ 四份业务文档与双端实现的一致性。**先量后改**的两条（`full/E-1`、`full/E-2`）**不预先改实现**，只登记事实 + 加 QA 门限 + 给条件改法。

### full/A-2 [P2] 维度 A｜③ 目录里「14 个失效挂点」不止 `spec.md:26` 一处，PRD 也在说这个错数

- **维度**: A（文档一致性 / 口径一致性）
- **文件**（**全量实查命中 4 处**，round 1 的 deviations #16 只盯了 spec 的 3 处，**漏了 PRD**）:
  | # | 落点 | 现状措辞 |
  |---|---|---|
  | 1 | ③ `bugs/context-usage-caliber-unify/spec.md:26` | 变更点表 #6 标题「14 个失效挂点（…枚举…）」 |
  | 2 | ③ `bugs/context-usage-caliber-unify/spec.md:39` | 详细说明「双删（热层 + KKV 行），**14 个挂点**全量落地」 |
  | 3 | ③ `bugs/context-usage-caliber-unify/spec.md:65` | 风险段「靠 **14 个失效挂点** + `savedModelId` 指纹 + 会话删除整表清兜底」 |
  | 4 | ③ `bugs/context-usage-caliber-unify/prd.md:49` | 验收清单「**14 个失效挂点**（至少覆盖 message.delete / rollback / 置位 / compaction / persistent-state）」 |
  - ⚠️ 另有评审报出 `prd.md:35` 也含该措辞，**本轮 grep 未命中**（可能是评审时的行号偏移或上下文不同）。执行方请**按目录全量清**而不是按这 4 个行号改——落点口径写成「**该目录下所有『14 个』措辞全部改**」，这样即使还有第 5 处也不会漏。
- **问题**:
  - 同一个错数在**四处**重复出现，而 deviations #16 只登记了 spec 的 3 处。执行方按 #16 改完 spec 三处就收工，**PRD 的验收清单里仍写着「14 个」**——验收人去读 PRD 会以为「14 个」是对的。
  - PRD `:49` 的枚举还**缺 `message.append`**（`ctx-usage/A-2` 落地后新增的挂点），而 ③PRD 把「消息增删改」写成硬验收项——**枚举不全 = 硬验收项在 PRD 上没被认领**。
- **改法**:
  1. **spec 三处（`:26` / `:39` / `:65`）统一按 deviations #16 的口径写**：「**18 个调用点 / 15 个公开入口方法**」。`spec.md:26` 的变更点表 #6 括号枚举同步补 `message.service ×10`（含 `append`）与 `session.service.updateSessionAgentConfig`（A-1 新增）。
  2. **PRD 侧建议不写死数字**，改为「失效挂点覆盖消息增删改 / 置位 / 回滚 / 压缩 / 导入 / 切模型与 Agent / run 失败（**枚举见 spec 变更点表 #6**）」。
     - 理由：PRD 是**验收面**不是**实现面**，数字在 spec 里改一次就要跟着改一次，**已经错了三轮**（14 → 15 → 16 → 18）。PRD 引用 spec 的枚举，既不会错，也不会因为 A-1/A-2 落地而再次失效。
     - PRD `:49` 的「至少覆盖 message.delete / rollback / 置位 / compaction / persistent-state」**同步补 `message.append`**（现名 `message.append`，与 spec 枚举同名）。
- **验收 / 测试**:
  - `git grep -n "14 个" -- docs/Iterations/mobile-perf-2026-09/bugs/context-usage-caliber-unify` **无输出**。
  - PRD `:49` 的枚举里出现 `message.append`；spec `:26` 枚举里出现 `session.service.updateSessionAgentConfig` 与 `message.service ×10`。
- **来源**: review-scope-full / round 3（闭合 Spec deviations #17）

### full/A-3 [P2] 维度 A｜③ spec `:51` / `:52` 两句在本 diff 之后已站不住

- **维度**: A（文档一致性）
- **文件**: ③ `bugs/context-usage-caliber-unify/spec.md:52`（`formatCounterKindLabel`）、同文件 `:51`（label 拼接落点）
- **问题**:
  - **③ spec `:52`** 写「**`formatCounterKindLabel` 保持不动**：它是『用哪个分词器』的维度标签（api/heuristic 都显示「自动」），与『值从哪来』是两义，不合并」——「保持不动」这句在**本 diff 落地后不再成立**：本 diff 摘掉了它的**最后三个生产调用点**（desktop main service、`SessionDetailDrawer`、mobile service），实查现状**仅剩导出 + 1 条 mobile 测试断言**（`apps/mobile/__tests__/chat-prompt-tokens.test.ts:230-233`，另有两处 JSDoc 提及）。「保持不动」会让人以为它还在生产链路上服务某个标签。
  - **③ spec `:51`** 列的文案落点写「desktop main 的 label 拼接」——⚠️ **v4 收口轮实查：这句话描述的落点在本 diff 之后已不存在**。round 3 把它写成「唯一带 `formatCounterKindLabel` 的 desktop main 函数是 `loadChatPromptTokenLabelResilient`（`apps/desktop/src/main/services/chat-prompt-tokens.service.ts:211-217`），它带 `@deprecated` 标记」——**这不成立**：
    - **desktop main 侧已无任何 `formatCounterKindLabel` 调用点**，只剩 `chat-prompt-tokens.service.ts:27` 一处**提及该符号的过期 JSDoc**（由 `ctx-usage/C-orch-2` 改法 #5 收掉）。
    - `loadChatPromptTokenLabelResilient` 走的是 **`formatChatTokenStatsLabel` → `formatTokenSourceLabel`**，**与 `formatCounterKindLabel` 无关**；把它当作该符号的落点是指错了符号。
    - 生产路径（`ipc/handlers/prompt.ts` → `SessionDetailDrawer` 自带 `tokenCountLabel`）同样不经过它。
- **改法**:
  1. ③ spec `:52` 补一句：「本轮摘掉其**最后三个生产调用点**；此后**仅剩导出 + 1 条测试**；是否本轮删净见 **CR Open questions #16**。」（⚠️ **v4 收口轮**：必须写编号，round 3 写的是无编号的「见 CR Open questions」——详见 `full2/C-1`。）
  2. ③ spec `:51` 补一句（**v4 收口轮整句改写，round 3 那版是假陈述**）：「desktop main 侧**已无任何 `formatCounterKindLabel` 调用点**，只剩 `chat-prompt-tokens.service.ts:27` 一处提及该符号的**过期 JSDoc**（由 `ctx-usage/C-orch-2` 改法 #5 收掉）；本 spec 原述『desktop main 的 label 拼接』落点在本 diff 后**已不存在**。」
  3. 这两处与 `ctx-usage/C-orch-2` 改法 #5（收掉两处 service 里提及 `formatCounterKindLabel` 的 JSDoc）**同批改**，别只改一边。
- **验收 / 测试**:
  - ③ spec `:51` / `:52` 两句补齐后，文档与实查一致：`git grep -n "formatCounterKindLabel" -- apps packages` 的命中只剩导出链（`infra/tokenizer/index.ts:31`、`public/provider.ts:157`、allowlist 快照）与那 1 条 mobile 测试，**无生产调用点**。
  - Spec deviations **#11 由「一致」改判为 open → 由 `ctx-usage/C-orch-2` + 本条闭合**（见下方 deviations 表）。
- **来源**: review-scope-full / round 3（闭合 Spec deviations #18 / #21）

### full/A-4 [P2] 维度 A｜① spec 采样器用例条数写错（14 / 12 → 17）

- **维度**: A（文档一致性）
- **文件**: ① `bugs/stream-multi-step-rate-freeze/spec.md:43`（「既有 **14 条** core 采样器用例全绿」）、同文件 `:56`（「新增 3 类，**合计 12 条**采样器用例全绿」）
- **问题**:
  - **本轮实跑**：`packages/core/test/domain/format/sliding-token-rate.test.ts` → `# tests 17 / # pass 17 / # fail 0`。
  - `:56` 的「新增 3 类，合计 12 条」**与自己的算术矛盾**（base 9 + 3 = 12？可 `:43` 写的是「既有 14 条」）——同一份文档两个数，谁也不对。真实关系是 **base 14 + 本轮 +3 = 17**。
  - 后果：执行方按 `:56` 以为「只新增了 3 条、共 12 条」，**不会去核对 base 是 14 还是 9**；而 ① spec 的「既有 N 条全绿」正是 ③ 侧 / 复验侧判断「测试面有没有被悄悄删掉」的基准数，**基准错了这个判断就废了**。
- **改法**:
  1. `:43` 「既有 14 条」改为「**17 条**（本轮 +3）」。
     - 表述上区分清楚：「既有」= 本轮**之前**的基线数是 14，**本轮新增 3 类后文件内共 17 条**。不要写成「既有 17 条」——那会把基线也改掉。
  2. `:56` 「合计 12 条」改为「**合计 17 条**」，并把前半句的「新增 3 类」保留（它是对的）。
- **验收 / 测试**:
  - `cd packages/core && npx tsx --test test/domain/format/sliding-token-rate.test.ts` → `# tests 17 / # pass 17 / # fail 0`，与文档两处数字一致。
  - Spec deviations **#13 由「一致」改判为「已闭合（执行时改上述两处）」**（见下方 deviations 表）——它原本判「一致」是**误判**：当时按「14 + 3 ≠ 17」反推出了「12」这个第三个数。
- **来源**: review-scope-full / round 3

### full/D-1 [P2] 维度 D｜双端 UI 读口拼 `serializeToolsForTokenCount(undefined)` 是恒等空串的误导性死代码

- **维度**: D（误导性代码 / 口径可读性）
- **文件**: `apps/desktop/src/main/services/chat-prompt-tokens.service.ts:109-111`、`apps/mobile/src/services/chat-prompt-tokens.service.ts:77-79`（两处连同各自的 `serializeToolsForTokenCount` import：desktop `:13`、mobile `:19`）
- **问题**:
  - `serializeToolsForTokenCount(undefined)` **恒返回 `""`**（helper 对 `undefined` / `[]` 都返空串，已有单测 `serialize-tools-for-token-count.test.ts:49-50` 钉住）。所以 `+ serializeToolsForTokenCount(undefined)` 是**纯空串拼接**，一个字符都不加。
  - 但它**看起来**像「UI 侧也补了 tools 段」，与**紧邻的上一行注释**（「UI 读口拿不到 tools 定义（`session-prompt-input` 不产 tools）：显式传 undefined，本地预估仍不含 tools 段」）**自相矛盾**——注释说「没有 tools」，代码说「拼了 tools（虽然拼出来是空）」。下一个人读到这里会得出「UI 口径已经是全量的了」这个**相反结论**，而这恰恰是 `ctx-usage/C-1` 与 ③ spec `:46` 登记的口径差。
  - 同一句「显式传 undefined，UI 预估不含 tools」的口径注释目前**只在这两个生产文件里各有一份**（desktop `:106-108`、mobile `:74-76`），而**这两份正好就是带着假拼接的那两份**——改注释和删拼接是同一处，不要拆成两个 PR。
- **改法**:
  1. **两处都删掉 `+ serializeToolsForTokenCount(undefined)` 这个拼接**，以及各自文件里已无用的 `serializeToolsForTokenCount` import（desktop `:13`、mobile `:19`；删前 `git grep` 确认该符号在**代码**里无其他引用）。
     - ⚠️ **v4 收口轮：grep 措辞订正**。round 3 写的是「确认该符号在该文件无其他引用」——**这句会让执行方误判「import 不能删」**：实查 desktop `:108` / mobile `:76` 的**注释**里**各还有一处**提及 `serializeToolsForTokenCount`（「显式传 undefined…」那句口径注释）。**注释提及不算引用**，import 照删；那两处注释由改法 #2 一并改写，**不影响删 import**。执行方请按「**代码**里无其他引用」判断。
  2. 注释改写为一句写死的口径：「**此处恒不拼 tools（拿不到定义）**；口径差是已登记收窄（见 ③ spec `:46`），**不要以为拼了就是全量**」。
  3. **core 侧 `packages/core/src/infra/tokenizer/logic/count-prompt-llm-input.ts:80-82` 的拼接保留不动**——那是压缩评估路径的真口径（`ctx-usage/A-2` 改法 #3 的 (i) 就靠它成立）。
  4. `packages/core/src/infra/tokenizer/logic/serialize-tools-for-token-count.ts` 的头注释补一句：「**恒不传 tools 的调用方不应写这行拼接**——它恒为空串，写上只会误导读者以为口径已覆盖 tools。」
- **验收 / 测试**:
  - `git grep -n "serializeToolsForTokenCount" -- apps/desktop/src apps/mobile/src` 只剩 import 链之外**零处** `undefined` 拼接（helper 定义 / core 三处真拼接 / RN+node driver / provider 导出不受影响）。
  - 双端 `chat-prompt-tokens` 测试（desktop `test/chat-prompt-tokens.test.ts`、mobile `apps/mobile/__tests__/chat-prompt-tokens.test.ts`）**断言值不变**——因为删的是恒空串，行为零变化。这是本条**不改行为**的保证。
  - `npm run typecheck` 过（import 删干净）。
- **来源**: review-scope-full / round 3

### full/E-1 [P2] 维度 E｜性能：尾窗读值在**每 delta** 路径上，且 Hermes 真机未测

- **维度**: E（性能 / 实测口径）
- **文件**: ② `features/stream-live-token-estimator/spec.md:48`（「单次 push（含读值）：Node 稳态峰值 0.92ms / 均摊 0.47ms…」）、④ `features/stream-metrics-tokens/spec.md:75`（「性能：中文单次 push（含读值）Node 稳态峰值 0.92ms、均摊 0.47ms…」）、实测路径 `apps/mobile/src/services/session-stream-unit.ts:1052`（`ingestDelta`）与 `:1075`（末尾的读值调用）
  - ⚠️ **`full2/E-1` 回填（2026-09-26，执行后主代理实测）**：本条覆盖面**不止 mobile —— desktop 侧同样是每 delta 读值**。desktop 落点（`71692b11` 实测）：`apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:202`（读值合成 `composeStreamTokens`）、`:299`（重锚 `reanchorStreamTokenBase`）；delta 入口在上游 `apps/desktop/renderer/hooks/useAgentStream.ts:98` / `:107`（`applyTextDelta` / `applyThinkingDelta`）；hook 内 `setInterval(() => setTick(t => t + 1), 250)` 在 `useAgentStreamMetrics.ts:244`——**它只节流渲染 tick，不节流每 delta 的读值**（同一事实的 desktop 版本）。
  - ⚠️ **行号漂移订正**：mobile 侧因本轮改动漂移，`recomputeCompletionTokens` 定义现为 `session-stream-unit.ts:641`、`ingestDelta` 末尾的读值调用现为 `:1107`（原 `:612` / `:1075` 是 base 行号）。
  - **条件改法 #3 若触发，desktop 侧同条件同改**（对齐 hook 内那个 250ms tick，而不是 mobile 的 `SESSION_STREAM_APPLY_INTERVAL_MS`——后者是 mobile 专有常量，desktop 全仓零命中）。
- **问题**:
  - **事实 1：指标读值没有节流**。实查 `session-stream-unit.ts:1052` 的 `ingestDelta` 在**每一条 delta** 末尾都调 `this.recomputeCompletionTokens()`（`:1075`）。所谓「32ms 合批」（`SESSION_STREAM_INGRESS_COALESCE_MS = 32`，`:68`）只作用于 **webview 投喂**（投影快照推给渲染层的那一段），**指标读值本身每 delta 走一次完整 `tokens` getter**（含尾窗 re-encode）。所以 0.92ms / 0.47ms 那个数是「**单次** push + 读值」的口径，**不是每渲染帧的口径**——一条 delta 一个字符的慢速流，1 秒就是 20–50 次读值。
  - **事实 2：实测环境是 Node v22，不是真机**。② spec `:41` / ④ spec `:73` 的表头都写着「Node v22 + js-tiktoken 1.0.21 + cl100k_base，本次实跑」。真机是 **Hermes**（RN 的 JS 引擎），js-tiktoken 在 Hermes 上是**纯 JS 路径**，性能与 V8 有量级差异。**0.92ms 这个数字在真机上没有被验证过**，而它正是「不在 delta 路径上」这个结论的全部依据。
  - 两条合起来的后果：如果 Hermes 上单次读值是 V8 的 5–10 倍（4.7–9.2ms），那么**每 delta 都读**在慢速中文流上就是**每字符 5–9ms 的主线程占用**——足以造成掉帧。**当前没有任何数据能排除这件事**，也没有任何门限会拦住它。
- **改法**（**三步，先量后改，不预先改实现**）:
  1. **② spec `:48` 与 ④ spec `:75` 的实测段加限定**（**本轮唯一确定要做的动作**）：在两处性能数字后补「**以上为 Node v22 桌面口径；Hermes 真机未测，且读值在每 delta 路径（`ingestDelta` 无节流），非每渲染帧**」。
     - 这一句是**给未来的读者**的：它把「0.92ms 很小」这个会误导人的结论，替换成「0.92ms 是在一个我们没测过的引擎上、单次调用的口径」。
  2. **QA 表加一行**（见下方「合并后 QA」）：`metrics/E-1`｜Hermes 真机以真流跑 ≥800 字中文输出，记录 per-delta 耗时 **p50 / p95** 与掉帧数。
  3. **条件改法（仅当第 2 步超门限才做）**：若 **p95 > 8ms**（门限暂定，见 Open questions #15）或出现可见掉帧 → 把**估算器读值**从「每 delta」降到「**每渲染节拍**」（对齐 `SESSION_STREAM_APPLY_INTERVAL_MS` 的 64ms），而 **`push()` 与字符累加仍每 delta 走**。
     - 这么切是安全的：token 值的粒度变成 64ms，而速率窗是 2.5s——**64ms 相对 2.5s 完全可忽略**（每 2.5s 窗内少 38 个采样点，速率分差远小于显示精度）。
     - `sampleRate()` 处补注释写明这条依据：「**token 值粒度 64ms，相对 2.5s 速率窗可忽略**」，免得下一个人以为这是「精度退化」而去修。
- **验收 / 测试**:
  - ② spec `:48` 与 ④ spec `:75` 各自带上上面那句限定（逐条对读，别只改一处）。
  - 真机 QA 出 p50 / p95 数字并回报；**先不写进 spec**，等第 3 步的判定有结论后再一次性补（避免「测了一半就把中间数字写进 spec」）。
- **来源**: review-scope-full / round 3（闭合 Spec deviations #19）

### full/E-2 [P2] 维度 E｜性能：tools 段每 step 重新序列化（未登记成本）

- **维度**: E（性能 / 读放大）
- **文件**: ③ `bugs/context-usage-caliber-unify/spec.md:67`（「**读放大**：热层保证常态零 IO…」段）、成本落点 `packages/core/src/infra/tokenizer/logic/serialize-tools-for-token-count.ts` + `packages/core/src/domain/compaction-conditions/triggers/token-ratio.trigger.ts:66-68` + `packages/core/src/service/agent/impl/agent-runner.ts:271` 附近
- **问题**:
  - **事实**：`serializeToolsForTokenCount` 每次调用都重新 `map` 一遍 tools 再 `JSON.stringify` 一遍**全量 schema**（`name` / `description` / `inputSchema`）。压缩评估在 `agent-runner` 的 step 循环内**每 step 一次**，一个 5 step 的 run 就是 5 次全量 stringify——而 tools schema 在整个 run 内**是不变的**。
  - **成本边界要说准**（免得执行方高估）：**api 命中时不重算**（`token-ratio.trigger.ts` 拿到 KKV 里的 api 值就走另一条路，不调本地估算）。所以成本**只落在 miss 路径**上——换模型后第一次 run、首次 run、以及 `ctx-usage/A-2` 落地后**「append 清了旧值」的那段 run 期间**（A-2 改法 #3 (ii) 明确说整个 run 走 heuristic + 0.85 安全垫）。**A-2 一落地，这条路径的命中率会上升**，所以它是**本轮新引入的读放大**，不是纯既有成本。
  - ③ spec `:67` 的「读放大」段只登记了「热层空且 KKV 无行时多一次主键 SELECT」，**没提 tools 序列化**——漏登记。
- **改法**（**同样先登记、先量，不预先改实现**）:
  1. ③ spec `:67`「读放大」段补一条：「miss 路径每 step 多一次 tools 全量 `JSON.stringify` + 一次额外编码；**api 命中零成本**」。
  2. **QA 表加一行**（见下方「合并后 QA」）：`ctx-usage/E-2`｜真机跑 ≥5 step 的多工具 run，确认无明显掉帧。
  3. **条件改法（仅当第 2 步显示掉帧才做）**：在 `agent-runner.ts:271` 附近按 **run 级**缓存序列化结果（不是全局缓存——tools 会随 Agent 配置变）。
     - 缓存前提写进 helper 注释：「**同一 run 内 tools 定义不变，故同输入必得同串**」。这句是缓存正确性的唯一依据，必须写下来，否则下一个人会把它改成跨 run 缓存、在换 Agent 的 run 里拿到旧 schema。
- **验收 / 测试**:
  - ③ spec `:67` 补上那条（与 E-1 的 `:48` / `:75` 限定一起对读，三处性能口径一起收）。
  - 真机 QA 回报 5 step 多工具 run 的掉帧情况；**结论出来前不动 `agent-runner.ts`**。
- **来源**: review-scope-full / round 3（闭合 Spec deviations #20）

### full/I-1 [P2] 维度 I｜可观测性：两条降级路径零日志

- **维度**: I（可观测性）
- **文件**: `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:203-216`（估算器工厂失败）、`packages/core/src/infra/tokenizer/logic/incremental-token-counter.ts`（读值路径 encode 失败）
- **问题**:
  - **路径 1：desktop 工厂失败是空 catch**。`:211-215` 的 `} catch { text = null; thinking = null; }` **不打任何日志**。而 mobile 侧同名分支（`apps/mobile/src/services/session-stream-estimator.ts` 的 `getOrCreateEncoding` 失败分支 `:100-106`）**有 `console.warn`**（`js-tiktoken encoding init failed, fallback to heuristic`）。**双端不对称**：mobile 编码构造失败会留痕，desktop 估算器工厂失败**彻底静默**——真机上 desktop 指标条「一直是启发式数字」这件事，**没有任何信号**。
  - **路径 2：读值路径 encode 失败完全静默**。`incremental-token-counter.ts` 的读值分支（`:225` 附近 `tailTokens = encodePiece(tail)`）失败时只是保持上一次读值，**一行日志都没有**。`metrics/B-1` 只给**固化路径**钉了告警（改法 #3 的那个「已告警」标志），**读值路径的失败至今零信号**——所以「尾窗读不出来、指标条卡在某个数上」这类现象无法从日志定位。
  - 附带的诊断字段口径问题：`metrics/B-1` 改法 #2 的 `unencodableChars` 若把两条路径都计进去，一个字段就同时表达「丢了字」与「暂时读不出」两件事，排查时无法区分（v3 校对轮已在 B-1 改法 #6 与验收里写死「只统计固化路径」）。
- **改法**:
  1. `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:211` 的空 catch 补一条**中文 `console.warn`**，措辞与 mobile 侧对齐：「估算器构造失败，回退启发式（不阻断指标条）」并带上 `err`。
     - 只补日志、**不改变回退行为**（仍然是 `text = null; thinking = null;`）。
  2. `metrics/B-1` 改法 #3 的告警标志改为**按路径分开**（固化一个、读值一个），**读值路径首次失败也 `console.warn` 一次**，文案写「**尾窗不可编码，保持上一次读值**」。
  3. `unencodableChars` **只统计固化路径**（`metrics/B-1` 改法 #6 与验收已写死），读值路径的失败只走告警、不进计数。
  4. `IncrementalTokenCounter` 公开接口同步加 `readonly unencodableChars: number`（`metrics/B-1` 改法 #6）。该接口经 `public/format.ts` + `apps/desktop/shared/logic/format.ts` **双层再导出**，**但导出面无需改**（新成员不是新导出名）。
- **验收 / 测试**:
  - desktop hook 测试里给一个抛错的工厂，断言 `console.warn` 被调用一次且文案含「回退启发式」；**第二次抛错不再打**（去重标志）。
  - core 计数器测试里让**读值路径** encode 抛错，断言 `console.warn` 被调用一次、文案含「保持上一次读值」，且 `unencodableChars` **不变**（钉住「只统计固化路径」）。
- **来源**: review-scope-full / round 3

### full/K-1 [P2] 维度 K｜交付面：`CHANGELOG.md` Unreleased 未同步

- **维度**: K（交付 / 用户可见变更登记）
- **文件**: `CHANGELOG.md` 的 `## [Unreleased]` 段（`### 变更` / `### 修复` 两组）
- **问题**:
  - 本 diff 落地后有 **3 条用户可见的行为变更**（多步速率不冻结、实时 token 估算升级、上下文占用口径统一），`CHANGELOG.md` 的 Unreleased **一条都没记**。
  - Unreleased 里已有一条「**会话指标条改用 token 与实时速率**」，其中「**真值到达后自动校正跳转**」的措辞**已被 ①②③ 推翻**（① 把「usage 后 heuristic 不再回写」那道门拆了，现在是「基线 + 增量」持续叠加，不是「到达后跳转」）。历史记录**保留原意**（那是当时的事实），但**要加一行现行口径**，否则读 changelog 的人会以为指标还是「到达即跳」。
- **改法**（按 `novel-master-changelog` skill 口径，Unreleased 补 3 条）:
  1. **修复（双端）**：多步 run 工具步骤无文本时指标条不再冻结在上一条 usage 累计值上——真值改为「基线 + 后续增量」，跨静默的采样窗在折叠处重 seed，终态速率段照常给出。
  2. **变更（双端）**：实时 token 估算由「字符 ÷ 3.35」升级为真 BPE 尾窗增量计数（js-tiktoken），中文 / 英文误差降到 1% / 0% 量级；非 tiktoken 家族与桌面 o200k 模型仍按 cl100k 近似。
  3. **修复（双端）**：上下文占用口径统一——API `prompt_tokens` 落 session KKV、重启同口径；标签拆「上次请求 / 预估」两态；切模型 / 切 Agent / 消息增删改 / 压缩 / 回滚后不再残留旧占用。
  4. 既有「会话指标条改用 token 与实时速率」条目**历史措辞保留**，在其后加一行：「**现行口径（stream-metrics-native 起）**：真值到达后不再「跳转」，而是**重锚基线后继续按增量累加**——见上方第 1 条。」
- **验收 / 测试**:
  - `CHANGELOG.md` 的 Unreleased 段**无重复分类项**（同一条目不同时出现在「变更」和「修复」下），三条新条目各归其类。
  - 第 4 条的「现行口径」行紧跟在被推翻的那条之后，**不删除历史措辞**。
- **来源**: review-scope-full / round 3

---

## `full2/*`（第 4 轮终审收口，全部 P2）

> 这 4 条来自第 4 轮**只读终审**的文本收口发现，**不是新方向**——每条都是给已有条目补一处会让执行方「照做会做偏 / 会造假 / 门限对不上」的缺口。**本轮不新增任何实现改动，只把已有改法的前提写对。**

### full2/A-2 [P2] ② spec `:67` / `:68` 的用例条数会被本 fix-spec 自己的验收改陈旧

- **维度**: A（文档一致性 / 数字口径）
- **文件**: ② `features/stream-live-token-estimator/spec.md:67`（「core：…**9 条**」）、同文件 `:68`（「mobile：…**7 条**」）
- **问题**:
  - 这两处的条数**在本 fix-spec 落地后当场变陈旧**：`metrics/B-1` 改法 #6 的验收要求「core 补 **2** 条」→ core 由 9 变 **11**；`metrics/C-2` 的验收要求「`stream-token-estimator.test.ts` 补 **2** 条」→ mobile 由 7 变 **9**。
  - round 3 的终审把这两处漏掉了，于是本文件**一边要求补 2 条、一边留着补之前的数字**——执行方补完测试后回头对读 ② spec，会以为「多出来的 2 条是重复用例」而删掉，正好把 `metrics/B-1` / `C-2` 钉住口径的那两条验收删了。
- **改法**:
  1. `:67` 「9 条」→「**11 条**（本轮 +2，见 `metrics/B-1`）」。
  2. `:68` 「7 条」→「**9 条**（本轮 +2，见 `metrics/C-2`）」。
  3. 两处都**只改数字 + 补「本轮 +N」的出处**，不要顺手改写它们周边别的措辞（那些由 `metrics/A-4` 等条目负责，别两条并行改同一段）。
- **验收 / 测试**:
  - `packages/core/test/infra/tokenizer/incremental-token-counter.test.ts` 与 `apps/mobile/__tests__/stream-token-estimator.test.ts` 两个文件的**实点条数**与文档两处数字一致（core 11 / mobile 9）。
  - **拆成两条独立 grep**（与 `metrics/C-3` 同理：Windows cmd 下 `\|` 组合模式不可靠），各自无输出才算过：`git grep -n "9 条" -- docs/Iterations/mobile-perf-2026-09/features/stream-live-token-estimator`、`git grep -n "7 条" -- docs/Iterations/mobile-perf-2026-09/features/stream-live-token-estimator`。若该目录别处有「9 条 / 7 条」指别的对象，按上下文人工确认后保留，**不要连坐删**。
- **来源**: review-scope-full / round 4（终审收口）

### full2/E-1 [P2] `full/E-1` 的覆盖面只写了 mobile，desktop 同样每 delta 读值

- **维度**: E（性能 / 覆盖面）
- **文件**: desktop 侧读值落点 `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:249` / `:264`（两处都读估算器值，最终落到 `:188-194` 的「基线 + 增量」合成），上游 `apps/desktop/renderer/hooks/useAgentStream.ts:172` / `:188`；`full/E-1` 所列 mobile 落点照旧。
- **问题**:
  - `full/E-1` 的「事实 1：指标读值没有节流」整段只举了 mobile 的 `session-stream-unit.ts:1052` / `:1075`，条件改法 #3 也只说 mobile。**desktop hook 同样是每 delta 读值**——只是它的 **250ms 只节流 usage 事件与渲染 tick，不节流读值**，所以「mobile 每 delta 读」这个事实在 desktop 侧同样成立、只是行号与节流常量不同。
  - 后果：执行方按 `full/E-1` 落地时**只改 mobile**，desktop 侧在条件改法触发时仍然是每 delta 读值，**门限过了却只修了一半**；更麻烦的是 QA 只测了 mobile 就会以为 desktop 侧已经收敛。
- **改法**（**不新增动作，只把 `full/E-1` 的覆盖面补齐；真机数据未出前一律不动实现**）:
  1. `full/E-1` 的「文件」栏补上 desktop 三处（`useAgentStreamMetrics.ts:249` / `:264` → `:188-194`、`useAgentStream.ts:172` / `:188`）。
  2. `full/E-1` 的事实段加一句：「**desktop hook 同样是每 delta 读值**（250ms 只节流 usage 事件与渲染 tick，不节流读值）」。
  3. 条件改法 #3 补一句「**desktop 同条件同改**」：读值节拍对齐 **hook 内既有的 250ms tick**（`useAgentStreamMetrics.ts:223`）——⚠️ **不要引用 `SESSION_STREAM_APPLY_INTERVAL_MS`**，那是 **mobile 专有常量**，desktop 侧根本没有它；写进去会让执行方去 desktop 找一个不存在的常量、或反过来把 mobile 常量硬搬到 desktop。
  4. 门限仍**只对 mobile 提 p95**（Open questions #15），**desktop 顺带观察、不另设门限**——两端的 Hermes/JSC 引擎不同，混在一条门限里会互相掩盖。**真机数据未出前不动实现**。
- **验收 / 测试**:
  - `full/E-1` 条目里 desktop 三处行号与实查一致：`git grep -n "recomputeCompletionTokens" -- apps/desktop/renderer/hooks/useAgentStreamMetrics.ts` 应命中 `:188`（定义）、`:249`、`:264`（两次调用；`:255` / `:270` 是 `useCallback` 依赖数组里的同名引用，不算调用）；`git grep -n "setInterval" -- apps/desktop/renderer/hooks/useAgentStreamMetrics.ts` 应命中 `:223`（250ms tick）。**逐条对读**。
  - 真机 QA（`full/E-1` 那行）**双端各测一次**，回报时**分开报 p50 / p95**，不要只报 mobile。
- **来源**: review-scope-full / round 4（终审收口，扩 `full/E-1` 覆盖面）

### full2/C-1 [P2] 「见 CR Open questions」是悬空引用（OQ 段无此题）

- **维度**: C（跨文档引用一致性）
- **文件**: 本文件 `full/A-3` 改法 #1（③ spec `:52` 的补写文案）、Spec deviations **#18**（同上）；③ `bugs/context-usage-caliber-unify/spec.md:52`
- **问题**:
  - `full/A-3` 改法 #1 与 deviations #18 都让执行方把「**是否清理见 CR Open questions**」写进 ③ spec `:52`，但本文件 Open questions 段**只到 #15，没有这一题**。执行方照抄到 ③ spec 之后，**③ spec 里就留下一句指向不存在条目的引用**——比不写更糟：下一个人去 CR 文档里找 #16 找不到，只能自己猜。
- **改法**（**取方案 1：把引用补实 + 在 OQ 段真的加这一题**）:
  1. `full/A-3` 改法 #1 与 deviations #18 两处引用改成实指：「**是否本轮删净见 CR Open questions #16**」。
  2. **Open questions 段新增第 16 条**（见下方 Open questions 段）：`formatCounterKindLabel` 的死导出是否本轮删净。
  3. ③ spec `:52` 落地后**不得残留无编号的「见 CR Open questions」**。
- **验收 / 测试**:
  - ③ spec `:52` 落地后，`Select-String -Path <③ spec> -Pattern "见 CR Open questions"` 的每一条命中**后面都跟着编号**。
  - 本文件里**作为「指引用法」**的 `见 CR Open questions` 出现处**均带编号**（`full/A-3` 改法 #1、deviations #18 两处引用 **#16**）。本条正文、`full/A-3` 改法 #1 的 ⚠️ 注释、以及下面第 3 条里出现的同名字样是**在描述这个缺陷本身**（引 round 3 的原句），**不是引用**——执行方按「指引用法」那两处核对即可。
- **来源**: review-scope-full / round 4（终审收口）

### full2/A-3 [P2] `cr-fix-spec.md` 观察项 ⑤ 缺推翻注记（③ A 组已正面闭合）

- **维度**: A（文档一致性）
- **文件**: `cr-fix-spec.md`（**只读**）验收观察项 ⑤（「上下文用量重启前后不一致」）
- **问题**:
  - 第 4 轮终审把 `cr-fix-spec.md` 的验收观察项**逐条对读**后发现：同表里的 ③/D11、③/Q7、观察项 ③ 都已被 ③ A 组正面闭合、**并各自加了「已被 `context-usage-caliber-unify` ③ A 组闭合」的推翻注记**，唯独观察项 ⑤ 只改了措辞、**没加注记**。
  - 后果：验收人扫这张观察表时会以为 ⑤ 仍是开放项，重复提一轮已经被 ③ 关掉的问题（或反过来把 ③ 的改动当成在追 ⑤）。
  - ⚠️ **本条低置信、可降级**：⑤ 到底被 ③ A 组闭合到什么程度、措辞要不要一起收，最终以 ③ spec 落地后的实际文本为准；**若执行方对读时发现 ③ A 组没有正面覆盖 ⑤，本条作废、不用补注记**。
- **改法**:
  - 在 `cr-fix-spec.md` 观察项 ⑤ 的句末追加一句：「→ **本迭代已由 `context-usage-caliber-unify` ③ A 组闭合**（API `prompt_tokens` 落 session KKV，重启后同口径）」。
  - **不删历史措辞**（与 D11 / Q7 / 观察项 ③ 的先例一致）——历史观察项记录的是当时的状态，注记只说「现在归谁关」。
- **验收 / 测试**:
  - `cr-fix-spec.md` 观察项 ⑤ 与 D11 / Q7 / 观察项 ③ 的注记句式**一致**（逐条对读，不要求文字相同、要求结构相同）。
  - **本轮只在本文件留痕**：`cr-fix-spec.md` 是只读参考文档，本 fix-spec 不改它；执行时若确认 ③ A 组已覆盖，再按上面改法落到 `cr-fix-spec.md`。
- **来源**: review-scope-full / round 4（终审收口，低置信可降级）

---

## Spec deviations

> 判定口径：**fixed by must-fix X** = 本文件某条 must-fix 会把它改掉；**按现状收窄待用户确认** = 承认与原方案措辞有差，把收窄理由登记到对应 spec，等用户拍板；**一致** = 声明与实现相符，仅留痕；**已闭合（执行时改上述两处）** = 差异已定位、改法已写死，执行时按对应条目改完即闭合。
>
> **v3 校对轮的两处改判**（这两条 round 2 判错，会让执行方以为「不用管」）：
> - **#11**「`formatCounterKindLabel` 保持不动」由 **一致 → open**（本 diff 摘掉最后三个生产调用点后，「保持不动」不再是事实）；
> - **#13** ① spec 采样器条数由 **一致 → 已闭合（执行时改 `:43` / `:56` 两处）**（实跑 17 条，原文 14 / 12 两个数都错）。
> - **#18 与 #11 是同一事实的两个视角**（#11 = 判定变更，#18 = ③ spec `:52` 这一行的具体落点）；**#21 与 #18 同批改**（③ spec `:51` / `:52` 相邻两句）。**别把它们当成三条独立改动做重。**
>
> **本表现共 21 行**（#1 – #16 为前两轮，#17 – #21 为 v3 校对轮新增）。

| # | 位置 | 声明 | 实际 | 判定 |
|---|---|---|---|---|
| 1 | ① 方案措辞「每次 usage 强制 reseed」 | 每次 usage 都清窗 | 实为「source 翻转 + 窗口折叠触发」（gemini 每个候选块都 emit usage，且 `rateAt()` 无回落值，逐条清窗会把速率清成 null） | **按现状收窄，待用户确认**（④ spec 已登记理由） |
| 2 | ② 参数草案 `commitStepChars = 256` | 256 | 实测收紧到 64（256 时中文单次 push 峰值 5.24ms，超「≤2ms」线） | **按现状收窄，待用户确认**（④ spec `:75` 已登记） |
| 3 | ② desktop 编码解析 | 按会话模型解析 | v1 固定 `cl100k_base`（需 renderer IPC 面，留后续迭代） | **按现状收窄，待用户确认**（② spec 已登记） |
| 4 | ②PRD 验收「encode 抛错保持上一次读值」 | 保持读值 | **固化路径静默丢段 + 读值可倒退** | **open → 由 metrics/B-1 闭合** |
| 5 | ④ spec `:75`「纯中文无空白 12,000 字符一次涌入约 **400–450ms**」 | 400–450ms | 评审实测 **468ms** | **按现状收窄，待用户确认**（与 #1/#2/#3 同口径；文档数字放宽为「约 400–500ms」，落点在 ④ spec `:75`） |
| 6 | ③ 变更点表 #6（`spec.md:26`）「14 个失效挂点」覆盖切模型 / Agent | 会话级入口已覆盖 | 覆盖的是**工作区级** `persistent-state`；会话级 `updateSessionAgentConfig` 漏 | **open → 由 ctx-usage/A-1 闭合**（挂点数 **14 → 18**，口径见 #16） |
| 7 | ③ 变更点表 #6 覆盖「消息增删改」 | 含「增」 | `message.service.append` 漏 | **open → 由 ctx-usage/A-2 闭合**（挂点数 **14 → 18**，与 #6 合并计入） |
| 8 | ③ 变更点表 #7 / 详细说明（`spec.md:39`）「**注入** sessionKkv，三端零改动」 | 注入 | 注入**从未发生**（9 个调用文件 / 10 条调用语句全单参，死参数） | **由 ctx-usage/C-orch-1 闭合**（措辞改「工厂自建」） |
| 9 | ③ 详细说明（`spec.md:45`）「三处统一拼 tools」 | 三处 | 存在**第四处 CLI 未拼** | **由 ctx-usage/C-1 闭合**（取收窄登记方案） |
| 10 | ③ 详细说明（`spec.md:36`）「旧格式值照常解析（向后兼容）」 | 向后兼容 | 新增域**无旧格式**；`atMs` 退化 0 与「时效判定」用途冲突 | **由 ctx-usage/A-4 闭合**（改「字段缺失一律 miss」） |
| 11 | ③ 详细说明 B（`spec.md:52`）「`formatCounterKindLabel` **保持不动**」 | 保持不动 | 本 diff 摘掉了它的**最后三个生产调用点**（desktop main service、SessionDetailDrawer、mobile service），**仅剩导出 + 1 条 mobile 测试断言**；「保持不动」在这三个调用点消失后已不是事实 | **open → 由 ctx-usage/C-orch-2 改法 #5 + `full/A-3` 闭合**（③ spec `:51` / `:52` 各补一句现状；spec 同步登记 **#18 / #21**） |
| 12 | ④ spec 第 5 节「未注入 = 旧行为，200+ 用例零变化」；②/④ spec 另外 7 处同类措辞 | 零变化 | **usage 到达之后已不成立**——① 的「基线 + 增量」恰好拆掉了旧口径的「usage 后不回写」那道门；且 ① spec `:57` 自称已把断言改写为「usage 后 delta 继续叠加」，同一份文档自相矛盾 | **open → 由 metrics/A-4 闭合**（8 处措辞收窄为「未收到 usage 前与旧口径严格一致；usage 到达后按 ① 的基线+增量口径」） |
| 13 | ① spec `:43`「既有 **14 条** core 采样器用例全绿」与 `:56`「新增 3 类，**合计 12 条**」 | 14 / 12 | **v3 校对轮实跑 `sliding-token-rate.test.ts` → `# tests 17 / # pass 17 / # fail 0`**（base 14 + 本轮 3 = 17）。round 2 判「一致」是**误判**：当时按「14 + 3 ≠ 17」反推出了「12」这个第三个数，而 :43 / :56 两句本身也互相矛盾 | **已闭合（执行时改上述两处）→ 由 `full/A-4` 落地**：`:43` 改「17 条（本轮 +3）」、`:56` 改「合计 17 条」 |
| 14 | ③ spec「验证记录：core 定向 52/52 + 全量 2171」 | — | 本轮 readonly **未复跑** | **待执行方确认**（已写入「合并后 QA」附录） |
| 15 | ② spec `:49` / `:74`、④ spec `:76`「按编码名缓存单例、**单元创建时同步构造**（落在「run 开始到首字」之间）」 | 单元创建时构造 | `metrics/C-1` 落地后，构造时机改为**会话切换时空闲预热 + `begin()`（run 起手）同步兜底**；C-1 原条目**没有任何文档同步步骤** | **open → 由 metrics/A-5 闭合**（三处措辞改写 + 删掉 ② `:74` 那句「可改为空闲预热」的待办 + 登记为 spec_deviation） |
| 16 | ③ spec `:26` 变更点表 #6 标题「**14 个失效挂点**」与其括号枚举混写了两个口径 | 14 | 括号枚举实为 **16 个调用点**（`message.service` 7 个方法被调 9 次 + `message-transcript-effects` + `run-compaction` + `message-rollback` + `persistent-state` + `clear-session-prompt-caches` + `agent-runner` 1 个方法被调 2 次）＝ **13 个公开入口方法** | **open → 由 ctx-usage/A-1 + A-2 闭合**（标题 **14 → 18 个调用点 / 15 个公开入口方法**；枚举同步：`message.service` ×9 → **×10**（A-2 加 `append`）、新增 `session.service.updateSessionAgentConfig`（A-1）；**必须注明口径**是「调用点数」还是「公开入口方法数」——round 1 的「14 / 15 / 16」三处数字都是按 14 这个错基数推的，round 2 已实查订正） |
| 17 | ③ **`prd.md:49`**（以及该目录下所有「14 个」措辞） | 14 个失效挂点 | **v3 校对轮实查该目录下 `git grep -n "14 个"` 命中 4 处**（`spec.md:26 / :39 / :65` + `prd.md:49`）。#16 只覆盖了 spec 三处，**PRD 的验收清单仍在说这个错数**，且其枚举**缺 `message.append`** | **open → 由 `full/A-2` 闭合**：spec 三处统一按 #16 口径写「18 个调用点 / 15 个公开入口方法」；**PRD 侧不写死数字**，改为引用 spec 变更点表 #6 的枚举并补 `message.append`。验收：`git grep -n "14 个" -- docs/Iterations/mobile-perf-2026-09/bugs/context-usage-caliber-unify` 无输出 |
| 18 | ③ 详细说明 B（`spec.md:52`）「`formatCounterKindLabel` 保持不动」 | 保持不动 | 同 #11 的事实（本 diff 摘掉最后三个生产调用点，仅剩导出 + 1 条测试）。**#18 是 #11 的「spec 落点」视角**：#11 记「判定从一致改为 open」，#18 记「③ spec `:52` 这一行具体要补什么」 | **open → 由 ctx-usage/C-orch-2 改法 #5 + `full/A-3` 闭合**（③ spec `:52` 补「本轮摘掉最后三个生产调用点；此后仅剩导出 + 1 条测试，**是否本轮删净见 CR Open questions #16**」——⚠️ v4 收口轮：必须带编号，无编号的「见 CR Open questions」是悬空引用，见 `full2/C-1`） |
| 19 | ② spec `:48` / ④ spec `:75` 的性能实测段（「单次 push 峰值 0.92ms / 均摊 0.47ms」） | 0.92ms 很小，不在 delta 路径上 | 两个未登记事实：① **指标读值无节流**——`session-stream-unit.ts:1052` 的 `ingestDelta` **每条 delta** 都调 `recomputeCompletionTokens()`（`:1075`），「32ms 合批」只作用于 webview 投喂；② **实测环境是 Node v22，真机是 Hermes + 纯 JS js-tiktoken，未测**。0.92ms 是「单次调用、单引擎」口径，不能支撑「不在 delta 路径上」 | **open → 由 `full/E-1` 闭合**：② `:48` / ④ `:75` 加限定「以上为 Node v22 桌面口径；Hermes 真机未测，且读值在每 delta 路径（`ingestDelta` 无节流），非每渲染帧」；真机出 p50/p95 后，若 p95 > 8ms 或可见掉帧才把读值降到每渲染节拍（`SESSION_STREAM_APPLY_INTERVAL_MS` 64ms） |
| 20 | ③ spec `:67`「读放大」段 | 只登记了「热层空 + KKV 无行时多一次主键 SELECT」 | **漏登 tools 每 step 成本**：`serializeToolsForTokenCount` 每次调用重新 `map` + `JSON.stringify` 全量 schema，压缩评估在 step 循环内每 step 一次（5 step run = 5 次）。**api 命中时不重算**，成本只落 miss 路径；而 `ctx-usage/A-2` 落地后「append 清了旧值 → 整个 run 走 heuristic + 0.85」会让 **miss 路径命中率上升**，即**本轮新引入的读放大** | **open → 由 `full/E-2` 闭合**：③ spec `:67` 补一条（注明 api 命中零成本、miss 路径每 step 多一份 stringify + 额外编码）；真机 5 step 多工具 run 确认掉帧后再考虑按 run 缓存序列化结果 |
| 21 | ③ 详细说明 B（`spec.md:51`）「文案落在调用侧：…desktop main 的 **label 拼接**」 | desktop main 有一个生产可达的 label 拼接点 | **该落点在本 diff 后已不存在**：desktop main 侧**已无任何 `formatCounterKindLabel` 调用点**，只剩 `chat-prompt-tokens.service.ts:27` 一处提及该符号的**过期 JSDoc**（由 `ctx-usage/C-orch-2` 改法 #5 收掉）。（v4 收口轮订正：round 3 写「唯一带该符号的 desktop main 函数是 `loadChatPromptTokenLabelResilient`（`:211-217`），仅测试可达」——**假陈述**，`loadChatPromptTokenLabelResilient` 走 `formatChatTokenStatsLabel` → `formatTokenSourceLabel`，与该符号无关） | **open → 由 `full/A-3` 闭合**：③ spec `:51` 补一句「desktop main 侧已无任何 `formatCounterKindLabel` 调用点，仅剩 `:27` 一处过期 JSDoc；原述『label 拼接』落点在本 diff 后已不存在」（与 #18 的 `:52` 同批改） |

---

## 执行记录（2026-09-26，`code-dev-loop`）

> 执行编排：主代理编排 + 6 个 impl/fix 子代理（wave-1 四节点并行 → wave-2 metrics → wave-3 文档 → wave-6 P2 收口）+ 1 个 verify 子代理（全量门禁）+ 2 个 readonly cr-func 子代理。
> 提交链：`5c63d27e`（base）→ `c78989f7`（core 计数器）→ `d6c1e0da`（core 失效挂点，A-1+A-2+A-3 同批）→ `2ca81325`（标签下沉 core）→ `344f6725`（CLI/mock）→ `286113be`（metrics 生命周期与公式）→ `5adc3ab0`（业务文档收口）→ **`71692b11`（HEAD，cr-func 遗留 P2 收口）**。**未 push / 未 merge / 未发版。**

### Spec deviations 21 行执行结果（逐行过）

| # | 执行结果 |
|---|---|
| 1 | **用户照准**（按现状收窄：reseed = source 翻转 + 窗口折叠触发，不做「每次 usage 清窗」） |
| 2 | **用户照准**（`commitStepChars` = 64） |
| 3 | **用户照准**（desktop v1 固定 `cl100k_base`，o200k 留后续迭代） |
| 4 | **已闭合** by `metrics/B-1`：固化路径改 1:1 兜底 + `unencodableChars` 诊断量 + 两条失败路径各自告警 |
| 5 | **用户照准**（实测区间放宽为约 400–500ms；④ spec `:75` 已改并注明评审实测 468ms） |
| 6 | **已闭合** by `ctx-usage/A-1`：`updateSessionAgentConfig` 补挂点（就地建 KKV + `await` + overlay-merge 前后差异判定 + 反向用例） |
| 7 | **已闭合** by `ctx-usage/A-2`：`message.append` 挂失效（落点在 `messages.insert` 之后） |
| 8 | **已闭合** by `ctx-usage/C-orch-1`：死参数已删、工厂内部自建；③ spec `:39` + 变更点表 #7 均已改「工厂自建」 |
| 9 | **已闭合** by `ctx-usage/C-1`：CLI 两处加中文注释登记口径差；③ spec 范围收窄段登记 CLI 不含 tools |
| 10 | **已闭合** by `ctx-usage/A-4`：`atMs` 与 `promptTokens` 同为必填，缺失 / 非法一律 miss |
| 11 | **已闭合** by `ctx-usage/C-orch-2` 改法 #5 + `full/A-3`：desktop main / mobile 两处过期 JSDoc 已收；③ spec `:55` 已如实改写 |
| 12 | **已闭合** by `metrics/A-4`：8 处措辞收窄（① 与 ④ 的 `spec.md:49` 同批改） |
| 13 | **已闭合** by `full/A-4`：① spec `:43` / `:56` 均按实跑 **17 条**改写 |
| 14 | **已闭合**：③ spec 验证记录**追加**「2026-09-26 复跑」一行（core 2173/2 红、desktop 526/526、mobile 1501/1 红 + 2 个已知 suite 红），历史记录一字未删 |
| 15 | **已闭合** by `metrics/A-5`：三处措辞改「空闲预热 + `begin()` 兜底」，删掉② `:74` 的待办句；代码注释同批改 |
| 16 | **已闭合** by `ctx-usage/A-1` + `A-2`：③ spec 三处统一为「**18 个调用点 / 15 个公开入口方法**」（执行后实查复核一致：`invalidateSessionApiPromptTokenEntry(` 9 处 + `message.service` 私有 helper 10 个调用点） |
| 17 | **已闭合** by `full/A-2`：③ 目录 4 处「14 个」全清（含 PRD），验收 grep 无输出 |
| 18 | **已闭合** by `ctx-usage/C-orch-2` 改法 #5 + `full/A-3`：③ spec `:52` 补现状并带 **OQ #16** 编号 |
| 19 | **已闭合** by `full/E-1`：② `:48` / ④ `:75` 加「Node v22 桌面口径 + Hermes 真机未测 + 读值在每 delta 路径」限定（`full2/E-1` 的双端覆盖面已回填进该条目） |
| 20 | **已闭合** by `full/E-2`：③ spec 读放大段补 tools 每 step `JSON.stringify` 成本（**只登记、未改实现**） |
| 21 | **已闭合** by `full/A-3`：③ spec `:51` 补「原『desktop main 的 label 拼接』落点在本 diff 后已不存在」 |

### 执行期新增的两条事实订正（不在原 21 行内）

- **`full2/A-2` 的预写数字有误**：条目改法 #1 写死「core 9 → **11**（本轮 +2）」，但 `metrics/B-1` 的第 2 条验收是**并入既有「encode 抛错」用例加断言**（②PRD 验收原文即写「保留现有第 5 条不动」）、不新增 `it()`。主代理逐行实测：**base `5c63d27e` 9 个 `it(` → HEAD 10 个 `it(`，实跑 `# tests 10`**，故真数是 **10（本轮 +1）**。② spec `:67` 按真数 10 落地（执行方未照抄错数），② PRD `:41` 的枚举已补上新增用例那一条。
- **`full2/E-1` 的落点在本文件自己的 `full/E-1` 条目里**（不是业务文档），已由主代理回填（见该条目的 ⚠️ 回填段），并把「desktop 侧同样每 delta 读值」与订正后的行号一并写进去。

### cr-func 两节点结论与遗留处置

- `n8a-crfunc-metrics`（metrics scope）：**func-ready: yes** —— 9 条 metrics + `full/I-1` / `full/A-4` 全部 A 矩阵落地并有 `文件:行` 实证，13 条定向测试实跑全绿。
- `n8b-crfunc-ctx-docs`（ctx-usage + 文档面）：**func-ready: yes** —— 两条 P1 与全部实现类改法实证落地、4 条硬门限 grep 零残留、技术性 open deviations = 0。
- 两者合计提出 **6 条 P2（无 P0/P1）**，已由 `n9-crfunc-p2-fix` 全部收口（`71692b11`）：变更点表 #7 措辞、两处过期 JSDoc + ③ spec `:55` 反向假陈述、③ spec 验证记录复跑行、`C-4` 两条 barrel 结论留痕、② PRD 用例枚举补项。
- **一处复核分歧由主代理实证裁决**：`n8b` 报「② spec `:67` 应为 9 条」，`n8a` / `n6` 报 10 条 —— 主代理逐行实测（base 9 → HEAD 10）确认 **10 为真数**，`n8b` 的基线计数有误，② spec 未改动。

### 执行期暴露、但**不属于本 fix-spec 范围**的两条环境问题（仅登记，未修）

- `apps/desktop` 的 `npm test` 在 Windows cmd 下会**收集到 0 条测试**（`scripts/run-tests.mjs` 的默认 glob 用单引号包裹，cmd 不把单引号当引号）——**既有平台缺陷**，会造成「本地显示全绿但其实一条没跑」的假象；本轮用等价双引号参数跑出 526/526。建议单开一条修。
- mobile 的 `apps/mobile/android/app/src/main/assets/index.android.bundle` 是**旧产物**（gitignored、不进门禁），出 1310 真机包前必须重新 `react-native bundle`，否则 WebView 侧资产是旧的。

---

## Open questions / 待拍板

> 以下均**不阻塞** fix-spec 落地（`ready`），但影响执行后的收口判断，请用户逐条拍板。

1. **同源 usage 下调会把速率夹成 0**。source 翻转有重 seed 保护，但**同 source** 的后续 usage 校正若真值 < 当前读值，`Math.max(0, Δ)` 会让速率短时显示 `0 t/s`。这是**既有行为**（非本 diff 引入），① 收窄 reseed 之后更值得盯。是否需要在「同 source 且读值下调」时也重 seed？**请用户拍板。**
2. **desktop 估算器建立时机**：`useAgentMetrics` 在 running 上升沿的 effect 里建，理论上首个 delta 不会早于 effect。评审倾向**不动**。
3. **desktop 侧 `o200k` 编码解析（IPC 面）**是否值得下一迭代补？当前固定 cl100k，对 gpt-4o / o1 系别约 ±10%。
4. **`runId` / `lastMessageSeq` 目前只写不读**：确认为「为后续留口」，还是可以砍到 `{promptTokens, atMs, savedModelId}`？**请用户拍板。**
   - ✅ **已拍板（2026-09-27，用户：不用的就移除）**：值形状收敛为 `{promptTokens, atMs, savedModelId?}`，代码落 `50e81d4d`。解析保持「只解构已知键、未知键忽略」，**旧行不需要迁移或清库**；`agent-runner` 里只为该字段服务的 `lastAppendedSeq` 记账一并拆净（不留 `void` 保活的只写变量）。零读取方已由 `git grep` 双证（`lastMessageSeq` 全仓零命中；`runId` 在 `infra/tokenizer` 下零命中——`stream_metrics` / `finalRate` 那条**有读取方**的 `runId` 链路未动）。
5. **指纹不符的行仍会回填热层**（后续每次读都判 miss，但不影响结果）——评审倾向**不动**。
6. **`resolvePromptTokensWithBackfill` 已退化为纯透传**（`_rawMessages` 形参已死）：建议本轮**不动**，记入迭代 backlog。
7. **emoji 折算**（1 个码点 ÷3.35 ≈ 0.3 token，真 tokenizer 约 2~3）：mock 定位取证用，判定**可接受不修**。
8. **mock 改动无测试基建**（`scripts/` 不在任何 test runner 内）：判定**可接受**。若要低成本兜底，可在文件末尾加 `if (process.env.MOCK_SELFTEST)` 自检钩子。
9. **mobile `session-stream-unit-pipeline.test.ts` 整文件单跑会让 jest worker 崩**（`run-finish-calibration-probe` 的真实定时器 teardown 后触发 `Platform.OS` undefined），分批跑全绿——**既有测试卫生问题，非本 diff 引入**。执行方跑测试时请分批。
10. **prettier**：`apps/mobile` 有 `format:check` 闸，但基线已有 **635 个文件**不合规（本轮改动的 6 个文件在列）。**不跑全量 prettier 闸**（见 K 节）。
11. **`ctx-usage/A-2` 带来的两条产品语义**（A-2 本身照改不阻塞，但这两条要用户拍板）：
    - **(i) run 期间占用标签回落**：append 一清值，run 期间占用 chip 会从「上次请求」回落为「预估」，直到本轮 run 结束 runner 写回新 api 值。回落期间**数字本身也明显偏低**，落差比普通「预估」更扎眼。**接受？**
      - ⚠️ **v3 校对轮订正理由**：round 2 在这里写「而且**本地预估不含 tools 段**」——**错**，见 `ctx-usage/A-2` 改法 #3 (i) 的完整订正。正确表述是「**UI 读口拿不到 tools**（`session-prompt-input` 不产 tools，双端显式传 `undefined`）；**本地 `countPromptLlmInputHeuristicOnly` 本身是拼 tools 的**，压缩评估路径照常含 tools（`token-ratio.trigger.ts:66-68`）」。**请按这版理解，不要按 round 2 那句**——后者会让人以为「本地估算不算 tools」，进而想去删 core 里的拼接，那会打穿 C 组。
    - **(ii) 压缩判定在整个 run 内不再吃 api 值**：step-1 压缩评估前旧值已被清，**全程走 `heuristic + 0.85 安全垫`**。这**比现状更准**（现状拿的是上一轮、不含本轮新用户消息的 api 值，系统性低估、压缩偏晚），但它是一次**未登记的行为变更**——改前整个 run 用 api 值，改后全程启发式。**接受并登记为行为变更？**
12. **写侧 `writeSessionApiPromptTokenEntry` 是否也要可 await**（v3 校对轮新增）。`ctx-usage/A-3` 把 `invalidateSessionApiPromptTokenEntry` 改成了可 await 的 `Promise<void>`；**对称的写侧**（`agent-runner` 写回 `prompt_tokens` 那两处）仍是 fire-and-forget。**本轮建议不动**——写侧丢的是「本次 run 的终值」，而 usage 事件走的是另一条事件总线通道（有兜底），不像失效删除那样会造成「重启后读到陈旧行」的数据错误。请用户确认这个「只 await 读侧删除、不动写侧」的取舍可接受。
13. **CLI 要不要在输出里标 `estimated`**（v3 校对轮新增）。`ctx-usage/C-1` 判定 CLI 是取证 / 调试面、与压缩评估存在口径差（不含 tools），只加注释不改行为。**倾向继续不加标记**（CLI 的定位就是人工核对，标了反而在 grep 文本时碍事），但若用户希望 CLI 输出自带口径提示，可在 `apps/cli/src/prompt/commands.ts:128` / `:151` 的输出行尾加 `（本地估算，不含 tools）`。**请用户拍板。**
14. **是否接受为 `metrics/G-1` 新增 `js-tiktoken-hook.mjs` 测试基建**（v3 校对轮新增）。断言「连续两次工厂只构造一次编码表」在 ESM 下打不进具名导入，**唯一可达的确定性手段**是本仓既有的 `module.register` 钩子机制（`register-electron-mock.mjs` 已在用它）。代价是 desktop `test/` 下多一个 `.mjs` 钩子文件 + `register-electron-mock.mjs` 多一行 `register`。**替代方案是放弃这条断言**，但那样 desktop 侧「编码表是否真被复用」就永远没有回归保护。**请用户拍板是否接受这处新增基建。**
15. **`full/E-1` 的 8ms 门限是否采纳**（v3 校对轮新增）。`full/E-1` 建议以「Hermes 真机 per-delta 读值耗时 **p95 > 8ms**」作为「把估算器读值降到每渲染节拍（64ms）」的触发门限。**8ms 是暂定值**，取自「16.7ms 一帧的四分之一、留足余量」这个粗算，**没有实测依据**。请用户拍板：采纳 8ms、改成别的值，还是改成「只看是否可见掉帧、不设数字门限」。**门限不定，第 3 步的条件改法就没法判定做不做。**
16. **`formatCounterKindLabel` 的死导出是否本轮删净**（v4 收口轮新增）。`full/A-3` + `ctx-usage/C-orch-2` 摘掉最后三个生产调用点后，它只剩 **core 定义 + 导出链（`packages/core/src/infra/tokenizer/index.ts:31`、`packages/core/src/public/provider.ts:157`）+ `public-provider-allowlist.json` 快照 + mobile 测试 1 处断言**（`apps/mobile/__tests__/chat-prompt-tokens.test.ts:230-233`）。
    - **倾向不删**：这条导出是 `@novel-master/core` 的**公开契约**（走 `public/provider.ts` 导出面），删它属 **breaking change**，不在本迭代「修 bug + 对齐口径」的范围内；而且**导出面留着不等于还有人在用**——留着的成本是零（一个纯函数、无副作用、无监听）。
    - **处置方式与 OQ #4 对齐**（`runId` / `lastMessageSeq` 同属「为后续留口、当前只写不读」）：**按现状收窄待用户确认**，本轮**不删**、**不登记 spec_deviation**（因为本 diff 并没让它变得更「死」，只是把最后一个调用点摘了）。
    - 若用户坚持删，同批需处理 5 处：core 定义、上述 2 个 barrel、`public-provider-allowlist.json` 快照、mobile 那条测试断言（连同同文件 provider mock 里的 `formatCounterKindLabel` 那一项，**其余 mock 项保留**）。**请用户拍板。**

---

## 已豁免（用户确认不修）

- 本轮**无**经用户显式确认豁免的 must-fix。评审提出但判定「可接受不修 / 记 backlog」的项目已全部落在上面「Open questions」（第 6、7、8 项），它们**不是**豁免，只是留待后续迭代，请勿在执行时误当作「已豁免」跳过。

---

## 合并后 QA（manual_user）

### 已在真机 1309 验收过的部分（本轮三条，纯 UI 路径、真模型 `glm-5.3`）

- **① 多步速率**：多步 run 终态 `708 t · 47.9 t/s`（= 496 + 212），**第二步不冻结** ✅
- **③ 上下文占用口径**：`上次请求` 两态标签正确；`prompt_tokens` / `lastPromptUsage` KKV **落库成功**；杀进程重启后口径一致、冻结速率保持 ✅

### fix-spec 执行后**必须再出一版真机包复验**（建议 `versionCode 1310`）

| 项 | 复验内容 | 触发方式 |
|---|---|---|
| metrics/B-1 | 特殊 token 文本不崩、读值**不倒退** | 造含 `<|endoftext|>` 的模型输出 / 输入，跨过固化阈值后观察 `t` 单调 |
| metrics/C-1 | ①首 run **无** 250–420ms 请求延迟；②启动水合路径**不卡**；③**切会话路径也不卡**（预热已空闲化，卡顿不许从「点发送」搬到「切会话」） | 冷启动真机，观察启动耗时；冷启后立刻发第一个 run；快速连续切换几个会话并观察帧率 |
| ctx-usage/A-1 | 换 agent 后 KKV 行被清 | 只读库证：切 agent 后查 `prompt_tokens` 行是否消失 |
| ctx-usage/A-2 | 发新消息后 KKV 行被清；**并确认 run 期间占用 chip 的标签跳变符合预期**（「上次请求」→ 清值 → 「预估」→ run 结束写回「上次请求」，且回落期间的数字偏低是已知的 tools 段缺口，见 Open questions #11） | 只读库证：`message.append` 后查行是否消失 **＋ 真机观察一个完整 run 期间的标签/数字跳变** |
| ctx-usage/C-orch-2 | 双端标签仍为「上次请求 / 预估」 | 桌面 + 移动各看一眼占用 chip |
| `metrics/E-1`（v3 新增） | **Hermes 真机**以真流跑 ≥800 字中文输出，记录 **per-delta 耗时 p50 / p95** 与**掉帧数**。**v4 收口轮补（`full2/E-1`）：desktop 侧同样是每 delta 读值，本行要双端各测一次、p50 / p95 分开回报** | 真机发一个长中文 run，边跑边看帧率；结束后回报 p50 / p95 两个数 |
| `ctx-usage/E-2`（v3 新增） | 真机跑 **≥5 step 的多工具 run**，确认无明显掉帧 | 真机触发一个多步多工具 run，观察帧率与指标条流畅度 |
| **`context-usage-real-tokenizer-fallback`**（敏捷项，2026-09-27 追加） | ①中文会话的「**预估**」读数不再低估（应显著大于旧折算值——折算对中文低估 82%~84%）②Hermes 上**首次**「上下文占用」计数不卡（编码表冷构造 Node 实测 185–248ms，真机倍率未知）③多 step run 里**每 step** 压缩评估的计数耗时无可感卡顿（Node 病态串单步峰值 7.4ms，真机待测） | 真机建一个中文长会话看占用读数；冷启动后立刻进该会话看首帧；跑 ≥5 step 多工具 run 观察帧率 |

> **不上真机的三条**（`metrics/A-4`、`metrics/A-5`、`ctx-usage/C-4`）走各自条目的「验收 / 测试」：前两条是 `git grep` 无残留 + 措辞人工对读，第三条是 `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` 无新增报错。**它们不需要真机包复验，但漏做会留下假 spec / 断编译，优先级不低于上面几条。**
>
> **同样不上真机的 `full/*` 文档类条目**（`full/A-2` / `A-3` / `A-4` / `D-1` / `I-1` / `K-1`）：前四条走 `git grep` 与 `npm run typecheck`，`full/I-1` 走对应单测的 `console.warn` 断言，`full/K-1` 走 CHANGELOG 人工对读。**`full/E-1` / `E-2` 是例外**——它们本身就是为了上真机量的，已单列在上表。
>
> **`full2/*` 四条（v4 收口轮）同样不上真机**：`full2/A-2` / `C-1` / `A-3` 走 `git grep` 与人工对读；`full2/E-1` 不新增 QA 行，**并入 `metrics/E-1` 那一行**（双端分开报 p50 / p95）。

### 附录：需要执行方确认的遗留

- **deviation #14**：③ spec 声称的「core 定向 52/52 + 全量 2171」本轮 readonly **未复跑**。执行方在改完后需**实跑并回报实际数字**（core 定向 + 全量），若数字对不上要回来更新 spec。
- **deviation #13**：`sliding-token-rate.test.ts` 本轮已实跑（**17 条全绿**），执行方只需按 `full/A-4` 改 ① spec 的两处数字并回报。
- **deviation #17**：`git grep -n "14 个" -- docs/Iterations/mobile-perf-2026-09/bugs/context-usage-caliber-unify` 必须**无输出**才算清干净（含 PRD）。评审时另报过 `prd.md:35` 也含该措辞但未命中，**按目录全量清**、别只改这 4 个行号。
- **测试运行注意**：mobile `session-stream-unit-pipeline.test.ts` 请**分批跑**（见 Open questions #9）；desktop 测试命令在 **`apps/desktop` 目录下**跑 `node scripts/run-tests.mjs <file>`（见 `metrics/G-1` 订正）。
- **不跑全量 prettier**（见 K 节）。

---

## K 节建议（下游执行时闭合）

1. **只对本轮改动文件跑 eslint / typecheck**（项目约定走 build），**不跑全量 prettier**——`apps/mobile` 基线已有 635 个文件不合规，跑全量会引入与本次修复无关的噪声 diff。
2. **不改历史取证文档**里已记录的旧口径数字，例如 `docs/Iterations/llm-stream-native/step7-pool-restore-report.md` 等——那些是当时的事实记录，不是本轮 spec。
3. **deviation #5** 需要执行方同步改 **④ spec `:75`** 的实测数字（400–450ms → 约 400–500ms），别漏。
4. **`metrics/C-3` 的 grep 验收要拆成两条**（v3 校对轮订正）：round 2 写的单条 `git grep -n "字符折算兜底\|真值优先，heuristic"` 组合模式**在 Windows cmd 下不可靠**。正确写法是两条独立命令，各自**无输出**才算过：`git grep -n "字符折算兜底" -- apps packages` 与 `git grep -n "真值优先，heuristic" -- apps packages`。清单也按**措辞 A（2 处）/ 措辞 B（2 处）**分组，别按同一个词去找 4 处。⚠️ 后一条模式含**全角逗号**，可能假阴性，**请用 PowerShell `Select-String` 或 ASCII 锚点复核一遍**。
5. **`ctx-usage/A-3` 要改七个 async 调用方**（v3 校对轮：round 2 写「六个」已过期），`agent-runner` 两处**保持 fire-and-forget**（但要补注释），不要顺手"统一"成 await。其中 `message.service` 的私有 helper 要连带改 `private async` 并**逐个 await 它的 10 个调用点**（v4 收口轮：9 → 10，**第 10 处是 `ctx-usage/A-2` 在 `message.service.append`（`:159`）新增的，两条必须同批改**；A-2 写错就会在修 A-3 的同一个 PR 里新生产一处 fire-and-forget）——TS 不会替你报这个错，漏一个就是静默半成品。**新增的第 7 个 async 调用方是 `ctx-usage/A-1` 带来的 `session.service.updateSessionAgentConfig`，它必须 `await`**，两处要一起改、一起验收。总闸门自查命令：`git grep -n "invalidateSessionApiPromptTokenEntry(" -- packages/core/src/service` —— 除 `agent-runner.ts` 的 `:873` / `:909` 两处外，每处前面都要有 `await`。另需把 `message.service.ts:83` 与 `message-rollback.service.ts:236` 两处 JSDoc 的「fire-and-forget」改成「已 await」（A-3 改法 #5）。
6. **「显式具名再导出」闭环要一次核全**（`metrics/C-orch-1` 改法 #2、`ctx-usage/C-orch-2` 改法 #2+#5、`ctx-usage/C-4` 改法 #2+#3）：新增导出只改上游 `public/*.ts` barrel、不改下游 `apps/desktop/shared/logic/*.ts` 的具名再导出，desktop 侧 import 直接断。**这几条属同一类漏网点**，但**落点是三个不同文件**（`format.ts` / `provider.ts` / 本仓已确认 mobile 无同类 barrel），请一次核全再统一跑一次 `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json`。
   - ⚠️ **`apps/desktop/shared/logic/format.ts` 的改动只由 `metrics/C-orch-1` 改法 #2 执行**（v3 校对轮去重：`ctx-usage/C-4` 改法 #1 已收敛为一句话指向它）。**ctx-usage scope 执行方不要动这个文件**，否则两个 scope 会在同一行上打架。
   - ⚠️ **本轮新增导出「只追加、不重排」**：`format.ts:9-21` 的再导出列表是**历史顺序**（`buildStreamMetricsLine` → `formatCharCount` → `formatStreamElapsed` → `slidingTokenRate` → `createTokenRateSampler` → `createIncrementalTokenCounter` → 常量 → 类型），**不是字母序**。新符号**追加到现有列表末尾**，既有条目一个字不动——按「字母序」插进去会把整份列表重排，diff 噪声从一个函数扩大到整个文件。
7. **`full/E-1` / `full/E-2` 是「先量后改」的两条**（v3 校对轮新增）：本轮**只**做各自改法 #1（② spec `:48` / ④ spec `:75` 加 Node v22 限定；③ spec `:67` 补 tools 读放大）与改法 #2（QA 表加行）。**条件改法（把读值降到每渲染节拍 / 按 run 缓存 tools 序列化）在真机数据出来之前一律不动实现**——尤其 `full/E-1` 的 8ms 门限还没拍板（Open questions #15）。
8. **`full/K-1` 的 CHANGELOG 措辞要和 `full/D-1` 对齐**：`full/D-1` 删掉的是 UI 读口恒等空串的 tools 拼接，`full/K-1` 第 3 条 changelog 写的是「上下文占用口径统一」——**不要在 changelog 里暗示 UI 预估已含 tools**，那与 D-1 改完之后的事实相反。
9. **`full2/*` 四条是「文本收口」，全部走各自条目的验收、都不上真机**（v4 收口轮新增）：`full2/A-2`（② spec `:67` / `:68` 改条数 + grep 无残留）、`full2/E-1`（`full/E-1` 条目补 desktop 覆盖面，**真机数据未出前不动实现**）、`full2/C-1`（③ spec `:52` 落地后不留无编号的「见 CR Open questions」）、`full2/A-3`（`cr-fix-spec.md` 观察项 ⑤ 补推翻注记，**低置信可降级**）。**其中只有 `full2/E-1` 复用 `full/E-1` 那条真机 QA 行（双端分开报 p50 / p95），其余三条纯文档 grep / 人工对读。**
10. 改完后把本文件「状态」从 `draft` 推进，并在「Spec deviations」里把已闭合的行标注执行结果（**21 行全部过一遍**，别只标前 16 行）。

---

## Fix-Spec Closure（主代理 2026-09-26 判定）

| 项 | 状态 |
|---|---|
| **fix-spec-ready** | **yes**（4 条「按现状收窄」**已由用户照准**，见下） |
| **执行状态** | **已执行完毕 = dev-ready（2026-09-26，`code-dev-loop`）**：32 条 must-fix 全部落地；6 个 impl/fix 节点 + 1 个 verify 节点 + 2 个 readonly cr-func 节点；提交链 `5c63d27e` → `c78989f7` → `d6c1e0da` → `2ca81325` → `344f6725` → `286113be` → `5adc3ab0` → `71692b11`（HEAD）；**未 push / 未 merge / 未发版**。逐条结果见文末「执行记录」 |
| **执行期验证** | core 全量 **2173 / 2 红**（既有时区归桶）；mobile 全量 **1501 / 1 红** + 2 个已知 suite 红；desktop 全量 **526/526**；core / mobile / cli typecheck 零输出；desktop renderer tsc 全仓 349 条既有债、**本轮改动文件新增 0**；renderer vite 出包成功（index 3,212 kB）。**无本轮引入的回归** |
| **fix_spec_path** | `docs/Iterations/stream-metrics-native-integration-cr/cr-fix-spec-v2.md` |
| **base_sha / head_sha** | `83a434d7` → `fad16a12`（**评审范围**；执行后的提交链见上一行「执行状态」，最后一次实质改动提交为 `71692b11`） |
| **dag_version / review_round** | 4 / 4 |
| **P0 / P1 / P2（已写入 fix-spec）** | **0 / 2 / 30**（合计 32 条） |
| **未写入的开放 must-fix** | **0**（第 4 轮终审的 13 项收口已全部并入 v4） |
| **spec_deviations** | 21 行；技术性 open **0**（#4/#6/#7/#8/#9/#10/#12/#13/#16/#17/#18/#19/#20/#21 均由 must-fix 条目闭合）；**待用户确认 4 条「按现状收窄」：#1（reseed 口径）/ #2（commitStepChars 64）/ #3（desktop v1 固定 cl100k）/ #5（实测数字区间）** |
| **C-orch** | ✅ 已查（三处「显式具名再导出」漏网点已归口去重：`shared/logic/format.ts` 只由 `metrics/C-orch-1` 改；`shared/logic/provider.ts` 由 `ctx-usage/C-orch-2` 核；mobile 无同类 barrel 已实查） |
| **C 类合并后 QA（manual_user）** | 不阻塞：本轮三条已在**真机 1309**（纯 UI、真模型 glm-5.3）验收过；fix-spec 执行后需出 **1310** 复验的项见「合并后 QA」节（`metrics/B-1` / `metrics/C-1` / `ctx-usage/A-1`+`A-2` / `ctx-usage/C-orch-2` / `metrics/E-1` / `ctx-usage/E-2`） |
| **Open questions** | 16 条（不阻塞；其中 #1 同源 usage 下调夹 0、#11 A-2 两条产品语义、#15 8ms 门限、#16 死导出是否删净 建议用户一并看）。**#4（`runId` / `lastMessageSeq` 只写不读）已拍板移除并落地（2026-09-27，`50e81d4d`）** |

**两条 P1（最要紧，执行顺序建议置顶）**：

1. `metrics/B-1` —— `incremental-token-counter` 固化路径 `encode` 失败会**静默丢字符且读值可倒退**（评审实跑复现 8→4），与 ② PRD 验收「保持上一次读值」直接冲突；真机触发路径真实（js-tiktoken 对 `<|endoftext|>` 类文本默认抛错）。
2. `ctx-usage/A-1` —— **会话级「切 Agent」入口 `session.service.updateSessionAgentConfig` 没有任何失效挂点**（双端用户实际点的就是这个，PRD 验收点名路径）：换 agent 后旧 `promptTokens` 会以 `api` 身份跳过 0.85 安全垫参与压缩判定，且**跨重启存活**。

**轮次记录**：round 1 两 scope（7+10 条）→ spec-fix v1（17 条）→ round 2 两 scope 复审（+3 条、11 处文本订正）→ spec-fix v2（20 条）→ round 3 两 scope + review-full（改错 4 处改法前提 + 补 2 处缺口 + 3 处文档偏离 + 5 条新维度 = 13 项）→ spec-fix v3（28 条、deviations 21 行、OQ 15 条）→ round 4 两 scope + review-full（13 项收口）→ spec-fix v4（**32 条**、OQ 16 条）。**第 4 轮三份终审一致结论：方向零误判、无推翻性发现，剩余全为收口型文本订正并已全部并入。**

**⚠️ 执行已完成（2026-09-26）**：本 fix-spec 的 32 条 must-fix 已全部落地并在四道门禁上通过，当前状态 **dev-ready**（提交链与逐条结果见文末「执行记录」）。用户已照准 4 条「按现状收窄」（#1 reseed 口径 / #2 `commitStepChars` 64 / #3 desktop v1 固定 cl100k / #5 实测数字区间）。

**仍未做（等用户指令，属协作红线）**：
1. **出 `versionCode 1310` 真机包复验**——「合并后 QA」表列出的项（多步速率、`<|endoftext|>` 不倒退、切会话无卡顿、换 Agent 清值、双端标签、per-delta p50/p95、多 step run 流畅度）必须在真机上按**纯 UI 路径**走一遍，禁止写库注入（RULE）。
2. **merge / push / 发版**——必须等用户明确指令。
3. **Open questions 16 条**（不阻塞执行）：**#4 已由用户拍板移除并于 2026-09-27 落地**（`50e81d4d`）；仍需用户拍板的是 #1 同源 usage 下调夹 0、#11 A-2 两条产品语义、#15 8ms 门限、#16 `formatCounterKindLabel` 死导出是否删净。
