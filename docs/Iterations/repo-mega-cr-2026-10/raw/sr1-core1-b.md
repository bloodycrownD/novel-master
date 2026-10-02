---
zone: mega-cr / S 阶段 spec-check
agent: sr1-core1-b（readonly reviewer · wave-b-core1 分片 · 组 B）
files_scanned: >
  docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一章 + 第四章）、
  docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md（§2.2 / §8 / §8.1 终裁 / §10）、
  docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-b-core1.md（B1-4 / B1-5 / B1-6）、
  docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-a.md（A1 RT-02 + §9.2）、
  docs/apm/RULE.md（压缩统计优先口径 / 回合快照冻结 / includeHidden:false 头投影 /
  两阶段读数投递通道 / 导入缓存对齐 / 常驻工作区 / 用量详情弹窗取数）、
  生产代码：agent-definition.schema.ts、project-agent-config.schema.ts、
  validate-agent-prompt-layout.ts、validate-agent-definition.ts、project.service.ts、
  template-pull.service.ts、create-template-pull-service.ts、clear-session-prompt-caches.ts、
  session.service.ts、load-or-fill-file-cache.ts、assemble-workplace-display.ts、
  agent-runner.ts、chat-agent-session.ts、assemble-agent-runner-deps.ts、
  run-agent-turn.ts、gemini-content-mapper.ts、sqlite-message.repository.ts、
  chat-agent-session.ts、prepare-user-messages-for-prompt.ts、hydrate-tool-results-for-prompt.ts、
  vfs-tree-copy.ts、workplace-view-cache.ts、chat-token-estimate-memo.ts、
  测试：template-pull.test.ts、clear-session-prompt-caches.test.ts、
  read-ref-production-smoke.test.ts、gemini-content-mapper.test.ts、
  project-agent-config.schema.test.ts、backfill-cursor.test.ts、prompt-token-invalidation.test.ts
基线: fe79b781（worktree D:\Dev\nm-worktree\mcr）
---

# sr1-core1-b · wave-b-core1 组 B 审查（RT-04 / RT-08 / RT-01）

> 纪律：全程只读。本文件是本机位唯一被允许写入的文件；未做 git 写、未碰 `docs/apm/`、未改生产/测试代码与 fix-spec。
> 所有 file:line 与引文均在 `fe79b781` 工作树逐处重新打开核对，未照抄台账或 fix-spec。

---

## 1 · 逐条 verdict 表

| # | 条目 | verdict | 七要素齐备 | 病症从代码重推导 | 修法可行 | 验收可测 | 依赖闭合 |
|---|---|---|---|---|---|---|---|
| B1-4 | RT-04 `definitionToDocument` 同名 persist/dynamic 块静默塌缩 | **Go（含 1 条 must-fix 澄清）** | 齐 | ✅ 复核成立 | ✅ 收敛点唯一、两处循环全覆盖 | ✅ 断言 A/B/C/D 有牙 | ✅ 无前置 |
| B1-5 | RT-08 模板拉取整树覆盖后漏清 prompt 缓存 | **Go（含 2 条 must-fix 澄清）** | 齐 | ✅ 复核成立 | ✅ 复用既有 helper，符合 RULE | ✅ 断言 C 有牙但**理由写反** | ✅ 无前置 |
| B1-6 | RT-01 gemini 每 step 全可见正文拉回、无 memo | **No-Go** | 齐 | ✅ 复核成立 | ❌ **memo 复用语义反了，会丢本 step 新追加的 tool_use** | ❌ 断言无牙（A/C 捕不到该缺陷） | ⚠️ 依赖 RT-02 声明正确，但落地后与本条修法冲突需重述 |

**verdict 计数：Go×2 / No-Go×1；must-fix 5 条（其中 1 条阻断）。**

### B1-4 复核要点（逐处核对）

