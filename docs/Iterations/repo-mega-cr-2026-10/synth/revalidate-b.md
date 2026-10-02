# W10 台账重验 · B 台（core-runtime / core-misc / core-data / apps-mobile / apps-desktop 之 P0+P1）

> 哎呀～你终于来啦，人家把新基线 `main@fe79b781`（v1.5.29，合并 `805fa696 feat/read-tool-result-ref`）从头到尾读了一遍呢。
> 纪律守住啦：零 git 写、零 `docs/apm/` 写、零生产代码改动，只读 + 落这一份台账。
> 输入：`ledger.md` 的 core-runtime 簇（含 P0 RT-01/RT-02）、core-misc 簇、core-data 簇、apps-mobile / apps-desktop 簇的**全部 P0/P1**。
> 口径：**valid** = 病灶原样在位｜**fixed** = 已修｜**stale** = 标的物已不存在/已改名｜**partial** = 一半修了一半没修。

## 0 · 总账

| 簇 | P0 | P1 | valid | fixed | partial | stale |
|---|---:|---:|---:|---:|---:|---:|
| core-runtime | 2 | 2 | 3 | 0 | 1 | 0 |
| core-misc | 0 | 3 | 3 | 0 | 0 | 0 |
| core-data | 0 | 1 | 1 | 0 | 0 | 0 |
| apps-mobile | 0 | 2 | 2 | 0 | 0 | 0 |
| apps-desktop | 0 | 4 | 4 | 0 | 0 | 0 |
| **合计** | **2** | **12** | **13** | **0** | **1** | **0** |

一句话结论：**这一波只动了 RT-01 的「覆盖 hidden」那一半，台账里其余 13 条 P0/P1 一条都没被碰过**，行号漂移但不失效。

---

## 1 · core-runtime 簇

### RT-01（P0）· **partial** · 行号已漂移 587-588 → **604-607**

**修了什么（`e2d10b3f perf(core): agent 每次读收窄`）**

调用点整个换掉了，现在长这样：

- `packages/core/src/service/agent/impl/agent-runner.ts:604-607`
  ```ts
  let toolUseLookupMessages: readonly ChatMessage[] | undefined;
  if (protocol === "gemini" && this.deps.listVisibleSessionMessages != null) {
    toolUseLookupMessages = await this.deps.listVisibleSessionMessages();
  }
  ```
- 装配侧 `logic/assemble-agent-runner-deps.ts:73-76` → `runtime.messages.listBySession(toolCtx.sessionId, { includeHidden: false })`
- 仓储侧 `domain/chat/repositories/impl/sqlite-message.repository.ts:263-283` 把过滤下推到 SQL（`AND hidden = 0`），注释写明压缩行不再逐条 inflate

所以台账里那句「**有意的是「覆盖 hidden」，不是「全量读」，两件事分开改**」——这一波改的恰恰是「覆盖 hidden」那一半，方向与台账建议相反（新代码论证「hidden 行对 `buildToolUseLookup` 零解析力，因为 `normalizeOrphanToolResultsForLlm` 按可见集配对」）。**台账这条附注的前提已过期**，`synth/core-runtime.md:148` 里「覆盖 hidden 是有意的」同样过期。

**没修什么（这条不能核销）**

- 每 step 仍然是一次**全会话读**：`MESSAGE_SELECT_COLUMNS`（`sqlite-message.repository.ts:28`，21 列，含 `content_json` / `content_blob` / `attachments_json`），无 memo、无失效、无窄读口。
- 消费方 `infra/llm-protocol/logic/gemini-content-mapper.ts:54-71` 的 `buildToolUseLookup` 依旧只需要 `tool_use` 的 `id` / `name`（`:339` 处 `lookupSource` 仍吃整条 `ChatMessage[]`）。
- 也就是说：**「全量读」这一半原封不动**，只把 hidden 那部分行从读集里摘掉了。commit message 自陈的实测口径是「每步两次 368.2→3.9ms / 93.5%」，那 3.9ms 是把 `:413` 那次也算进去的合并数字，不能当成这一条已修的证据。

**证据**：`agent-runner.ts:604-607` + `assemble-agent-runner-deps.ts:73-76` + `sqlite-message.repository.ts:263-283` + `gemini-content-mapper.ts:54-71,334-341`；测试侧 `packages/core/test/infra/llm-protocol/gemini-content-mapper.test.ts:427-465` 只钉了「可见集完备性」这个等价断言，没有钉读口宽度。

---

