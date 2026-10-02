---
zone: core-runtime
agent: verify（W6 验证代理）
wave: W6
date: 2026-10-01
input: synth/core-runtime.md
scope: P1 逐条从代码重新推导（不采信报告文字）
p0_sealed: 2（RT-01 / RT-02，主代理逐字封印 :405 / :587-588，免验）
p1_verified: 6
  confirmed: 2（RT-04 / RT-08）
  refuted: 0
  severity_adjusted: 4（RT-03 / RT-05 / RT-06 / RT-07）
git_writes: 0
---

# W6 验证 · core-runtime P1

## 免验清单（主代理封印，不重推）

| ID | 位置 | 封印理由 |
|---|---|---|
| RT-01 | `service/agent/impl/agent-runner.ts:587-588` | 主代理已逐字封印（gemini 协议门 + 每 step 全量读）。本代理只做旁证：`agent-runner.ts:586-589` 确认在 `for (let step...)`（`:398`）体内、条件 `protocol === "gemini"`，注释 `:582-585` 明确 openai/anthropic 不消费。 |
| RT-02 | `impl/agent-runner.ts:405` + `:506` | 主代理已逐字封印。旁证：`:403` 声明 `stepCompactionEmitted`、`:405` `session.list()`、`:504-522` 把 `this.deps.session` 传给条件评估，两次读互不共享。 |

## 复核方法

- 每条 P1 都从**生产代码**重新推导，不引用 `raw/**` 报告文字；报告的 file:line 全部重新定位核对。
- 数字结论一律实测（RT-03 跑了真实 LRU 池复刻件，用 `packages/core/dist` 的真 `DecodedContentPool`）。
- 对每条 P1 额外做**缓解措施搜查**（找报告没看到的兜底），搜查结果写进「漏看的缓解」列。

---

## verdict 表