- 病症重推导：`agent-definition.schema.ts:221-229` 确为两段裸 `persist[block.name] = persistBlockToWire(block)` / `dynamic[block.name] = …`，无唯一性前置校验（已开 `:221-232` 逐行读）。
- 读侧确有唯一性语义：`validate-agent-prompt-layout.ts:320-334` 的 `assertUniqueBlockNames` + `:339-343` 的 `validateAgentPromptLayout` 第一件事调它（已开 `:336-367` 读）。
- **「三调用点唯一收敛」成立且已实测**：`agentDefinitionSchema.toWire` 全仓仅两处被调——`validate-agent-definition.ts:89` 与 `project-agent-config.schema.ts:33`；后者再被 `project.service.ts:84`（`serializeAgentConfigForStorage`）与 `:237`（`updateAgentConfig`）使用（grep 全仓 `agentDefinitionSchema.toWire|projectAgentConfigSchema.toWire|definitionToDocument` 得 7 命中，逐条核对）。⇒ **在 `definitionToDocument` 头部插一次 `validateAgentPromptLayout(def.prompts)` 即同时覆盖 ledger 记的两份循环**，`configToWire` 无需改代码。spec 的收敛判断正确、完备。
- 「zod 往返这道防线对本条无效」成立：`validate-agent-definition.ts:88-89` 的 `decode(agentDefinitionSchema.toWire(def), agentDefinitionSchema)` 走的是**已被塌缩过的 document**，往返必然合法（已开 `:85-99` 读）。
- 修法副作用核对（spec 风险栏已覆盖，我复核结论一致）：`validateAgentPromptLayout` 内部走 `validateAgentPromptLayoutFromMaps`，其中 `stripLegacyWorktreeBlocksFromPersistMap`（`:237`）对 legacy worktree 块是**静默剥离而非拒**，故不会新增拒绝面；`persistEnabled` 末块角色 / `dynamicEnabled` 首末角色等校验（`:272-300`）在读侧 `documentToDefinition`（`:193-206`）已跑同一套，**不新增「能读不能写」的面**——spec 结论正确。
- 测试与回归线真实存在：`test/agent/agent-definition.test.ts`、`test/chat/project-agent-config.schema.test.ts`（56 行，现 5 条 `it`，确无 `toWire` 用例，spec 要求新增成立）、`test/agent/agent-definition-io.test.ts`、`merge-agent-definition-patch.test.ts`、`sqlite-agent-definition.repository.test.ts`、`test/config-forms/agent-editor-state.test.ts`、`test/package-exports/snapshots/` 全部实存。
- `agentDefinitionSchema.toWire` 在测试中零直接引用（grep `packages/core/test` + `apps` 无命中）⇒ 新增断言不会与既有 mock 冲突。

### B1-5 复核要点

- 病症重推导成立：`template-pull.service.ts:24-36` 事务提交后只有 `runDeferredBlobGc(this.conn)`（`:35`），无任何 KKV/prompt 缓存清理（已开全文 `:1-50`）。
- helper 存在且四件事齐全：`clear-session-prompt-caches.ts:29-54`（`:34` rule_snapshot / `:35` file_cache / `:38` API prompt token 双删 / `:42-47` usage_stats 哨兵 / `:48-53` 整体 try-catch + warn）。
- 既有两处接入点行号**逐字核对为真**：`character-card-import.service.ts:196-198`、`vfs-zip-io.service.ts:258-260`，均在事务 try/catch 之外、提交后调用（已开两处上下文读）。
- 「push 方向不加」判断成立：`pushSessionWorkspace` 是 session → project 单向拷贝，会话侧 `file_cache` 不受影响（`session.service.ts:255-260`）。
- `file_cache` 读口无 mtime 校验 —— **实测确认且比 spec 说得更彻底**：`load-or-fill-file-cache.ts:42-58` 命中即 `return parsed`，全程不比对 mtime；批量路径 `assemble-workplace-display.ts:171-187` 同样 `cached ?? fill`，也不比对。⇒ **任何**同路径内容变更都会命中陈旧缓存，与 mtime 是否变化无关。
- mtime 沿用源：`vfs-tree-copy.ts:238`（file 载体）、`:208`（目录载体），与 spec 一致（已 grep 全文件 `mtimeMs` 得 193/208/238 三处）。
- 进程内 `workplace-view-cache` 靠签名读时校验自失效（`workplace-view-cache.ts:11-13, 105-129`）⇒ 不需要额外失效钩子，spec 未提但不算漏。
- 回归线实存性：`test/workplace/template-pull.test.ts`（114 行，**恰 4 条 `it`**，spec「4 现有 + 3 新增 = 7」口径对）、`test/vfs/clear-session-prompt-caches.test.ts`（3 条 `it`，`:104` 确为 `assert.doesNotReject(clearSessionPromptCaches(...))`）、`test/infra/tokenizer/prompt-token-invalidation.test.ts:313`（「导入对齐（clearSessionPromptCaches）后 KKV 行被清」逐字命中）。