### RT-02（P0）· **valid** · 行号已漂移 `:405` → **`:413`**、`:506` → **`:519`**

双读一处都没合并，两次读仍然互不共享：

- `agent-runner.ts:413` → `let visible = await session.list();`
- `agent-runner.ts:517-535` → `this.deps.compactionConditions.shouldRequestCompaction(this.deps.session, {...})`，仍把 `this.deps.session` 原样递下去
- `domain/compaction-conditions/triggers/visible-floor.trigger.ts:17-23` → `const visible = await session.list(); return visible.length > this.visibleFloor;`（逐字未改）
- 装配链 `service/compaction-conditions/create-compaction-condition-evaluator.ts:71,92` 把 `session` 透传给 trigger，未变

**唯一变化是「便宜了」不是「少了」**：两次 `session.list()` 现在各自都走 `ChatAgentSession.list()` 的 `includeHidden:false`（`service/agent/impl/chat-agent-session.ts:30-39`），单次成本降了，但**读次数仍是每 step 两次**。台账的修法（把 `:405` 已拿到的 `visible.length` 喂给触发器、零新增接口）依然零成本可落。

**附带确认**：`agent-runner.ts:411` 的 `stepCompactionEmitted` 仍在循环体内声明，W6 旁证结论继续成立。

---

### RT-04（P1）· **valid**

- `domain/agent/model/agent-definition.schema.ts:221-229` 的 `definitionToDocument` **仍然没有** `validateAgentPromptLayout(def.prompts)` 前的守卫，两段循环逐字未动。
- 静默丢块机理原样成立：`persist[block.name] = persistBlockToWire(block)` 是对象赋值，**重名块后者覆盖前者、不报错**；随后 `validate-agent-definition.ts:88-89` 的「终极防线」做的是 `decode(agentDefinitionSchema.toWire(def), agentDefinitionSchema)` —— 往返已经塌缩过，`validateAgentPromptLayoutFromMaps` 拿到的是 map，唯一性判据（`domain/prompt/logic/validate-agent-prompt-layout.ts:320-334` 的 `assertUniqueBlockNames`）在 decode 侧按 map 语义根本触发不了。
- W6 收窄后的作用域（LLM `agent` 工具写路径）也确认未修：`domain/tool/builtin/agent-tool.ts:211-231` → `service/agent/impl/agent-registry.service.ts:98-99` 只到 `validateAgentDefinition`，而 `config-forms/agent/agent-editor-state.ts:590` 的 `validateAgentPromptLayout` 守卫仍只在 UI 侧。
- 第二份同款序列化循环仍在：`domain/chat/model/project-agent-config.schema.ts:29-36` 的 `configToWire` 里同样裸调 `agentDefinitionSchema.toWire`。

---

### RT-08（P1）· **valid**

- `service/template/impl/template-pull.service.ts:24-36`：`sessionTemplatePull` 事务提交后仍只有 `await runDeferredBlobGc(this.conn)`，**没有** `clearSessionPromptCaches(sessionId, kkv)`。
- 全仓 `clearSessionPromptCaches` 生产调用点仍**只有两处**：`service/vfs/impl/vfs-zip-io.service.ts:259`、`service/vfs/impl/character-card-import.service.ts:197`。模板拉取路径依旧不在其中 ⇒ `rule_snapshot` + `file_cache` 双陈旧这条危害链（UI 显示新内容、模型看旧内容）未缓解。

---

## 2 · core-misc 簇（三条全 valid）

### M-01（P1）· **valid**

- `service/provider/impl/model-request.service.ts:232-233` 的重试判据逐字未动：`const canRetry = attempt <= policy.maxRetries && isRetryableError(error);`
- `isRetryableError`（`:69-104`）依旧只看错误类型 / HTTP 状态码，**没有任何 attempt 级「本次是否已产出」探针**；`:81-84` 那条「非 ProviderError 默认当瞬时错、可重试一次」还在。
- `while (true)` 循环（`:211-243`）每次重试都用**同一个** `options?.onStream`（`:226`）重驱 adapter.chat ⇒ attempt1 已吐字后失败仍会二次驱动，重复计费面未封。
- 台账引用的 `llm-sse-transport.ts` 已迁到 `logic/` 子目录（`infra/llm-protocol/logic/llm-sse-transport.ts`），`:665-682` 的 `resolveOnce` / `rejectOnce` 幂等 settle 结构未改。**引用路径需更新**。

### M-03（P1）· **valid**（行号小漂 214-222 → 209-223）