| ID | 原判 | verdict | 代码重推（证据） | 漏看的缓解 | 结论要点 |
|---|---|---|---|---|---|
| **RT-03** | P1 | **severity-adjusted → P2** | `infra/content-cache/logic/decoded-content-cache.ts:186-187` 确认 `MESSAGE_CONTENT_POOL_MAX_CHARS = 4_000_000` / `MAX_ENTRIES = 4096`。**实测**（真 `DecodedContentPool`，`dist` 构建件）：1000 条 × 10K 字符 = 10M 工作集 → 暖扫命中 **400/1000 = 0.400**；200 条 × 20K = 4.0M → **1.000**（恰好卡在悬崖边）；5000 条 × 1K = 5M → 0.800。**悬崖精确在 4M 字符总正文**，与 `MAX_ENTRIES` 无关。 | 无缓解。但报告对「RT-01/RT-02 修完自然缓解大半」的推论**是错的**：削掉第二次全会话读不改变单次扫描的工作集。工作量 = 扫描次数 × 单次 miss 数：2 次扫描 = 2 × 0.6N = 1.2N，1 次 = 1.0N，只省 ~17%，远不是「大半」。 | 机制 confirmed，**数字 0.53 不可复现（实测 0.400）**。真实影响是「工作集 > 4M 字符时缓存退化成逐出抖动」，量级取决于真实会话正文体量，而报告未实测真实分布。降到 P2：**先修 RT-01/RT-02，池预算单独拍板**，不要在本轮动内存。 |
| **RT-04** | P1 | **confirmed（P1）** | `domain/agent/model/agent-definition.schema.ts:222-229` `definitionToDocument` 逐块 `persist[block.name] = persistBlockToWire(block)` —— **同名后写覆盖先写，last-wins 静默丢弃**。`logic/validate-agent-definition.ts:73-89` `assertWritableAgentDefinitionShape` 只校验 `Array.isArray(prompts.persist/dynamic)`，**不调 `assertUniqueBlockNames`**；末尾 `decode(toWire(def), schema)` 的 `toWire` **已经把数组折叠成 Record**，schema 侧结构上不可能发现重名。`assertUniqueBlockNames`（`domain/prompt/logic/validate-agent-prompt-layout.ts:320`）唯一调用点是 `validateAgentPromptLayout`（`:339-343`），而它只被 `config-forms/agent/agent-editor-state.ts:590` 的 `buildAgentDefinitionFromForm` 调用 —— 即**只有 UI 编辑器路径有守卫**。落库侧 `sqlite-agent-definition.repository.ts:82` `encode(def, schema)` 走的还是同一个 `toWire`，`get` 读回已是去重版 ⇒ **丢块不可逆、不可见**。 | 只有 UI 路径有守卫（这是缓解的一半）。LLM 写路径无任何缓解：`agent-tool.ts:280-286` 的 `definition` 是 `z.object({}).passthrough()` 裸收包，`:217-222` 直接 `registry.upsert(definition as unknown as AgentDefinition)`，注释自认「字段级校验完全交 upsert」。LLM 拿到的是「保存成功」，不知道丢了一块。 | 范围比报告写的窄一档（不是「域模型」层的问题，是 **LLM `agent` 工具写路径**的问题；UI 编辑器路径已守）。但后果是**静默丢提示词块 + 无错误回传**，在 agent 配置链上属于正确性损失，维持 P1。修法同报告：`definitionToDocument` 前先 `validateAgentPromptLayout(def.prompts)`。 |
| **RT-05** | P1（自 P2 升） | **severity-adjusted → P2** | 抛点/落库条件全部复核成立：`agent-runner.ts:690-712` assistant 已 append 且 `assistantAppendedInRun = true`；`:789` `assertNoDoomLoopInBlocks` / `:798` `assertNoCrossRoundDoomLoop` 抛；`:914` catch 非 abort 分支；`:930` 条件 `persistMessages && !assistantAppendedInRun` 为假 ⇒ **不落任何失败消息**；`:953` 发 FAILED；`:960` rethrow。LLM 侧确实由 `normalize-orphan-tool-results-for-llm.ts:82-102` 第二遍**移除**悬挂 tool_use 兜住（不会 400）。 | **报告漏了两条真实缓解，用户可见性没有它说的那么强**：① desktop `ConversationPanel.tsx:470-471` `onRunFailed` 里 `setComposerError(formatUserError(...))` + `showToast(payload.error)`；mobile `session-stream-unit-manager.service.ts:1462-1472` `finishRun('failed')` → `uiBridge.onError(errorMessage)`。两端都**弹了错误 toast**，「无痕」不成立。② 报告称「UI 侧是永不收敛的工具 chip」—— **错**。`message-blocks.ts:243-255` `resolveUnpairedToolStatus`：`runUiStopped` 为真直接 `"error"`，否则 `isTurnToolExecuting` 要求 `agentRunning`，而 FAILED 已把 `uiRunning` 翻假 ⇒ **chip 收敛到 error 态，不会停在 pending**（mobile `message-blocks.ts:330-341` 同款）。 | 核心事实 confirmed（无持久失败消息，`:924-928` 注释承诺的「失败原因从一次性 toast 变为持久可回查」在 doom-loop 路径上确实破口）。但「升 P1」的两条支撑（用户完全无反馈 / chip 不收敛）均被实测推翻，只剩「缺一条可回查的持久痕迹」这一条 —— 一次性 toast 仍在。**降 P2**：改成 doom-loop 专属 catch 分支仍值得做，但不再满足 P1。 |
| **RT-06** | P1（自 P2 升） | **severity-adjusted → P2** | `agent-runner.ts:844` `const vfsMutated = anyToolUseMutatesWorkspace(toolUses)`，`toolUses` 来自 `:763-765` `result.blocks.filter(b => b.type === "tool_use")` —— **纯模型请求侧名单**。`:807-830` 的 degraded 分支把 `outcomes[i]` 填成 `ok:false` 的 `ProviderError`，但 `:844` 仍只看名单。`domain/tool/logic/tool-use-mutates-workspace.ts:15-19`：`isMutatingFileToolName(name)` 为真且 `name !== "fs"` ⇒ **直接 return true**，连 `input` 都不看。所以一个参数 JSON 非法的 `write`（`input` 被降级成 `{}`，见 `openai-content-mapper.ts:431`）必然被判突变。三个消费门复核成立：`:866-871` checkpoint、`:899-907` STEP_COMMITTED、`:964-972` FINISHED。 | 无正确性方向的缓解也无恶化：假阴性确实不存在（判定保守）。`ShellNavProvider.tsx:341-347` 那一路有 `p.sessionId === workspaceSessionId` 早退，所以**自己会话的重复 reload 由 `ConversationPanel.tsx:438/466/508` 承担，子会话才走 ShellNav 旁路** —— 报告把这条说成「desktop 整棵工作区树 reload」，实际两条路径各管一半。 | 事实 confirmed，但报告自认「是性能/噪声不是正确性」。真实代价 = 一次多余的 `messageCheckpoint.capture`（`message-checkpoint.service.ts:41-67`，事务内全量 `listSessionFileHeads` 扫 session 文件树）+ 一次防抖树刷新 + **多一个空的回滚点**（用户会看到一个「回滚到这里」但回滚不出任何东西的选项）。**降 P2**。修法同报告：`outcomes[i].ok === true && anyToolUseMutatesWorkspace([toolUses[i]])`。 |
| **RT-07** | P1（代码形状 confirmed / 可见性 suspected） | **severity-adjusted → P3**（争议 D-1 判定：**refute**） | 代码形状复核成立：`run-agent-turn.ts:1119` try、`:1319` finally，**其间无 catch**。四个真抛点确认在 try 内：`:1144` `agentRegistry.list()`、`:1154` `assembleSkillsToolContext`、`:1194` `session.append`、`:1296-1302` 偏好读。与主 run 的 `publishPreludeRunFailed`（`:466-477`）不对称成立。 | **报告与 synth-apps-mobile 的交叉问题，本代理在 mobile 侧找到了完整答案——「不会挂起」**。mobile 子会话单元**只在 `onRunStarted` 里创建**：`session-stream-unit-manager.service.ts:1270-1279` → `adoptConsumptiveUnit`（`:1303`）。而 `EVENT_AGENT_RUN_STARTED` 由 `agent-runner.ts:386-388` 发出，位置在 `runner.run()` **内部**、全部前奏装配之后。⇒ **前奏抛错 ⇒ 子 run 从未发过 STARTED ⇒ 子会话单元根本没被建出来 ⇒ 没有 running 单元、没有 refcount、没有 `uiRunning` 卡死、没有 keep-alive 需求**。三条旁证：① `listCalibratableSessionIds`（`:1891-1899`）只收 `unit.getRunId() != null` 的单元，无单元即不参与校准探针；② `consumptiveSessions` 集合同样只在 `onRunStarted` 里 add（`:1283`、`:1317`）；③ `SUBAGENT_CHILD_SESSION_CREATED`（`:1229`）只在**父单元** `registerPendingChild`（`:1343-1360`），父 run 随 task 工具抛错照常 settle → `clearPendingChildren`（`session-stream-unit.ts:841`）清干净。④ `abortRegistry.register`（`run-agent-turn.ts:1120`）与 `streamRegistry.register`（`:1137`）都在 `finally`（`:1319-1328`）里带所有权比对反注册，无 registry 泄漏。 | 争议 D-1 判「无兜底」→ **refute**：mobile 侧有结构性兜底（单元懒创建），根本进不到需要兜底的状态。残留的真实后果只有一条，且是化妆品级：**子会话已在 DB 里建出来、task prompt 已在 `:1194` append，但一条终态事件都没有**，用户点进子会话页看到的是一条孤零零的 user 消息、无助手回复。**降 P3**。补 catch 仍是对称性上的正确修法（且 helper 已是 scope 化的、复用零成本），但不再有 P1 依据。 |
| **RT-08** | P1 | **confirmed（P1）** | `service/template/impl/template-pull.service.ts:24-36` 全文复核：事务里只调 `initializeSessionWorkspace(tx, projectId, sessionId, {clearCheckpoints:true})`，提交后只调 `runDeferredBlobGc` —— **既不调 `clearSessionPromptCaches`，也不碰 `rule_snapshot` / `file_cache` 两域**。`git grep clearSessionPromptCaches` 全仓非测试调用方只有 `character-card-import.service.ts:197` 与 `vfs-zip-io.service.ts:259` 两条导入路径，确认。`domain/workplace/logic/load-or-fill-file-cache.ts:46-57`：命中即 `parseFileCachePayload` 直接 return，**无 mtime 校验、无内容指纹校验**。`service/workplace/assemble-workplace-display.ts:171-187`：`cached ?? await fillFileCacheFromVfs(...)` —— **缓存分支优先**，冷回填根本不会被触发。`rule_snapshot` 同样陈旧：`loadOrCreateRuleSnapshot`（`:213-239`）非空即返回，而 `replaceVfsSubtree` 会把 project 域的目录规则一并搬进 session scope。 | **无任何缓解，这是六条里最实的一条**。相邻的 `deleteSessionFsData`（`service/session-fs/create-session-fs-service.ts:56-81`）只清 checkpoint / live ref / revision，`runDeferredBlobGc` 只清 blob，两者都不碰 KKV 域。用户路径真实存在：desktop `WorkspaceHeaderActions.tsx:37-53`（"初始化"）与 mobile `TemplatePullButton.tsx:42-53`（"从上级同步"）都直落这条链。 | 维持 P1，且**实际危害比报告写的更宽**：不只是 `<file>` 块与 bodyLength 指纹陈旧，`rule_snapshot` 也一起陈旧 ⇒ 目录规则求值结果（哪些文件按 full / filename 展示）也停在 pull 之前。**用户点「从上级同步」覆盖本地修改后，接下来每次对话的提示词里仍是旧正文**——UI 文件树显示新内容、模型看到旧内容，两边不一致。修法同报告：事务提交后、`runDeferredBlobGc` 旁调 `clearSessionPromptCaches(sessionId, kkv)`（best-effort 语义与两条导入路径一致）。 |