### B1-6 复核要点

- 残余病灶复核成立：`agent-runner.ts:604-606` 每 step 独立 `await this.deps.listVisibleSessionMessages()`，无 memo；装配 `assemble-agent-runner-deps.ts:73-76` 走 `listBySession(sessionId, {includeHidden:false})`；读口 21 列（`sqlite-message.repository.ts:28`，逐列数过 = 21）；消费方 `gemini-content-mapper.ts:54-71` 只取 `block.id` / `block.name`，`:334-341` 只做查找源选择。行号与 ledger 一致，无漂移。
- sessionId 同源核对成立：主 `run-agent-turn.ts:899` `new ChatAgentSession(runtime.messages, scope.sessionId)` 与 `:911/:925` `sessionId: scope.sessionId`；子 `:1252-1256` `ChatAgentSession(runtime.messages, childSessionId, parentSessionId)` 与 `:1268/:1383` `sessionId: childSessionId`（四处逐行读过）。
- `:604` 与 `:413` 之间**唯一**的 chat_message 写入是 `:553` 的 `runCompaction`（hideRange）——step 内 append 发生在请求之后（`:708` assistant append / 工具结果 append）。这是判定 memo 语义的关键事实，spec 未点出。
- 依赖闭合：RT-02 在 `wave-a.md` A1 存在，`§9.2` 明写「RT-02 必须先落或与 RT-01 同 PR」，与本条依赖声明一致 ✅。但 RT-02 修法（`:413` 取 `visible.length` 透传）与本条「memo 复用」在同一步循环体内语义打架，见 must-fix #1。
- 终裁一致性：`ledger-v2.md:549`（§8.1 终裁）「修法不变（memo+失效范式，或 tool_use 专查读口）」+ 「RT-02 必须先落」——本条两条都写了 ✅，与终裁无冲突。

---

## 2 · 三重点核查结论

### 重点① RT-04 的 `validateAgentPromptLayout` 前置校验是否两处循环都写全

**结论：写全了，且收敛点判断正确。**

`configToWire`（`project-agent-config.schema.ts:29-36`）自身没有块名映射循环，它转调 `agentDefinitionSchema.toWire(config.definition)`，而 `toWire` 就是 `definitionToDocument`（`agent-definition.schema.ts:279` 的 `Object.assign(…, { toWire: definitionToDocument })`）。全仓 `toWire` 调用点只有 `validate-agent-definition.ts:89` 与 `project-agent-config.schema.ts:33` 两处，再向上是 `project.service.ts:84` / `:237`。所以「在 `definitionToDocument` 头部插一次校验」= 一处改动同时封住 ledger 记的两份塌缩，spec 不在 `configToWire` 重复插桩的判断是对的（重复插桩 = 将来改一处忘一处）。

另外确认没有**第三份**同款塌缩：全仓 `[block.name] =` 只出现在 `agent-definition.schema.ts:224/228` 与 `validate-agent-prompt-layout.ts:347/351`（后者在 `validateAgentPromptLayout` 内部，本次会成为先执行的那道，等于自动加固）。

spec 要求「`configToWire` 侧不改代码但必须有独立用例」这条也站得住：该链确实有自己的失败模式（`mode:"custom"` 时 definition 走 `mergeAgentConfigPatch` 拼出来的对象，可能不经 `validateAgentDefinition`）。

### 重点② RT-08 事务提交后清缓存与 RULE「导入缓存对齐」helper 的关系

**结论：应当复用 `clearSessionPromptCaches`，spec 的选择正确。**