- `domain/workplace/logic/load-or-fill-file-cache.ts:142` 仍是 `if (deps.status !== "filename") { ... probeOversizePlaceholder ... }` —— **`filename` 档依旧绕过 `:182` 的 `vfs.findContentSize` 轻量探测**，这条零成本合并没做。
- `:209-223` 的 `readWorkplaceFileBody`：`filename` 档直接返回 `{ body: "", mtimeMs: 0 }`，`vfs.read` 抛错时 catch 返回 `"(missing)"`；两者**都仍然写回 file_cache**（`:153-164` 的 `writeBack`），「catch 降级归入不落 cache 分支」没做。
- 第二个入口 `service/workplace/assemble-workplace-display.ts:175-187` 仍走同一个 `fillFileCacheFromVfs(..., { deferBackfillWrite: true })`，未分流。
- 渲染侧 `domain/workplace/logic/workplace-display.ts:66-86` 的 `renderFileBlock` 未改。

### M-04（P1）· **valid**

- `domain/provider/logic/find-saved-model-references.ts:32-93` 依旧只扫三处：`kv_entry`（`currentModelId`）、`agent_definition.prompts_json`、`chat_project.agent_config_json`。**`chat_session` 仍然零扫描** ⇒ 「删服务商静默清空被引用模型」这条端到端链路未被堵。
- `service/provider/impl/provider.service.ts:211-266` 的 `delete` 仍是五步 `CoordinatedWrite`（suggestions / savedModels / providers / secret / 顺序回滚），**全函数无 `findSavedModelReferences` 调用、无 in-use 拒绝**（`findSavedModelReferences` 在该文件里零命中）。

---

## 3 · core-data 簇

### CD-01（P1）· **valid**（含争议 D-6；W6 四步优先级**一步未落**）

| W6 建议步骤 | 现状 | 证据 |
|---|---|---|
| ① rewind 空树护栏（S-13 放宽为「任何模式下 targetTree 为空即降级弹窗」） | **未落**：护栏仍带 `plan.mode === "undo_send"` 条件 | `service/message-checkpoint/impl/message-rollback.service.ts:159-175` |
| ② 文件维度指纹乐观锁 | **未落**：事务内只重读**消息计数** | 同文件 `:194-216`（`SqliteMessageRepository(tx).countBySession` + `currentCount !== plan.messageCountSnapshot`） |
| ③ 删集合事务内重算 | **未落**：`pathsNeedDelete` 在 plan 阶段（事务外）算完，事务内直接消费 | 计划期 `:416-450`；事务内 `:562-565` `for (const logicalPath of pathsNeedDelete)` 无重算 |
| ④ tailIds 断言 | **未落**：全仓无 tail 集合一致性断言 | `message-rollback.service.ts:80,364,426-450`；`domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:76-106` 只做删除无断言 |

**rewind 空树零覆盖这条仍然成立**：`packages/core/test/message-checkpoint/rollback-empty-target-guard.test.ts` 现在有 3 条用例（T-DS2a / b / c），但**三条全是 `undo_send` 路径**，rewind + `targetTree` 为空的组合依旧没有任何断言。

W6 的其他修正也继续有效：计划外那条 `pathsNeedDelete` 追加仍被 `COUNT(*)` 检查门控（`:434-449` 里 `pathByEntryId.get(...) != null` 才 add）；`resolveReconcilePathSets` 仍在事务外跑（`domain/message-checkpoint/logic/resolve-reconcile-paths.ts:32-89`），台账原修法「整体移进事务」依旧被否。

---

## 4 · apps-mobile 簇

### AM-1（P1）· **valid**（行号完全未漂 `:521-541 / :564-589 / :591-610`）

- `services/session-stream-unit-manager.service.ts:717-741` 的 `forgetSession` **依然只有定义、零调用方**——全 `apps/mobile/src` grep `forgetSession` 只命中该文件自身的注释与定义（`:50`、`:246`、`:323`、`:717`）。
- 三条删除链路依旧零 `forgetSession`：`screens/tabs/chat-tab/useChatTabScope.ts:521-541`（`handleDeleteSession`）、`:564-589`（`deleteSelectedSessions`）、`:591-610`（`handleDeleteProjects`）——只清 `chat-session-view-cache` / 滚动快照 / transcript 快照。
- 两张 Map 仍**无界**：`idleMessageViews`（`:358`）与 `settledProjections`（`:353`）都是裸 `new Map(...)`，全文件只有 `.set / .get / .delete / .clear`，**无任何 LRU / 容量上限**。「加 500 LRU 兜底」这半个修法也没做 ⇒ 拍板项 #13 的「不降级」前提照旧成立。