---

## 汇总

| verdict | 条数 | ID |
|---|---|---|
| confirmed | 2 | RT-04、RT-08 |
| refuted | 0 | —（但 RT-05 / RT-07 的**用户可见性主张**被 refute，见下） |
| severity-adjusted | 4 | RT-03 ↓P2、RT-05 ↓P2、RT-06 ↓P2、RT-07 ↓P3 |
| escalated | 0 | — |

**W6 修正了 4 条 P1 的定级，其中 RT-07 争议 D-1 判「无兜底」为 refuted。** 复核过程中被推翻的具体主张（供 L3 记账时不要再当依据）：

1. **RT-05「UI 侧是永不收敛的工具 chip」——错**。两端 `resolveUnpairedToolStatus` 在 run 结束后都收敛到 `error`；且两端都有一次性错误 toast，用户不是零反馈。
2. **RT-07「子会话页会永久卡在运行中」——错**。mobile 子会话单元是 `onRunStarted` 懒创建的，前奏抛错时 STARTED 根本没发，单元不存在。
3. **RT-03「poolHitRatio = 0.53」——不可复现**，实测 0.400；且「RT-01/RT-02 修完缓解大半」不成立（只省约 17%）。
4. **RT-06「desktop ShellNavProvider 整棵工作区树 reload」——只对子会话成立**，自己会话那一半走 `ConversationPanel`。

**维持 P1 的两条（RT-04 / RT-08）都是静默数据/内容失真，无任何现存缓解，且都在用户主动触发的主路径上。**