RULE「导入缓存对齐（session 导入三件套）」把口径写得很死：清 `rule_snapshot` + `file_cache` 两域、失效 prompt token cache，走 helper 整体 try/catch 吞错 + `console.warn`；并写明「置位/压缩裸 await，导入走 helper」。模板拉取是 session scope 的整树覆盖（文件内容 + 路径树 + 规则全变），与角色卡导入 / ZIP 导入同族，**复用 helper 是唯一正确解**——另写一份就会重演「同一口径两份实现、改一处忘一处」。spec 明确「不要改 helper 的错误口径」「不要改构造函数签名」也都对（helper 现签名 `(sessionId, sessionKkv)`；`DefaultTemplatePullService` 只接 `conn`，在方法内 `createSessionKkvService(this.conn)` 即可，调用方 `session.service.ts:250/257` 与工厂 `create-template-pull-service.ts:17` 零改动）。

我额外核了两处 spec 没写、但确认**不构成漏项**的面：
- 进程内 `workplace-view-cache`（L1）靠 vfs/规则签名读时比对自失效（`workplace-view-cache.ts:105-129`），模板整树替换必然改签名 ⇒ 自动重算，不需要钩子。
- `chat-token-estimate-memo`（token chip 记忆）键含消息摘要 + workplace 指纹 + layout 指纹，正文/前缀一变即 miss ⇒ 自动失效。

一处**需要修正的写法**：RULE 那句「同 mtime 内容变更」在本条里其实不是必要条件（见下），spec 的 T-P3 说明把它当成了「自然形态是弱化版」，这是**反的**。

### 重点③ RT-01 的 memo 失效点设计是否覆盖 RULE 全部失效类、纯追加不失效口径是否与 RULE 一致

**结论：口径方向一致（run 内作用域 + 纯追加不失效），但 memo 的复用语义设计有致命错，且验收无牙。**

**(a) 失效类覆盖 —— 覆盖得住，但理由要补写。** RULE 列的六类失效（删除 / 改写 / 隐藏 / 置位 / 导入 / 切模型）是**会话生命周期级**缓存（API prompt token 基线）的口径；本条的 memo 若锚在 `run()` 内（spec `:521` 的写法正确、`:530` 明确拒绝放进 `assemble-agent-runner-deps` 单例层），那么跨 run 才可能发生的置位 / 导入 / 切模型**天然被作用域排除**——这一点 spec 结论对但没写出来，实施者容易误以为要再补失效钩子。run 内真正可能发生的只有两类：纯追加（assistant / tool_result）与压缩隐藏（`:553` `runCompaction`）。回滚/改写（`message.service.ts:220` 那一族）都伴随截尾或发生在 run 之间，seq 集合必然变化，被「后缀扩展」判据自然捕获。**结论：覆盖面无洞，但必须在 spec 里补一句「跨 run 失效类由 run 作用域排除」**，否则实施者可能过度加钩子。

**(b) 纯追加不失效口径 —— 与 RULE 一致 ✅。** RULE「消息纯追加不失效 API 基线」的精神（追加可由增量覆盖、不必失效）在本条沿用为「可见集是 memo 的纯后缀扩展 ⇒ 不重读」，方向一致。

**(c) 但 memo 的复用语义反了 —— 这是阻断项。** spec 写的是「复用 memo ⇒ 直接把 `memo.messages` 当 `toolUseLookupMessages`」。而 memo 存的是**上一步 `:606` 那次读的快照**，它在时间上**早于**上一步执行期间追加的 assistant(tool_use) 与 tool_result 消息。逐步推：

- step 0：`visible_0 = [user1]`，`read_0 = [user1]`，`memo := read_0`。
- 请求返回 tool_use A → 追加 `assistant(A)` + `tool_result(A)`。
- step 1：`visible_1 = [user1, assistantA, toolResultA]`。判据「`visible_1` 是 `memo` 的纯后缀扩展」**成立**（首元素 id/seq 相同、长度 ≥）⇒ 按 spec 复用 memo ⇒ `toolUseLookupMessages = [user1]`。
- 而 gemini 的 `buildToolUseLookup` 需要的是 **`assistantA` 里 tool_use A 的 id→name**，正是为了给 `tool_result(A)` 解析 `functionResponse.name`。memo 里没有 A ⇒ `resolveFunctionNameOrNull(A)` 返回 null ⇒ 该 tool_result 走 `:113-115` 的孤儿纯文本兜底 ⇒ **出站 wire 与今天不同**（少了 functionResponse / functionCall 配对）。