### AM-3（P1）· **valid**

- `navigation/types.ts:16` 仍是 `RealPrompt: undefined;` —— 路由参数**未加可选 `{projectId?, sessionId?}`**。
- `screens/stack/RealPromptScreen.tsx:20-23` 依旧无 props，直接 `const {projectId, sessionId} = useMobileScope();` —— 即「回落 scope」是当前唯一行为。
- 两处入口依旧零参数：`screens/stack/SessionDetailScreen.tsx:397` `navigation.navigate('RealPrompt')`、`screens/tabs/chat-tab/useChatTabController.ts:106-107` 同款。触发链（通知点按 → 树外写面改 scope → 导航推迟 → 栈顶仍是 A）未被封堵。

---

## 5 · apps-desktop 簇（四条全 valid）

> 路径订正：这簇的 renderer 真实路径是 `apps/desktop/renderer/**`（**没有** `src/` 一层），台账与本文件都按此书写。

### S-D-02（P1）· **valid**（行号完全未漂）

- `apps/desktop/src/main/ipc/handlers/vfs.ts:423-432` 的 `handleVfsBatchClearStaging` 把 `req.stagingRoot` **原样透传**，无任何规范化。
- `apps/desktop/src/main/services/vfs-batch.service.ts:260-272` 的 `clearVfsBatchExportStaging` 只有 `if (stagingRoot.trim() === "") return;`，随后 `await rm(stagingRoot, { recursive: true, force: true })` —— **没有 `resolve()` + `startsWith(base + sep)` 断言**，也没有非法路径 warn。

### S-D-04（含盲扫条目 A）（P1）· **valid**

- `renderer/features/settings/AgentEditorView.tsx` 全文仍**零 `dirtyViews`**（全 `apps/desktop/renderer` grep `dirtyViews` 只命中 `settings-nav.ts:99,137-138,161,169`、`SettingsOverlay.tsx:74-78,118,121,143`、`SkillDetailView.tsx:137-147`）。
- `dirtyViews.add` 全仓**仍然只有 `SkillDetailView.tsx:142` 一处** ⇒ 对 `agentEditor` 的守卫恒 false，盲扫条目 A 的独立重推导继续成立。
- Overlay 侧守卫未动：`renderer/layout/SettingsOverlay.tsx:135-155`（`guardedNav`）、`:236-247`（`handleClose`）、`:268-272`（侧导航）、`:291-300`（返回键）。
- **App 侧 ⚡ 旁路也还在**：`renderer/App.tsx:344` `onToggleSettings={() => setSettingsOpen(open => !open)}` 直接翻 state、**不走 `handleClose`**，dirty 的 Agent 编辑器可被一键关掉。

### B（P1）· **valid**

- `packages/core/src/config-forms/agent/agent-editor-state.ts:542-568` 的 `formSnapshotJson` 逐字段核对：含 `name` / `maxSteps` / `modelEnabled` / `toolsMode` / `toolsSelected` / `systemEnabled` / `systemContent` / `persistEnabled` / `dynamicEnabled` / `workplaceEnabled` / `workplaceAssistantText` / `customAttachEnabled` / `customAttachText` / `skillsEnabled` / `skillsPrefixText` / `description` / `persist` / `dynamic` —— **`mode` 仍然缺席**，与 W6 的判读一致（`customAttach` 与 `description` 各有一条「纳入 dirty 比对」回归，唯独 `mode` 没有 ⇒ 遗漏而非有意排除）。

### E（P1）· **valid** · **无任何缓解**

失败链逐跳仍在（`renderer/features/settings/AgentEditorView.tsx`）：

1. `:232-244` `loadAllSavedModels`：`ipcProviderModelsSavedList(...).then(res => res.ok ? res.data.map(...) : [])` —— **失败静默折叠成 `[]`，无 catch、无日志、无错误横幅**；
2. `:346-356` `loadAgent`：`allModels.find(m => m.id === def.model)` 在 `[]` 上得 `undefined` ⇒ `pinned` 为 `undefined`；
3. `:351-356` 传 `null` 进 `applyDefinition` ⇒ `:286-289` `const modelOn = pinned != null` 得 `false`，`modelEnabled` 被折叠成「关」；
4. `:291-303` 的 `setSavedBaseline(formSnapshotJson({...}))` 用的是**同一个 `modelOn=false`**，基线同源 ⇒ `dirty === false`；
5. 下次 `save()` 走 `delete definition.model`，用户的专属模型绑定被静默解除。
6. 复核确认：无「原绑定模型当前不可用」提示、无二次确认、无错误横幅。

