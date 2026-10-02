---
zone: wave-c1 · 组 B（N-P1-06 / N-P1-07 smart-sort 事务 + §6 #8 gemini 同名并行 + §6 #9 max_tokens 硬上限 + §6 #10 thinkingSignature）
agent: sr1-c1-b（readonly reviewer · 条目组粒度）
files_scanned: >
  fix-spec/wave-c1.md（C1-6/C1-7/C1-8/C1-9/C1-10 + 注记 N-1~N-7）、
  ledger-v2.md（§2.5 N-P1-06/07、§6 第 8/9/10 行、§10 Wave C 行）、SPEC.md §2/§3、state.md、
  docs/apm/RULE.md（事务内同步执行 / AsyncMutex 不可重入 / 出站合并 / thinking 相关条 / 验收三牙齿 / 计数实测条）、
  packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts、
  .../smart-sort-rule/create-smart-sort-rule.service.ts、
  .../domain/smart-sort-rule/repositories/{smart-sort-rule.port.ts,impl/sqlite-smart-sort-rule.repository.ts}、
  .../infra/llm-protocol/logic/{gemini-sse-parser.ts,gemini-content-mapper.ts,stream-partial-blocks.ts,anthropic-sse-parser.ts,openai-content-mapper.ts,resolve-thinking-wire.ts,thinking-level-presets.ts,apply-thinking-to-body.ts}、
  .../infra/llm-protocol/impl/anthropic.adapter.ts、
  .../domain/provider/{logic/thinking-level-presets.ts,logic/resolve-thinking-wire.ts,model/protocol-sampling-defaults.ts,model/default-saved-model-settings.ts}、
  .../infra/serialization/{decode.ts,parse-text 所在模块}、.../errors/{config-decode-errors.ts,smart-sort-rule-errors.ts}、
  .../common/normalize-yaml-error.ts、.../service/provider/impl/model-request.service.ts、
  .../service/workplace/create-workplace-service.ts、.../service/agent/impl/agent-runner.ts、
  packages/tdbc-driver-better-sqlite3/src/{connection.ts,mutex.ts}、packages/tdbc-driver-op-sqlite/src/connection.ts、
  packages/core/test/helpers/sql-counting-connection.ts、
  packages/core/test/{smart-sort-rule/smart-sort-rule.service.test.ts,infra/llm-protocol/*（含 gemini/anthropic/openai partial 与 sse parser、stream-partial-blocks）、provider/{thinking-level-presets.test.ts,resolve-thinking-wire.test.ts,model-request-sampling.test.ts}}、
  apps/desktop/src/main/services/smart-sort-rule-yaml.service.ts、apps/mobile/src/services/smart-sort-rule-yaml.service.ts
---

## 摘要

本组五条 fix-spec（smart-sort 五/六个多语句入口包单事务 + `renumber` 下沉批量 UPDATE；gemini 同名并行
functionCall 归并键塌陷；anthropic `max_tokens: 4096` 吃掉 thinking 预算；`stream-partial-blocks` 丢
`thinkingSignature`）的**病症全部在位、根因机理经第三源独立重推导全部成立**，修法方向正确，五方法清单与
`renumber` 三处复用齐备，依赖闭合、回归线实存。但存在 **18 项 must-fix（11 项中危）**，其中三项会直接
让实现者卡死或写出不可满足/恒红的验收（C1-7 I4、C1-9 漏一条必红断言、C1-10 I2/I3 在 signature-only 输入下
自相矛盾），另有 C1-8 / C1-10 各一处**机理与计数层面的事实错误**。**本组当前 No-Go，doc-fix 一轮后可 Go。**

---

## 1 · 逐条 verdict 表

| # | 条目 | 病症在位（第三源复核） | 七要素完备 | 修法可行完备 | 验收可测 | 依赖闭合 | 回归线实存 | verdict |
|---|---|---|---|---|---|---|---|---|
| **C1-6** | N-P1-06 `importRules` 无事务 | ✅ `service.ts:246-250` 逐字为 `deleteAll()` + `for … insert`；`deps:56-60` 确无 `conn`；repo 六方法全为单条 `executeTemplate`（insert `:75-99`、deleteAll `:138-145`、update `:101-127`） | ✅ 修法/验收/测试/回归/依赖齐全 | ⚠️ 修法 4 判据不成立（漏 `ConfigDecodeError`，见 M1-1） | ⚠️ I1/I2/I3/I4 有牙且可测；I5 依赖 M1-1 先修 | ✅ 无前置；C1-7 同 PR 已写死 | ✅ 全部实存 | **条件 Go**（1 中危 + 2 低） |
| **C1-7** | N-P1-07 五处多语句 + `renumber` 逐条 | ✅ `:132-147`/`:163-170`/`:253-288`/`:372-382` **全部一字不差**；三处复用点 `moveRule:199`、`reorderRules:223`、`resetDefaults:287` 逐个命中；`:371` 「时间戳不刷」注释在位 | ✅ | ⚠️ 修法 2 代码样例与散文互斥（M2-1）；R1 故障模式描述错（M2-3） | ❌ **I4 用既有 helper 不可满足**（M2-2）；I1/I2/I3/I6/I7/I8/I9 有牙 | ✅ 依赖 C1-6 已声明 | ✅ 全实存 | **条件 Go**（3 中危 + 2 低） |
| **C1-8** | §6 #8 gemini 同名并行塌陷 | ✅ `gemini-sse-parser.ts:122` 逐字 `typeof fc.id === "string" && fc.id !== "" ? fc.id : fc.name`；`:133-136` 为赋值非累加；非流式 `:262-265` 逐字 `${name}-${blocks.length}`；塌陷机理我独立重推导闭合 | ✅ | ✅ 方向正确（`name#ordinal` + 每 chunk 同名序号） | ⚠️ I1/I2/I3/I4/I5/I6 有牙；**缺「两同名调用分处两 chunk」用例**（M3-2） | ✅ 无前置 | ✅ 全实存 | **条件 Go**（2 中危 + 1 中危待裁） |
| **C1-9** | §6 #9 `max_tokens: 4096` | ✅ 全链重算闭合：默认 `sampling:{enabled:false}` + `thinkingLevel:"high"`（`default-saved-model-settings.ts:27-28`）→ `model-request.service.ts:186` 不下发 sampling → `anthropic.adapter.ts:134` 保持 4096 → `thinking-level-presets.ts:58-62` 钳出 **4095（三档全同）** → 可见正文剩 **1 token** | ✅ | ✅ 同源常量 + 0.8 比例钳制，I1/I2/I5/I6 算术逐个复算通过 | ❌ **I7 漏一条必红既有断言**（M4-1）；I4 的 fetch 基座指错文件（M4-2） | ✅ | ✅ 全实存 | **条件 Go**（2 中危 + 2 低） |
| **C1-10** | §6 #10 partial 丢签名 | ✅ `stream-partial-blocks.ts:13-17`/`:36-37`/`:42-48` 逐字无签名；`content-block.ts:40/:197/:204` 三种块已有字段；gemini `:268-275` 带出、`:390-396` 截断；anthropic `:397-409` 丢弃、`:410-418` otherBlocks 原样 —— 全部在位 | ✅ | ⚠️ 修法 2/3/4 正确但不完整（M5-1）；修法 6 事实错误（M5-2） | ❌ **I2/I3 在 signature-only 输入下不可满足**（M5-1）；I1/I4/I5/I6 有牙 | ✅ | ✅ 全实存 | **条件 Go**（2 中危 + 1 低） |

**计数**：条件 Go ×5 / No-Go ×0（但全组整体 **No-Go**，见 §4）。must-fix 合计 **18**（中危 11、低 7）。

---

## 2 · 三源复核结论（第二源复核入账的三条协议条，我做第三源独立复核）

台账/第二源的三条均已入账为 P1。我在 `fe79b781` 上**只读代码**独立重推导（未读 raw 报告正文作为依据），
结论如下：

### 2.1 §6 #8 —— **成立**，机理闭合；但 fix-spec 的下游危害链两处机理错误

**独立重推导**：`mergeFunctionCallPart`（`gemini-sse-parser.ts:113-143`）以 `fc.id ?? fc.name` 为键写入
`state.functionCalls`（Map）；第二个同名无 id 调用命中同一条累加器，`:134-135` 是
`if (newJson !== acc.argsJson) acc.argsJson = newJson` —— **整体赋值**。故 `functionCallsToToolUses`
（`:226-278`）只产出 **1 条** `tool_use`，参数取**最后一次**。塌陷机理确认。

**但 spec 的两条下游陈述与代码不符**：

1. **「流事件发了两次（id 相同）」错**。`tryEmitGeminiToolUseIfComplete:96-98` 有
   `if (state.emittedFunctionCallKeys.has(key)) return;` 守卫，`:109` 才写入集合 ⇒ 并行的第二个调用
   `tryEmit` 被抑制，流事件**只发一次**。且该唯一事件携带的是**第一次**的 args 快照，而落库 block 携带
   **最后一次** —— 这个「事件与落库参数不一致」的现象 spec 完全没提（应在 I2 附近补一句口径）。
2. **「`:807 degradedById` 按 id 建 Map ⇒ 同 id 只执行一次」错**。`agent-runner.ts:825-827` 的
   `degradedById` 只装 `result.degradedToolCalls`（**参数 JSON 非法**的降级调用），不是去重表；
   `:831-848` 的可执行循环遍历**每一个** `tool_use` block 塞进 `runnableCalls`，**没有任何 id 去重**。
   真正的危害是 `blocks` 只剩一条 ⇒ 有一个调用**根本没被产出**（而不是「Map 吃掉一条」）。R3 的推理
   「不改则 Map 只剩一条、少执行一次」继承同一错误，且若照它推理可能误导实现者去加去重。
   行号也漂移：`toolUses` 的 filter 在 `:781-784`（spec 写 `:763`），`degradedById` 在 `:825`（spec 写 `:807`）。

**修法可行性**：`name#ordinal` + 「同一 chunk 内同名出现序」的方向成立——既有用例
`gemini-sse-parser.test.ts:109`「参数增长时累积 args」证明本仓既有 wire 模型就是「每 chunk 全量 parts 快照」，
单调用跨 chunk 的 ordinal 恒为 0 ⇒ key 稳定、累加器不被拆开（I2 有牙）。**残余风险**：该口径只在全量快照
语义下防塌缩；若供应商标成增量 part，两个同名调用分处两个 chunk 时**都会拿到 ordinal 0 → 再次塌缩**。
现有 I1（同 chunk 两调用）/I2（单调用增长）**都抓不到这个形态**，I2 在增量语义下对双调用恒绿（M3-2）。

### 2.2 §6 #9 —— **成立，且后果比台账更明确**；算术逐项复算通过

台账写「thinking budget 会超 4096」不准确（实际 4095，卡在 4096 之下）。我复算的真实后果是
**可见正文只剩 1 token**，spec 已正确改写。完整链（每跳实读）：

```
default-saved-model-settings.ts:27-28   sampling:{enabled:false} + thinkingLevel:"high"
  → model-request.service.ts:186        enabled 为假 ⇒ 不下发 req.sampling
  → anthropic.adapter.ts:134            body.max_tokens 保持 4096（:144 的覆盖分支进不去）
  → thinking-level-presets.ts:58-62     min(preset, max(1, 4096-1))
      low  min(4096, 4095) = 4095
      med  min(8192, 4095) = 4095      ← 三档全同，台账的「low 档也 4096」确认
      high min(16384,4095) = 4095
  → apply-thinking-to-body.ts:22-25     只是把 budget 写进 body（旁观者，台账归错因）
  ⇒ 4096 - 4095 = 1 token 可见正文
```

`test/provider/thinking-level-presets.test.ts:60` 的 `4095` 逐字在位，是被锁死的病灶。
**修法算术复核**：`16000 × 0.8 = 12800`；三档 `min(preset, 12800)` = **4096 / 8192 / 12800**（spec I1 ✓），
余额 11904 / 7808 / **3200**（spec I2 的 ≥3200 恰好取在最小值 ✓）；I5 `floor(8000×0.8)=6400` ✓；
I6 `100→80`、`1→1`（`Math.max(1, …)` 保底）✓。**算术无误。**

### 2.3 §6 #10 —— **成立**（纯贯通缺失）；但 fix-spec 的「只有两个 partial 收尾函数」计数错误

`StreamPartialToolUse`（`stream-partial-blocks.ts:13-17`）确实无 `thinkingSignature`；`:36-37` 的 thinking
push、`:42-48` 的 tool_use push 都裸奔；而 `content-block.ts:40/:197/:204` 三种块**早已有该字段** ⇒ 模型不缺、
贯通缺。签名来源两条链（gemini `FunctionCallAccumulator.thinkingSignature:32` → `:268-275` → `:390-396`
被类型截断；anthropic `state.blocks` 自带 → `:404-409` 的 `.map(b => ({id,name,input}))` 丢弃）逐处确认。

**计数错误**：修法 6 与 N-2 复核表都写「raw 说的三个 partial 收尾函数在 `fe79b781` 上实际是两个」，
并以「grep `openai-sse-parser.ts` 无 partial 路径」为据。**grep 目标文件就错了，且计数为误**——
`buildStreamPartialBlocks` 有**三个**调用方：`anthropic-sse-parser.ts:414`、`gemini-sse-parser.ts:391`、
`openai-content-mapper.ts:469`（`openAiStreamAccumulatorsToPartialBlocks:460`）。
「openai 无需改」的**结论仍成立**（`openai-content-mapper.ts` / `openai.adapter.ts` 内 grep `thinkingSignature`
零命中，OpenAI 侧无签名概念），但依据与计数必须改写，并把 openai 调用点列为「已查、无需改」。

---

## 3 · must-fix 清单

| ID | 条目 | 级别 | 问题（file:line + 实测） | 建议修法 |
|---|---|---|---|---|
| **M1-1** | C1-6 | **中** | 修法 4 的判据 `error instanceof SmartSortRuleError \|\| error.name === "ZodError"` **漏掉最主要的一类**：`parseText`（`infra/serialization`）对 **YAML 语法错**与 `decode()`（`infra/serialization/decode.ts`）对 **schema 校验错**都抛 `ConfigDecodeError("INVALID_SCHEMA")`（`errors/config-decode-errors.ts:14-19`）。按 spec 写，「YAML 无效」标签会**从最常见的失败路径上消失**（功能回归）。且 `ConfigDecodeError` **未在任何 `packages/core/src/public/*` 导出**（已 grep 全部 public 入口零命中）⇒ desktop/mobile 侧按该判据实现需要新增 core 公开导出面，spec 未提。 | 二选一并写进 spec：①**反转判据**——只让 `TdbcError` / 事务类错误绕过 `normalizeYamlError`，其余照旧套前缀（改动最小、无新导出面）；②新增 `STORAGE` 子类（spec 已列备选）并把它列为主案，`ConfigDecodeError` 只需留在「套前缀」侧。 |
| **M1-2** | C1-6 | 低 | 证据块行号错位：spec 写 `56/57/58`（deps 三行），实际 `:58` 是 JSDoc 注释行、`builtinSeed` 在 `:59`、`}` 在 `:60`。 | 改为 `:56-60` 并保留注释行。 |
| **M1-3** | C1-6 | 低 | 测试注入缝表述不准：「`createSmartSortRuleService(conn)` 的 deps 里多注入一个 `createRules`」——该工厂只收 `conn`、内部自造 deps（`create-smart-sort-rule.service.ts:18-25`），无法注入。 | 写明测试须直接 `new DefaultSmartSortRuleService({ conn, createRules, builtinSeed })`（类可从 `@/service/smart-sort-rule/impl/smart-sort-rule.service.js` 引，仓库内唯一装配点只有工厂一处，改 deps 面影响可控）。 |
| **M2-1** | C1-7 | **中** | 修法 2 **代码样例与同段散文互斥**：样例签名 `renumber(rules, orderedIds)` 内部仍 `await rules.listOrdered()`，而散文写「**不再自己 listOrdered**（由调用方传入已读到的列表，避免事务内多一次读）」，签名里根本没有传列表的槽位。照样例实现会让修法 3/4/5 的「`listOrdered()` 留在事务外读」全部落空（多一次事务内读，且与 R4 的返回值口径打架）。 | 签名改为 `renumber(rules, current: readonly SmartSortRule[], orderedIds)`，删掉内部 `listOrdered()`；三处调用方各自传入已在事务外读到的列表。 |
| **M2-2** | C1-7 | **中** | I4「记录每条写语句的**连接标识**……用 `sql-counting-connection.ts` 观测即可……不得新造 mock 连接」**不可满足**：`test/helpers/sql-counting-connection.ts:59-67/78-82/151-175` 的 `SqlCounter.record(via, sql)` 只记 `(sql, kind, via)`，**没有任何连接身份**，根连接与 tx 连接的语句在计数里完全不可区分。更糟：better-sqlite3 的 `transaction()`（`packages/tdbc-driver-better-sqlite3/src/connection.ts:46-76`）在整个 async 回调期间**持有 `AsyncMutex`**（`mutex.ts:16-23` 是非重入 promise 链，op-sqlite `connection.ts:59` 同构）⇒ 真发生「事务内经根连接写」，测试不是变红而是**永久死锁**（挂住），违反 RULE「验收三牙齿」的可观测性要求。 | 用**已在计划内的 `createRules` 注入缝**做连接身份断言：装饰仓储记录「自己是用哪个 conn 造的」，断言事务内建出的每个仓储拿到的都是 tx 句柄（对象同一性），并同时断言工厂调用次数；或给 `SqlCounter.record` 加一个 `connTag` 字段（扩展既有装饰器，不算新造 mock 连接）。 |
| **M2-3** | C1-7 / C1-6 | **中** | R1 把故障模式写错：修法 7 说「否则会经 `this.rules()` 拿根连接的事务外仓储 ⇒ **事务外写，等于没包**」。实测是**死锁**（两驱动皆然，见 M2-2 引证）。C1-6 R1 的嵌套事务兜底讨论同理未提死锁面。 | 改写为「根连接写入 = AsyncMutex 不可重入 ⇒ 永久挂起（非「事务外写」）」，并在代码注释里把这一条写成硬约束。 |
| **M2-4** | C1-7 | 低 | I8 称既有套件「4 个 describe / **18** 条用例」：describe 4 个 ✓，但 `it(` 实测 **19** 条（`:44/65/86/116/132/154/168/192/219/248/271/292/306/358/379/413/423/433/457`）。 | 改为 19（RULE「条数类结论一律实测复核」）。 |
| **M2-5** | C1-7 / C1-6 | 低 | 台账 `ledger-v2.md` §10 Wave C 行（`:466`）**明确要求**本组「在 service 层加一条『跨 N 次 repo 调用必须包事务』的评审约定」；对 wave-c1.md 全文 grep「评审约定 / 跨 N 次 / 必须包事务」**零命中** ⇒ 该项未承接。 | 在 C1-6 或 C1-7 末尾加一条分片级注记（约定文本 + 落点建议：service JSDoc 或 `docs/apm/RULE.md` 待主代理决定）。 |
| **M3-1** | C1-8 | **中** | 证据链与 R3 的机理陈述错误（详见 §2.1）：①「流事件发了两次」——实际被 `emittedFunctionCallKeys` 抑制为**一次**，且携带首次 args；②「`degradedById` 按 id 建 Map ⇒ 同 id 只执行一次」——该 Map 只装降级调用，可执行循环无 id 去重；③ 行号 `:763`/`:807` 实际为 `:781-784`/`:825`。 | 改写危害链为「`blocks` 塌成一条 ⇒ 有一个调用从未被产出；流事件只发一次且参数取首次快照（与落库 block 的末次快照不一致）」；行号改正；R3 的理由换成「I1 保证 id 互异 ⇒ `blocks` 产出两条 ⇒ 两条都进 `runnableCalls`（`:831-848` 无去重）」。 |
| **M3-2** | C1-8 | **中** | 验收缺口：口径只覆盖「同 chunk 两个同名调用」（I1）与「单调用跨 chunk 增长」（I2），**没有**「两个同名调用分散在两个 chunk」的用例——而这恰是 ordinal 口径唯一会再次塌缩的形态（增量 part 语义下两者 ordinal 都是 0）。R1 声称「I2 是这条的牙齿」不成立：I2 在该形态下恒绿。 | 追加用例 `T-GPSN5 两个同名无 id 调用分处两个 chunk → 期望 2 条 tool_use`；若判定该形态不可观测/不可能，则在代码注释与 PR 描述里明写「本口径依赖全量快照形态；增量形态下同名分 chunk 调用仍会塌缩，届时需改用全局序号 + part 位置」并把 R1 的牙齿改为 I5。 |
| **M3-3** | C1-8 | **中（待 judge）** | 修法 4 改的是**非流式**路径（`gemini-content-mapper.ts:262-265`），而该路径**无缺陷**——`blocks.length` 单调递增，两个同名调用必然得到不同 id（我已逐行走查 `:266-275`），塌陷只发生在流式侧。改动它是纯 wire 可见变更（同会话新旧两种 id 形态混存），R2 自承「Gemini 对 `functionCall.id` 容忍度本轮未实测」。 | 建议把 spec 现有**备选案升为默认案**（只改流式侧），把「两侧同构」降为可选；若 judge 坚持两侧对齐，则把 R2 的真机验证从「建议」升为**阻塞前置**（未跑通不得合）。 |
| **M4-1** | C1-9 | **中** | I7「既有断言必须改」清单**漏一条必红**：`packages/core/test/provider/resolve-thinking-wire.test.ts:10` `assert.equal(resolveEffectiveMaxTokens({ enabled: false }, "anthropic"), 4096)` —— 修法 1 改同源后该值变 16000 ⇒ 必红。（同文件 `:27-39` 的 `budget < effective` 复核为 8192 < 16000，仍绿，不必动。） | I7 增列该文件 `:10`（期望改 16000），并把它纳入「改期望」清单与 PR 描述点名。 |
| **M4-2** | C1-9 | **中低** | I4/I5 与测试策略指的 fetch 基座**不存在于所指位置**：「`test/infra/llm-protocol/` 里既有的 fetch stub 基建（`anthropic-sse-parser.test.ts` 所在目录附近）」——`anthropic-sse-parser.test.ts` 根本不构造 adapter。真正现成的 body 捕获基座是 `packages/core/test/provider/model-request-sampling.test.ts`（T10 用 `mock.fn` fetch 捕获 anthropic body，`:36-61`）。 | 把 I4/I5 与新增测试文件 `test/provider/anthropic-max-tokens-budget.test.ts` 的落点改指 `test/provider/model-request-sampling.test.ts` 所在基座，并注明「复用 T10 的 captured-body 写法」。 |
| **M4-3** | C1-9 | 低 | 自身行号漂移（与「行号全部准确」的宣称不符）：钳制公式实际 `:58-62`（spec 块标 `:57-66`、正文引 `:59-62`）；`resolve-thinking-wire.ts` 第二处使用是 `:62`（spec 写 `:61`）；`Object.assign(body, req.extraBody)` 是 `:153`（spec 写 `:152-153`）。 | 三处改正；不影响任何结论（算术与病灶位置均已复核通过）。 |
| **M4-4** | C1-9 | 低（建议） | 修法 2 让 infra adapter 从 `resolve-thinking-wire.ts` 引常量，会把一个**已存在循环依赖对**（`resolve-thinking-wire ⇄ thinking-level-presets`，后者 `:11` 引前者的 `resolveEffectiveMaxTokens`）整体拖进 adapter 启动链。当前安全（const 在任何使用前完成初始化，我已走查求值序），但为一个数字付出循环暴露不划算。 | 改为 adapter 直接 `import { ANTHROPIC_SAMPLING_DEFAULTS } from "@/domain/provider/model/protocol-sampling-defaults.js"`（该文件已在 `@/domain/**` 值依赖的既有风格内），同源目标不变。 |
| **M5-1** | C1-10 | **中** | I2/I3（正常路径与中断路径的 `(type, thinkingSignature)` 序列相同）在 **signature-without-text** 输入下**不可满足**，而这正是 Anthropic Claude 4+ 的形态：`anthropic-sse-parser.ts:112-117` 的守卫是 `text !== "" \|\| signature !== ""`（无文本也建 thinking 块），gemini 正常路径同理（`:339` `thinking !== "" \|\| state.thinkingSignature != null`）；而 `buildStreamPartialBlocks:36` 只在 `thinking.trim() !== ""` 时 push。spec 的修法（给两处 push 补字段）**不覆盖这个不对称** ⇒ 实现者会撞上红的 I2/I3 而无处方。 | 二选一并写死：①把守卫放宽为 `thinking.trim() !== "" \|\| input.thinkingSignature != null`（`ThinkingBlock.text` 在 `content-block.ts:193-198` 无长度约束；模块注释里「content_json 拒绝空 text」约束的是 TextBlock）；②把 I2/I3 收窄为「对**有文本**的块序列相同」，并把该残余不对称登记为已知限制（附 R 级）。 |
| **M5-2** | C1-10（含 N-2 表） | **中** | 修法 6 与 N-2 复核表的「三个 partial 收尾函数实际是两个」**计数与依据均错**（详见 §2.3）：真实三个调用点，`openai-sse-parser.ts` 是 grep 错文件。 | 两处改写为「三个调用点：anthropic `:414`、gemini `:391`、openai-content-mapper `:469`；openai 侧已查、无 `thinkingSignature` 概念故无需改」，并把该差异写进 PR 描述（spec 原本就是这么要求的，只是数字写反）。 |
| **M5-3** | C1-10 | 低 | 修法 1 的 `StreamPartialInput` 新增 `thinkingSignature?` 后，未说明 openai 调用点（`:469-475`）既不传 `toolUses` 也不传该字段。 | JSDoc 注明「该字段仅由 gemini / anthropic 两个 partial 收尾函数提供」。 |

**另核（无需修，仅记录）**：

- **五方法清单完整**。service 的多语句写入口穷举 = `importRules`（C1-6 修法 3）、`deleteBatch`（修法 6）、
  `setEnabledBatch`（修法 7）、`moveRule`（修法 3）、`reorderRules`（修法 4）、`resetDefaults`（修法 5）
  ——台账点名的五个全在，且额外覆盖了 `moveRule`；`createRule`/`updateRule`/`setEnabled`/`deleteRule`
  均为单写入口，不需包事务，与 C1-6 I3 一致。**无遗漏。**
- **`renumber` 三处复用写清**。`:199`/`:223`/`:287` 三点均在证据里点名，三点也都在修法 3/4/5 里各自被
  包进事务；批量 `updateSortOrders` 的接口形态、CASE WHEN 形态、空数组 no-op 约定（对齐
  `message.port.ts:73-77`）、200 一片分片（对齐 `sqlite-message.repository.ts:225` 的
  `BATCH_PARAM_BUILD_CHUNK = 200`）与「不刷 `updated_at_ms`」都写到了。**除 M2-1 的签名矛盾外无缺口。**
- **事务可回滚性成立**。测试基座是真实 better-sqlite3 内存库（`novelMasterTestFixture`），驱动
  `transaction()` 走显式 BEGIN/COMMIT/ROLLBACK（`connection.ts:61-74`），C1-6 I1 / C1-7 I1 的
  「旧实现必红、新实现必绿」成立；`runInTransactionOrConn` 兜底模式在 `:91-103` 实存（C1-6 R1 引的
  `:91-103` 准确）。
- **deps 改造影响面可控**。`DefaultSmartSortRuleService` 全仓唯一构造点是工厂
  `create-smart-sort-rule.service.ts:21-24`，唯一调用点是 `create-workplace-service.ts:28`；
  工厂签名不变 ⇒ 两个 app runtime 与 CLI 零改动，spec 判断正确。
- **回归线全部实存**（逐个 Test-Path 验证）：`test/smart-sort-rule/`、`test/smart-sort/`、
  `test/bootstrap/smart-sort-rule-seed.test.ts`、`test/workplace/`、
  `apps/desktop/test/smart-sort-rules-view.test.ts`、
  `apps/mobile/__tests__/smart-sort-rule-editor-screen.test.tsx`、`test/provider/`、`test/config-forms/`、
  `test/prompt/`、`test/infra/llm-protocol/`、`test/tool/`（含 `read-tool-result-ref.test.ts`）、
  `test/agent/agent-runner*.test.ts`、`test/chat/hydrate-tool-results.test.ts`、
  `test/helpers/sql-counting-connection.ts`。唯一缺陷是**指针**（M4-2），不是路径不存在。
- **命令形态可用**。`packages/core/package.json` 的 `test:fast` 已含
  `--experimental-test-module-mocks --tsconfig tsconfig.test.json`（RULE「core 定向测试必须带 flag」
  的要求已满足）；`-- test/smart-sort-rule/` 传目录给 `node --test` 合法。
- **依赖闭合**：C1-6 → C1-7 同 PR 约束写死在两条的「依赖」栏；C1-9 ↔ C1-10 软同 PR；四条均不挂
  `blocked-by-decision(★N)`，与 `SPEC.md` §3 全局依赖图无冲突。

---

## 4 · 结论

**组 B：No-Go（doc-fix 一轮后可转 Go）。**

一句话理由：**五条病症与修法方向全部成立、清单与依赖也齐，但 C1-7 I4 用既有 helper 不可满足、C1-9 漏列
一条必红的既有断言、C1-10 I2/I3 在 signature-only 输入下自相矛盾——这三处会让实现者卡死或写出恒绿/恒红的
验收，再叠加 C1-8/C1-10 各一处机理与计数层面的事实错误，尚不满足 execute-ready。**