这条缺陷**有既有回归线当场作证**：`test/service/agent/read-ref-production-smoke.test.ts:288-294` 断言 `lookups[1]` 必须含 `"tu-rrsmoke"`（正是第 1 轮 tool_use 的 id）。按 spec 的 memo 语义，step 1 的 lookup 源是 `read_0`，不含该 id ⇒ 该回归直接红。spec 把它列在回归线里，却没发现自己的修法会把它打红。

根因是 spec 把「省掉第二次读」当成了目标，却没意识到 `:413` 的 `visible` **本身就是同一张表、同 sessionId、同 filter、同 ORDER BY seq 的全量可见集**——第二次读存在的唯一理由是纳入 `:553` 压缩产物（这正是 `:603` 注释「懒求值放在这里是为了纳入本 step 的压缩产物」的本意）。所以正确修法是：

```
stepCompactionEmitted === false  →  toolUseLookupMessages = visible（零额外读）
stepCompactionEmitted === true   →  保持今天的一次 listVisibleSessionMessages() 读
```

`memo` 这个中间态根本不需要；「后缀扩展判据」也不需要（判据要判的东西已经被 `stepCompactionEmitted` 这个现成布尔量覆盖了，且判据本身比对了错误的快照时点——`visible` 是 `:413` 压缩**前**的，memo 是上一步压缩**后**的，两者不在同一时间基准上）。

**(d) 验收无牙。** 断言 A（计数器 = 1）在坏实现下**照样绿**（坏实现确实只读一次）；断言 C 跑的是 `gemini-content-mapper.test.ts:386` 的 `W2 收窄等价`——那是纯函数的静态等价语料，**不经过 runner**，对 memo 语义零覆盖；断言 B 只比「压缩后全量重读」，坏实现若在纯追加路径上错，压缩路径反而可能是对的。⇒ spec 自带的三条断言**没有一条能咬住 (c) 这个缺陷**（能咬住的只有它自己列在回归线里的 `read-ref-production-smoke.test.ts:288`）。按 RULE「牙齿三判据」第 ① 条，这套验收不通过。

---

## 3 · must-fix 清单表

| # | 条目 | 级别 | 问题 | 必须怎么改 |
|---|---|---|---|---|
| **MF-1** | B1-6 | **P1 阻断** | memo 复用上一 step 的读快照，丢失本 step 追加的 `assistant(tool_use)` / `tool_result` ⇒ gemini `functionResponse.name` 解析失效、出站 wire 变化；与 `read-ref-production-smoke.test.ts:288-294` 直接冲突 | 删掉 memo 与「后缀扩展」判据，改为：压缩未触发（`stepCompactionEmitted === false`）时 `toolUseLookupMessages = visible`（建议在 `:413` 另存一份 prepare 之前的原始数组引用，避免依赖 `:449` 已被 prepare 覆写的同名变量），压缩触发时保留今天的一次 `listVisibleSessionMessages()`。修法与 RT-02（wave-a A1）同在 `:413` 一带取数，落地后需在两处 spec 里统一表述，避免「RT-02 取 length / RT-01 取数组」被实施者读成两次读 |
| **MF-2** | B1-6 | P1 | 验收无牙：断言 A（读次数）在坏实现下恒绿、断言 C 是不过 runner 的静态语料、断言 B 只覆盖压缩路径 | 新增用例把 `read-ref-production-smoke.test.ts:288-294` 的形态镜像进新用例：多 step run 中，**每一步**的 `toolUseLookupMessages` 都必须含**本轮及此前各轮**追加的 tool_use id；反向自检改为「把 `toolUseLookupMessages` 换回 `visible[0]`（只取首条）」必须红。断言 A 的期望值随 MF-1 改为「无压缩的 N step run 中该读口调用次数 = 0」（或按最终修法定死并写明推导） |
| **MF-3** | B1-6 | P2 | 未说明「RULE 六类失效中，置位/导入/切模型由 run 作用域天然排除」，实施者可能反向加多余失效钩子 | 在「失效判据」节补一句作用域论证：memo 锚在 `run()` 内 ⇒ 跨 run 失效类不适用；run 内仅「追加（不失效）」与「压缩隐藏（失效）」两类。口径与 RULE「纯追加不失效」显式对齐 |
| **MF-4** | B1-5 | P2 | 回归线路径写错：`packages/core/test/vfs/workplace-view-cache.test.ts` 与 `workplace-view-cache-smart-sig.test.ts` **不存在**，实际在 `packages/core/test/workplace/` 下 | 改正为 `packages/core/test/workplace/workplace-view-cache.test.ts` / `...-smart-sig.test.ts`（同条里的 `test/vfs/clear-session-prompt-caches.test.ts` 路径正确，保留） |
| **MF-5** | B1-5 | P2 | T-P3 的 mtime 论证与代码相反：`load-or-fill-file-cache.ts:42-58` 与 `assemble-workplace-display.ts:171-187` **完全不做 mtime 校验**，所以「自然形态（mtime 变化）」不是弱化版，而**就是最强形态**——同路径正文一改就命中陈旧缓存 | 删掉「显式指定同一 mtime / 自然形态是弱化版 / 需在注释里写明弱化原因」这段；把 T-P3 直接定死为自然形态：建会话 → 拉取（建立 file_cache）→ 项目侧改 A 的正文 → 再拉取 → 组装断言前缀含新正文。顺带在病症节把「同 mtime 内容变」这个限定去掉，避免读者误以为不同 mtime 就安全 |