---

## 6 · 顺带核到的过期 / stale（不在本台 P0/P1 口径内，但台账正文引用了它们，登记防误用）

| 台账条目 | 级别 | 判定 | 证据 |
|---|---|---|---|
| **RT-03**「`messageContentPool` 4M 字符预算 / `MAX_ENTRIES=4096` / `poolHitRatio 0.400`」 | core-runtime P2 | **stale** | `infra/content-cache/logic/decoded-content-cache.ts:176-183` 现为 `CONTENT_BODY_POOL_MAX_CHARS = 8_000_000` / `MAX_ENTRIES = 1024`，且池**已改为内容寻址**（键 = 明文 sha256，`:191-207`），`MESSAGE_CONTENT_POOL_*` 两个常量与 message-id 维度池**全仓零命中**。台账 §5 拍板项 #6 与 Wave C「缓存池预算」所依赖的 `message-content-perf-threshold.test.ts` 也已改口径——该文件头注释明写「原先两条正向护栏随 message-plaintext 迭代退役」，现在只测「明文化对稳态读是纯收益」，**不再测命中率**。⇒ 「跑现成基建取真实命中率」这一步已无载体。 |
| **F-w8-13**「e2e fixture `llm_saved_model` 腐烂」 | apps-mobile P2 | **仍 valid（提示里的「可能 fixed」不成立）** | `apps/mobile/e2e/fixtures/tool-turn-session.sql:102-116` 本波确实被改过（新增了 contentRef 样本 `:94` 与 `vfs_content_blob` / `vfs_entry` / `vfs_revision` 保活链 `:118-156`），**但那条 `INSERT OR IGNORE INTO llm_saved_model` 一字未改**：仍缺 `id`（`NOT NULL PRIMARY KEY`）与 `model_name`（`NOT NULL`）两列（对照 `bootstrap/provider/provider-schema.ts:21-30`），且 `provider_id='anthropic'` 仍引用一条全文件从未插入的 `llm_provider` 行（grep `llm_provider` 在该 .sql 里零命中）。注入器 `e2e/scripts/inject-tool-turn-fixture.mjs:78` 依旧是单发 `db.exec(sql)` ⇒ 断在 `:116`，`:158-161` 的三行 `kkv_entry`（含 `currentModelId`）照旧不执行 ⇒ `T-E2 / T-E3` 结构性跑不起的结论原封不动。 |
| core-runtime 缓存生命周期族（RT-22 `clearAll()` 零调用等） | P2 | **仍 valid** | `infra/tokenizer/logic/session-api-prompt-token-cache.ts:48` 的 `clearAll()` 全仓生产零调用（只被测试与 `public/provider.ts` re-export 触达）；rebootstrap 侧只调 `bootstrap/novel-master-bootstrap.ts:348` 的 `clearDecodedContentCaches()`。 |

---

## 7 · 给台账的更新建议（只提不改）

1. **RT-01 拆成两条**：① 「gemini 每步读含 hidden」→ 已被 `e2d10b3f` 修掉（可见-only + SQL 下推），可降 P2 或直接核销；② 「每步仍一次 21 列全量读、无 memo、消费方只要 id/name」→ **维持 P0**，这才是剩下的那条。
2. **RT-01/RT-02 行号全量刷新**：`587-588 → 604-607`、`405 → 413`、`506 → 519`；RT-03 定位 `decoded-content-cache.ts:186-187 → :176-183`（且常量名已变）。
3. **M-01 路径订正**：`impl/llm-sse-transport.ts → logic/llm-sse-transport.ts`。
4. **apps-desktop renderer 路径订正**：全簇 `src/renderer/** → renderer/**`。
5. **RT-03 与拍板项 #6 需重拍板**：它量的是一个已被删除的池；Wave C「缓存池预算」在 `message-content-perf-threshold.test.ts` 改口径后**没有测量载体**了，要么重建基线要么整条撤下。
6. **F-w8-13 维持 P2**：fixture 的 contentRef 补链做了，但 `llm_saved_model` 那一行腐烂原样，且新加的 blob/revision 行排在它**后面**——顺序上更靠后地依赖一个先失败的语句。

嗯哼～该看的一个都没漏，剩下 13 条 P0/P1 的病灶在新基线上都原封不动地立着，谁也别想偷偷核销掉哦。