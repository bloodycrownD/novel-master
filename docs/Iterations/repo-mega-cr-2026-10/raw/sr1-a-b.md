---
zone: fix-spec/wave-a · 组 B（RT-02、N-P0-01）
agent: sr1-a-b（readonly reviewer，条目组粒度）
files_scanned: packages/core/src/service/agent/impl/agent-runner.ts, chat-agent-session.ts, domain/compaction-conditions/{ports,triggers,logic}, service/compaction-conditions/create-compaction-condition-evaluator.ts, packages/core/package.json, packages/core/src/public/prompt.ts, packages/core/src/domain/prompt/logic/validate-dynamic-macros.ts, packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts, packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts, apps/mobile/src/components/agent/prompt-macro-input.ts, apps/mobile/src/web/**, apps/mobile/scripts/build-webview.mjs, apps/mobile/jest.config.js, apps/mobile/android/build.gradle, apps/mobile/webview-dist/composer-input/app.js, fix-spec/{wave-a,wave-b-core1,wave-e}.md, ledger-v2.md, docs/apm/RULE.md
baseline: HEAD=fe79b7810c0c78c48a18c76486359d7d45e253fa（实测 git log -1 核对一致）
---

# sr1-a-b · wave-a 组 B 审查报告（RT-02 + N-P0-01）

> 只读审查。行号与引文逐处亲自打开 `fe79b781` 复核；病症从代码重推导；数字全部实测。
> 口径：`docs/apm/RULE.md`「条数 / 行号 / 计数类结论一律实测复核」「性能护栏取数量级回归线」
> 「验收断言牙齿三判据」「mobile webview 改动是三层产物链」。

---

## 1 · 逐条 verdict

### 1.1 RT-02（A1）—— 结论：**NEEDS-FIX**（1 条 must-fix + 2 条 minor）

| 维度 | verdict | 复核结论 |
|---|---|---|
| 病症从代码重推导 | ✅ 成立 | 「每 step 两次独立全会话读」在代码里真实存在。`agent-runner.ts` 全文只有 **1 处** `session.list()`（`:413`，实测 grep），第二次在 `visible-floor.trigger.ts:21` |
| 证据行号/引文 | ✅ 成立（1 处 minor） | `:411 stepCompactionEmitted` / `:413 let visible = await session.list();` / `:449 visible = await prepareUserMessagesForPrompt(...)` / `:517-535` 四段逐字命中。**minor**：`chat-agent-session.ts` 实测 `async list()` 在 **`:30`**（spec 写 `:31-39`，注释 31-35、return 36-38） |
| 链条闭合 | ✅ 成立 | `agent-runner.ts:519` → `create-compaction-condition-evaluator.ts:83-92`（`triggersFromConditions` 装 `VisibleFloorTrigger` 在 `:70-72`，转发在 `:92`）→ `composite-trigger.ts:23-25` → `visible-floor.trigger.ts:21` |
| 单次成本口径 | ✅ 成立 | `MESSAGE_SELECT_COLUMNS` 实测在 `sqlite-message.repository.ts:28`，逐个数 **21 列**（spec「可见集 21 列」正确）；`chat-agent-session.ts:36-38` 确认走 `listBySession(id, {includeHidden:false})` |
| 语义等价性论证 | ✅ 成立（1 处措辞不准） | 见 §1.2 逐跳核对 |
| VisibleFloorTrigger 输入无丢失 | ✅ 成立 | 见 §1.3 |
| RT-01 依赖写清 | ✅ 成立（双向一致） | wave-a `A1.6` + `§9.2` 与 `wave-b-core1.md:594-597`（含「读数基线的采集口径」段）双向写死；`ledger-v2.md:463`「RT-02 必须先落」与 `:549` RT-01 终裁 P1，坐标逐字核对通过 |
| 验收是计数式断言 | ❌ **不成立** | 见 §1.4 —— must-fix MF-1 |
| 回归线实存 | ⚠️ 基本成立（1 条 minor） | 7 项逐个 `Test-Path`，全部存在。**minor**：`test/compaction-conditions/` 实有 **4 个**文件（另有 `token-ratio-trigger.test.ts` 直接构造 `CompactionEvaluationContext` 字面量并调 `shouldTrigger`），spec 只列 3 个、A1.3 写「两条套件」，建议补入 |
| 依赖闭合 | ✅ 成立 | 前置无、拍板项无；跨片只有 RT-01 单向硬依赖，且被依赖侧已写死 |
| 牙齿三判据 | ❌ 现状下判据①不成立 | 根因是 MF-1：装配层缺「必须走真实触发器」这一句 |

### 1.2 语义等价性论证 —— 亲自重推导（结论：成立）

`:413` → `:519` 之间逐跳核对「有没有向 `chat_message` 追加消息」：

- `:430-443 assembleWorkplaceDisplay` —— RULE 明载只写 `rule_snapshot` / `file_cache` 两个 KKV 域，**不碰 chat_message**。
- `:449-468 prepareUserMessagesForPrompt` —— 实读 640 行，`await` 命中点逐个过了一遍：`:100` `runtime.sessionKkv.get`（读）、`:209 loadOrFillFileCache`（**写 file_cache**）、`:343/:353 skills`（读）、`:407 hydrateDirAttach`（内存 hydrate）、`:572 expandDynamicMacros`（内存）、`:624 prepareOneUserMessage`（内存）。**没有任何一处 append message**。
  ⇒ ⚠️ **措辞不准**：spec A1.1 把 `prepareUserMessagesForPrompt` 称作「纯函数」，它实际会写 `file_cache`。但这只影响 KKV、不影响 `chat_message` 条数，**等价性结论不受影响**（属 minor，建议改为「不追加消息，仅写 file_cache KKV」以免 judge 误判）。
- `:476-477`（取 `stepAnchorSeq`）、`:482-497`（skillsSeenCtx）、`:499-515`（`promptRenderCtx` / `buildPromptLlmInputFromLayout`）—— 全内存。
- 反向确认：`agent-runner.ts` 全文 `session.append` 只有 **4 处**，均在 `:708` / `:763` / `:912` / `:950`，**全部 > :519**（即发生在本 step 的压缩评估之后，或下一 step）。

⇒ 「第二次读的长度与第一次恒等」**成立**，把长度透传是严格等价变换。

### 1.3 VisibleFloorTrigger 的其它输入项有没有被丢 —— 逐个核（结论：没有丢）

| 触发器 | `session` 入参 | `evaluation` 入参 | 本条改动后是否丢输入 |
|---|---|---|---|
| `VisibleFloorTrigger`（`:17-23`） | **唯一使用点** = `:21 await session.list()` | 形参名就是 `_evaluation`（下划线前缀 = 原本就未使用） | 否。改成 `evaluation.visibleMessageCount ?? (await session.list()).length`，两条路径取值相同 |
| `TokenRatioConditionTrigger`（`:46`） | `_session`，不使用 | 正常使用（token 估算链） | 否。spec 声明「一行不动」，实测成立 |
| `CompositeConditionTrigger`（`:19-29`） | 原样转发 | 原样转发 | 否 |

端口侧：`compaction-condition-trigger.port.ts:21-41` 的 `CompactionEvaluationContext` 实测字段 = `sessionId` / `modelContext` / `promptInput` / `layout` / `ctx` / `tools?` / `sessionKkv?`。新增 **`visibleMessageCount?`（可选）** ⇒
- 方法签名 `shouldTrigger(session, evaluation)` 不变（spec「不新增接口」成立）；
- 所有构造点零编译影响：runner `:521`、mobile `create-mobile-runtime.ts:142`（纯透传，实测）、各测试字面量；
- 全仓无 `JSON.stringify(evaluation)` / `Object.keys(evaluation)` / `...evaluation` 之类穷举消费（实测 grep 零命中）⇒ 不存在「多一个键就改行为」的暗面。

**一处收益口径澄清（minor，建议写进 spec）**：`CompositeConditionTrigger` 是 OR 短路（`:24` 命中即 return）。因此
- 「只配 `visibleFloor`」 ⇒ 每 step 确实两次读，本条收益 100%；
- 「`tokenRatio` + `visibleFloor` 都配」 ⇒ `tokenRatio` 先命中时**第二次读根本不发生**。
修法本身恒安全（少读不会错），但「每 step 减半」的**实测收益**取决于用户配了哪些条件，验收断言 `listCalls === 3` 只在「只配 visibleFloor 或 tokenRatio 未命中」时成立。

### 1.4 MF-1（must-fix）：计数式验收在现有装配下**恒绿**，牙齿不成立

spec A1.3/A1.4 写的断言是：

> 装配一个 `visibleFloor` 已配置的假 runner，用一个计数的 `AgentSession.list` 替身跑一个 ≥3 step 的 run，
> 断言 `listCalls === 3`；把 Step 1 的透传删掉时该断言必须变 `6` 并红。

问题在于「`listCalls` 从 3 变 6」这个牙齿**依赖 runner 里跑的是真 `VisibleFloorTrigger`**。而 spec 指名要改的测试文件
`packages/core/test/agent/agent-runner-compaction.test.ts:139-149` 里现成的装配是：

```ts
function createCompactionConditionsStub(hideStartDepth: number) {
  return {
    shouldRequestCompaction: mock.fn(async () => { ... }),   // ← 纯 stub，从不调 session.list()
    getHideStartDepth: mock.fn(async () => hideStartDepth),
  };
}
```

若沿用这个 stub：`session.list()` 只会被 runner 自己在 `:413` 调一次 ⇒ **无论透传在不在，`listCalls` 恒等于 stepCount**。
断言变成 RULE 判据①所禁的「恒真断言」；spec 声称的「删掉透传 ⇒ 变 6」在 stub 装配下**永远观察不到**。

**修法（须补进 A1.3/A1.4）**：把「装配要求」写成硬约束——

1. 用**真实触发器链**：`createCompactionConditionEvaluator({conditionsStore: {getConditions: async () => ({enabled: true, visibleFloor: N, hideStartDepth: 6})}, …})`
   （只配 `visibleFloor` 时 `tokenCounters` / `providerModels` 不会被触碰 —— 实测 `triggersFromConditions:52-69` 证明），或直接 `new VisibleFloorTrigger(N)` 包一层；
2. 计数替身注入 `deps.session`（**这条可行**：`agent-runner.ts:236-238` 实测 `persistMessages === true` 时 `session` **就是** `this.deps.session` 本身，不是包装对象 ⇒ 计数点同时覆盖 `:413` 与 `:520` 传给触发器的那个 session）；
3. 建议把「计数」与「触发语义」拆成两条用例：
   - 计数用例用 `visibleFloor: 999`（不触发压缩，避免 `runCompaction` 桩干扰步数）⇒ 断言 `listCalls === stepCount`；
   - 触发语义用例用 `visibleFloor: 0` ⇒ 断言压缩仍按 floor 命中。
   （现状把两者塞进同一条 run，压缩触发会改变步数与 `stepCompactionEmitted` 门控语义，断言易互相干扰。）

### 1.5 N-P0-01（A2）—— 结论：**NEEDS-FIX**（2 条 must-fix + 2 条 minor）

| 维度 | verdict | 复核结论 |
|---|---|---|
| 病症从代码重推导 | ✅ 成立 | 见 §2 证据链复验（首个命中早于 `mountComposerEditor`、顶层求值期执行） |
| 证据行号/引文 | ✅ 成立 | `editor.ts:23` / `prompt-macro-input.ts:1` / `:9-13` / `:15` / `validate-dynamic-macros.ts:11-15` / `core package.json:37-40`（`"./prompt": {"types": "./dist/public/prompt.d.ts", "import": "./dist/public/prompt.js"}`）/ `build-webview.mjs:107-123`（`target: ['es2018']` 在 `:113`）/ `android/build.gradle:4 minSdkVersion = 26` —— **全部逐字命中** |
| 修法可行完备 | ✅ 成立 | 内联 3 项 + 不动 core exports；两个消费点（`:9-13` 映射、`:15` Set）无需改动 |
| 备选案（深层直引）代价分析 | ✅ 成立（1 处 minor） | 实测 `packages/core/package.json` 的 exports 共 **26 个子路径**（`.` / `common` / `agent` / `chat` / `compaction` / `events` / `feature-flags` / `prompt` / `provider` / `smart-sort-rule` / `message-checkpoint` / `session-fs` / `vfs` / `workplace` / `format` / `tdbc` / `sksp` / `nmtp` / `kkv` / `session-kkv` / `session-run-state` / `skills` / `config-forms` / `config-forms/agent` / `config-forms/shared` / `config-forms/stored-config-validity`），**无一指向 `dist/domain/**`** ⇒ 深引确需新增 export 子路径，跨片代价分析成立。**minor：spec 写「17 个子路径」，实测 26**（RULE 计数须实测） |
| 修法后残余命中 | ✅ 成立且更强 | 见 §2.2：composer-input 的 5 处命中全部同源，内联后残余确定为 **0**，**无需第三方豁免** |
| 验收可测 | ✅ 成立 | `build:webview` + `indexOf` 四构造 + 体积对照（基线 21,826 B），三条都是可复跑命令 |
| 牙齿三判据 | ✅ 成立 | 删内联数组一项 ⇒ `PROMPT_INSERTABLE_MACROS` 与断言同时红；断言读的是 core 真实常量（经 `jest.config.js:210-213` 映射到 `packages/core/dist/public/prompt.js`），不依赖进程级标记 |
| 回归线实存 | ✅ 成立 | 5 个 mobile 测试文件逐个 `Test-Path`，全部存在 |
| wave-e 边界一致 | ❌ **不一致** | 见 MF-3 |
| 依赖闭合 | ✅ 成立 | 前置无、拍板项无；跨片只有「防再犯门禁归 X3」单向 |

---

## 2 · bundle 证据链复验（N-P0-01）

### 2.1 产物实测（`apps/mobile/webview-dist/composer-input/app.js`，PowerShell 逐字读）

| 构造 | `IndexOf` | spec 声称 | 一致 |
|---|---:|---:|:--:|
| `Object.fromEntries` | **4907** | 4907 | ✅ |
| `mountComposerEditor` | **18778** | 18778 | ✅ |
| `replaceAll` | **-1** | -1 | ✅ |
| `Object.hasOwn` | **-1** | -1 | ✅ |
| `.at(` | **-1** | -1 | ✅ |
| `structuredClone`（补测，spec 未列） | **-1** | — | ✅ |
| 文件字节数 | **21826** | 21,826 | ✅ |

> 顺带记一笔：**wave-e X3.1 写的是「21 716 字节」，与实测 21,826 不符**（数字转置）。wave-a 的数字是对的，wave-e 需订正。

**「顶层求值期 ⇒ 挂载前抛」这条链成立**：5 处命中位于 4907–5399，文件末尾才是
`var root = document.getElementById("root"); if (root != null) { mountComposerEditor(root); }`（`mountComposerEditor` 标识符在 18778）。
IIFE 顶层顺序执行 ⇒ `Object.fromEntries` 在 minSdk 26（Chromium 58）上抛 `TypeError` 时，`mountComposerEditor` 与 `post2("ready", …)` **都还没跑到**，编辑器不挂载 + `ready` 不上报 + 宿主握手不完成 ⇒ 白屏级无响应（非降级）。**机理成立。**

### 2.2 「修法后会不会有残余命中」—— 亲自判定：**0 命中，无需第三方豁免**

把 5 处命中逐处 dump 上下文（`grep` 式逐点打印，非抽样）：

| # | index | 归属 |
|---:|---:|---|
| 1 | 4907 | `BUILTIN_DEFAULT_API_KEY_BY_KEY = Object.fromEntries(BUILTIN_PROVIDER_ROWS.flatMap(...))` |
| 2 | 5067 | `BUILTIN_PROVIDER_PROTOCOLS = Object.fromEntries(BUILTIN_PROVIDER_ROWS.map(...))` |
| 3 | 5188 | `BUILTIN_PROVIDER_UUID_PROTOCOLS` |
| 4 | 5296 | `BUILTIN_KEY_TO_UUID` |
| 5 | 5399 | `BUILTIN_UUID_TO_KEY` |

**5 处全部在 492→5400 这一段连续代码里，全部由同一个 `BUILTIN_PROVIDER_ROWS`（`builtin-providers.js` 顶层）派生。**
⇒ 它们是**同一个模块的单点病灶**，不是多点扩散；删掉那条 import 即整段消失。

更强的完备性证据（spec 未给、建议补进 A2.2 Step 1 的论证）：
`apps/mobile/src/web/**` 全量 grep `@novel-master/core`，**全仓只有 1 处命中**——
`apps/mobile/src/web/chat-transcript/webview/runtime/render/row-logic.ts:6`（`@novel-master/core/chat`）。
**composer-input 侧零命中** ⇒ 它拖进 core 的唯一入口就是 `prompt-macro-input.ts:1`。
⇒ Step 1 落地后，`composer-input` 产物的 core 模块集合必然为空（与 wave-e X3.1 的 metafile「inputs=14 / node_modules=0 / core=5」互证）。

**关于「第三方库带来的命中要不要豁免」**：
- 对 **composer-input** 包：**不需要**。0 命中，无豁免必要。A2.3 的「四构造全 -1」是可成立的硬验收。
- 对 **另外 3 个包**：需要，而这正是 wave-e X3 设计 A/B/C 三道门的动因（X3.1 实测 chat-transcript 8.6MB 里 `Object.fromEntries`×6 / `replaceAll`×41 / `.at(`×18 / `Object.hasOwn`×12 / `structuredClone`×11，rich-document 同量级，code-editor 的 `Object.hasOwn`×1 来自 CodeMirror —— 第三方为主）。
  ⇒ **两片的职责切分在这一点上是自洽的**：wave-a 只交修复本体并对 composer-input 做硬验收；第三方豁免（门 A 源码级 + 门 C 计数棘轮）归 wave-e X3。**唯一要修的是坐标与白名单终值（MF-3）。**

---

## 3 · must-fix 清单

| ID | 严重度 | 定位 | 问题 | 建议改法 |
|---|---|---|---|---|
| **MF-1** | **高（阻断 execute）** | `wave-a.md` A1.3 / A1.4 | 计数式验收（`listCalls === 3` / 退回旧形态变 6）在沿用 `agent-runner-compaction.test.ts:139-149` 的 `createCompactionConditionsStub` 时**恒绿**：stub 的 `shouldRequestCompaction` 从不调 `session.list()`，第 2 次读根本不存在 ⇒ RULE 牙齿判据①失效 | A1.3/A1.4 补写硬约束：① 必须装配**真实** `VisibleFloorTrigger`（经 `createCompactionConditionEvaluator` + 只配 `visibleFloor` 的 conditionsStore，或直接 `new VisibleFloorTrigger`）；② 计数替身注入 `deps.session`（`:236-238` 证明 `persistMessages=true` 时 `session` 即 `deps.session`，计数点成立）；③ 建议拆成两条用例——计数用例 `visibleFloor: 999`（不触发压缩）断言 `listCalls === stepCount`，语义用例 `visibleFloor: 0` 断言仍按 floor 命中 |
| **MF-2** | 中 | `wave-a.md` A2.2 Step 2 | 「`packages/core/package.json` 的 `exports` 只暴露了 `./prompt` 等 **17 个**子路径」——实测 **26 个**（RULE：计数类结论必须实测） | 改成 26；结论不变（仍无任何子路径指向 `dist/domain/**`），但数字须订正 |
| **MF-3** | 中 | `wave-a.md` A2.2 Step 3、A2.6、§9.2 三处 | 对 wave-e X3 的坐标与终值都不一致：① 引 `wave-e.md:366` / `:366-378`，实测 **X3 标题在 `wave-e.md:401`**（`:366` 落在 X2.5 测试策略节内）；② wave-e X3.2 门 B 建议把 composer-input 白名单收成 `["domain/prompt/logic/validate-dynamic-macros.js"]`，但按 wave-a 的**默认内联案**，该包修完后 core 模块集合为**空**，白名单应是**空数组** | ① 三处坐标改 `:401`（白名单建议段 `:471-481`、依赖段 `:534-539`）；② A2.6 明确写「内联案 ⇒ composer-input 门 B 白名单 = `[]`；若走备选深引案才是单元素集」，并在 wave-e X3.2 对应处同步，避免两片各留一个互相矛盾的终值 |
| **MF-4** | 低 | `wave-a.md` A1.1 语义等价性段 | 把 `prepareUserMessagesForPrompt` 称作「纯函数」不准 —— 实测它会经 `loadOrFillFileCache`（`:209`）**写** `file_cache` KKV | 改为「不向 `chat_message` 追加任何消息，仅写 `file_cache` KKV（`prepare-user-messages-for-prompt.ts:209`）」。等价性结论不变（追加消息才是唯一能改变条数的动作），但表述准确才经得起 judge 追问 |
| **MF-5** | 低 | `wave-a.md` A1.3 / A1.5 | `test/compaction-conditions/` 实有 4 个文件，spec 只列 3 个、且 A1.3 写「两条套件」；漏了 `token-ratio-trigger.test.ts`（它直接构造 `CompactionEvaluationContext` 字面量并调 `shouldTrigger`，是端口改动的最直接观测面） | 回归线补 `packages/core/test/compaction-conditions/token-ratio-trigger.test.ts`；A1.3 的「两条套件」改为按文件逐个点名 |
| **MF-6** | 低 | `wave-a.md` A2.4 | 「mobile jest 里引用 core 是常规做法，`__tests__/session-prompt-input.service.test.ts` 已如此」——该文件实测引的是 `@novel-master/core/chat` 与 `@novel-master/core/config-forms/stored-config-validity`，**不是** `core/prompt`；mobile 全仓对 `core/prompt` 只有两处 `jest.mock`（`chat-prompt-tokens.test.ts:59`、`compaction-warm-orchestration.test.ts:51`），**没有未 mock 的真实导入先例** | ① 引用改为「mobile jest 引用 core 子路径是常规做法（举例引 `core/chat`）」；② 在 A2.4 补一条前置：`@novel-master/core/prompt` 经 `jest.config.js:210-213` 映射到 `packages/core/dist/public/prompt.js`，**依赖 core dist 已构建**（RULE 已记该前置）；③ 实施时**先单跑一次**这条新断言，确认 barrel 未把 `yaml` 之类拉进 RN Jest（jest 对 `^yaml$` 已有 CJS 兜底，但仍须实跑确认） |

---

## 4 · 其它记录（不构成 must-fix）

1. **RT-02 收益口径**：`CompositeConditionTrigger` 是 OR 短路，只配 `visibleFloor` 时才是「每 step 两次 → 一次」的满收益；`tokenRatio` 命中时第二次读本就不发生。建议在 A1.2 补一句，免得实测收益与 spec 预期对不上。
2. **`chat-agent-session.ts` 行号**：spec 写 `:31-39`，实测 `async list()` 在 `:30`（注释 31-35 / return 36-38 / 收尾 39）。属笔误，不影响论证。
3. **A2 体积基线可用**：21,826 字节已复核，`npm run build:webview` / `build:webview:native` / `lint --max-warnings 321` 三个 script 名实测与 spec 一致（`apps/mobile/package.json`）。
4. **三端产物链纪律**：A2.3 已正确声明 `webview-dist` 不进 git、真机验证走 `build:webview:native` + gradle 重打，与 RULE「mobile webview 改动是三层产物链，reload 无效」一致 —— 保留。
5. **wave-e X3.1 的字节数笔误**（21 716 vs 实测 21 826）建议顺手在 wave-e 订正，避免 judge 拿两片的数字对不上。

---

## 5 · 结论

**组 B：No-Go。**

一句话理由：两条的病症、证据链与修法主体全部经代码重推导后成立（bundle 的 4907/18778 与 5 处同源命中也已亲自复验，RT-01 的双向依赖闭合），但 **RT-02 的计数式验收在现有 stub 装配下恒绿、牙齿不成立（MF-1）**，且 **N-P0-01 与 wave-e X3 的坐标（`:366`→实为 `:401`）与门 B 白名单终值（单元素 vs 空数组）互相矛盾（MF-3）** —— 这两处不闭合就会让 impl 阶段写出一个恒真的验收断言、或让两片各落一个对不上的门禁配置。

MF-1 与 MF-3 是**必须闭合**的；MF-2 / MF-4 / MF-5 / MF-6 为可测性与准确性问题，建议同轮 doc-fix 一并改掉。全部为文档改动，不涉及生产/测试代码，闭合成本低。