---

## 4 · 结论

**组 B：No-Go。**

一句话理由：**RT-04 与 RT-08 两条病症复核成立、修法可行、依赖闭合，只剩三处文档级 must-fix（MF-4/MF-5 与 B1-4 的一条措辞澄清）；而 RT-01 的 memo 复用语义把「上一步读到的快照」当本步查找源，会丢掉本轮追加的 tool_use id、改变 gemini 出站 wire 并打红既有回归 `read-ref-production-smoke.test.ts:288`，且自带的三条验收断言一条都咬不住它——这条必须先按 MF-1/MF-2 改写（正确修法比 memo 更简单：压缩未触发时直接复用 `:413` 的 `visible`，压缩触发时才读），才能谈 execute-ready。**

（Go 的两条建议与 MF-1/MF-2 同批 doc-fix；MF-3/MF-4/MF-5 可在同一轮一并落。）

---

## 5 · 勘误（R2-15）

> **勘误 1 · B1-4 的「1 条 must-fix 澄清」是本报告的笔误，已由 judge-r1 裁定作废。**
> 裁定依据：`judge-r1.md` B 节 B4（基线 `fe79b781`）。
> 本报告 §1 的 verdict 表给 B1-4 标了「Go（含 1 条 must-fix 澄清）」、§4 结论也写了
> 「MF-4/MF-5 与 B1-4 的一条措辞澄清」——但**本报告全文没有任何一条归属 B1-4 的 must-fix**：
> §3 的 must-fix 清单表只有 MF-1…MF-5 五条，其中 MF-1/MF-2/MF-3 归 B1-6、MF-4/MF-5 归 B1-5，**无一条归 B1-4**；
> §1.3「B1-4 复核要点」七条全是正面结论（「三调用点唯一收敛成立且已实测」
> 「spec 的收敛判断正确、完备」「不新增拒绝面——spec 结论正确」）；
> §2 重点① 对 B1-4 的结论是「**写全了，且收敛点判断正确**」。
> ⇒ verdict 表与 §2/§3 自相矛盾，且该「澄清」**没有原文可依**。judge 已裁定**作废**，
> `fix-spec/wave-b-core1.md` 的 B1-4 七要素**原文有效、逐字不动**。
> **后续任何轮次都不得再拿这条幽灵 must-fix 追问 B1-4。**

> **勘误 2 · §4 结论句「只剩三处文档级 must-fix」应为两处。**
> 剔除上面这条不存在的「B1-4 的措辞澄清」后，Go 的两条（RT-04 / RT-08）只剩
> **MF-4、MF-5 两处文档级 must-fix**（均归 B1-5）。RT-04 一侧**无任何待改项**。
> 这条勘误由勘误 1 派生，两条须一并读取。

> **勘误 3 · §4 结论里 Go 两条的定性不变。**
> 「RT-04 与 RT-08 两条病症复核成立、修法可行、依赖闭合」这句**依然成立**——
> 本次作废的只是「B1-4 有一条措辞澄清」这个不存在的待改项，不涉及任何病症复核结论或修法。