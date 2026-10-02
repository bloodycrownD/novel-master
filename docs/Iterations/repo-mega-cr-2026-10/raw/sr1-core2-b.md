---
zone: wave-b-core2 / 组 B
agent: sr1-core2-b（readonly reviewer，条目组粒度）
files_scanned: >
  docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一、四章）、
  fix-spec/wave-b-core2.md（§0 打包约束 + §4/§5/§6/§9/§10 + §11 分片注记）、
  ledger-v2.md（§2.4 / §2.5 / §2.8 / §10 Wave B）、
  docs/apm/RULE.md（验收牙齿三判据等）、
  wave-e.md（H2/H5.1.2 交叉依赖）、wave-c2（CS-06 顺序）、
  生产代码与既有测试（逐处定点核对，行号以 fe79b781 实际为准）
baseline_sha: fe79b781
scope: M-03 / M-04 / CS-02 / B / S-D-02 五条 + 「P1-S 批次」打包声明
review_mode: readonly（未改任何代码、spec、docs/apm；git 无写操作）
---

## 摘要

本组五条 + 打包声明的**病症与行号经逐处核对全部成立**（21 处 file:line 亲自重核，无漂移），
修法方向均正确可行。缺陷集中在**验收可测性与打包声明的自洽性**：S-D-02 的验收断言与真实夹具
冲突（实测必红）、M-04 漏了 `conn` 注入这一结构改动、验收引用了不存在的 API、打包节自相矛盾
（四个 commit vs M-04 单独 commit）。均为局部补漏，不推翻任何一条的修法方向 ⇒ 有条件 Go。

---

## 1 · 逐条 verdict 表

| 条目 | 病症（代码重推导） | 证据（行号/引文） | 修法可行完备 | 验收可测（牙齿三判据） | 测试策略 | 回归线真实存在 | 依赖闭合 | verdict |
|---|---|---|---|---|---|---|---|---|
| **M-03** | ✅ 成立 | ✅ 全对 | ⚠️ 有 1 处类型载体歧义（MF-3.1） | ⚠️ 有牙，但观测面写错（MF-3.2） | ✅ 文件正确 | ✅ 7 条既有用例逐条核对在位 | ✅ 无前置 | **NOT-READY**（2 处小修） |
| **M-04** | ✅ 成立 | ✅ 全对 | ❌ 漏一处结构改动（MF-4.1） | ❌ 引用不存在 API（MF-4.2） | ✅ 文件正确 | ✅ 风险面已实证不触发 | ✅ | **NOT-READY**（3 处） |
| **CS-02** | ✅ 成立 | ✅ 全对 | ✅ | ✅（超时即红，是有效牙齿） | ⚠️ 目录写错（NF-2.1） | ✅ 11 条既有用例在位 | ✅ | **READY**（带 1 nit） |
| **B** | ✅ 成立 | ✅ 全对（9 处） | ✅（三处联动陷阱已正确识别） | ✅（键集 + 缺省 all 双断言） | ✅ | ✅ 3 个既有用例在位 | ✅ | **READY** |
| **S-D-02** | ✅ 成立 | ✅ 全对 | ✅（`resolve` 需新增 import，`sep` 已在） | ❌ 第 3 条断言实测必红（MF-5.1） | ✅ | ✅ 4 条在位 | ✅ | **NOT-READY**（1 处高危） |
| **打包约束 §0** | — | — | ❌ 4 处自相矛盾/失准（MF-P.1~P.4） | — | — | — | ⚠️ S-D-02↔CS-08 同文件未声明 | **NOT-READY** |

verdict 计数：**READY 2 / NOT-READY 4**（3 条目 + 1 打包节）。

### 1.1 逐处行号核对结果（全部亲自打开 fe79b781）

| 条目 | spec 断言 | 实测 | 结论 |
|---|---|---|---|
| M-03 | `load-or-fill-file-cache.ts:142` `if (deps.status !== "filename")` | `:142` 逐字一致 | ✅ |
| M-03 | `:209-223` `readWorkplaceFileBody` 两入口 | `:209` 函数起、`:214` filename 返回 `{body:"",mtimeMs:0}`、`:221` catch 返回 `(missing)` | ✅ |
| M-03 | `:176-207` `probeOversizePlaceholder`、`:206` 回传 `size.mtimeMs` | 一致（`:176` 函数起、`:206` `return null` 前的占位符分支带 `mtimeMs: size.mtimeMs`） | ✅ |
| M-03 | `:146-147` 注释「mtime 用探测带回的真实值」 | 一致 | ✅ |
| M-03 | `:41` 模块注释「缺失用 `(missing)` 占位并仍写入 cache」 | **逐字一致** | ✅ |
| M-03 | `assemble-workplace-display.ts:173-195`、`:191` | `:173` 起、`:191` `mtimeMs: payload.mtimeMs` | ✅ |
| M-03 | `workplace-display.ts:21` / `:81` | `:21` `formatLocalMtime`、`:81` ``createdAt="${escapeXmlAttr(mtimeLocal)}"`` | ✅ |
| M-03 | 既有用例 `filename 档：不探测（原行为，缺失占位空串仍写 cache）` | `load-or-fill-file-cache.test.ts:161` **同名同义** | ✅ |
| M-03 | 既有 7 条 | 实测恰 7 条 `it` | ✅ |
| M-03 | `assemble-workplace-display.test.ts:459-466` 同类断言 | `:459` 注释、`:462` 正则、`:466` `startsWith("1970")` | ✅ |
| M-04 | `find-saved-model-references.ts:66-71` chat_project 查询、全函数 `:93` 结束、chat_session 零扫描 | 一致；文件确在 `:93` 收尾；全仓 grep `chat_session` **零命中** | ✅ |
| M-04 | `provider.service.ts:240-250` `delete-saved-models` 整条绕过 | `:240-250` 逐字一致；函数内零 `findSavedModelReferences` | ✅ |
| M-04 | `provider-model.service.ts:168-189`、`:173`、`:174-180` | 一致 | ✅ |
| M-04 | `findSavedModelReferences` 全仓唯一调用方 | grep 结果仅 3 处：定义 + import + `:173` | ✅ |
| M-04 | `sqlite-session.repository.ts:165-185` 读写 `chat_session.agent_config_json` | `:165` SELECT、`:175-185` UPDATE | ✅ |
| M-04 | `SessionAgentConfig = {agentId, modelId?}` 顶层形态 | `session-agent-config.ts:18-22` 一致 | ✅ |
| M-04 | `chat-schema.ts:21` 该表无 `model_id` 列 | `:16` CREATE TABLE、`:21` `agent_config_json`；全文件零 `model_id` | ✅ |
| M-04 | 回归风险：既有两条 delete 成功用例 | `provider-service.test.ts:135/150` **均未创建 saved model** ⇒ 新前置拒绝不会拦下它们 | ✅ 风险实证解除 |
| CS-02 | `compute-replace-result.ts:53-64` replaceAll 死循环 | `:53-64` 一致；`:59` `searchFrom = idx + normalizedOld.length` 空串恒定 ⇒ 死循环成立 | ✅ |
| CS-02 | 同文件 `:76-79` 假成功 | `:76` `indexOf(normalizedOld)`，空串 ⇒ 0 ⇒ 假成功成立 | ✅ |
| CS-02 | `vfs-tools.ts:339-343` 裸 `z.string()` | `:339-343` 一致 | ✅ |
| CS-02 | `skill-tool.ts:341` `z.string().optional()` | `:341` 逐字一致 | ✅ |
| CS-02 | 回归线 `T-B2-01~08 + replaceAll 组 4 条` | 实测 11 条 `it`：T-B2-01~06、08（7）+ replaceAll 4 条（含 T-B2-07） | ✅ |
| B | `agent-editor-state.ts:542-569` 17 字段无 `mode` | 一致；且 `:62` `mode: AgentMode` 在输入类型里 | ✅ |
| B | `:453` 字段名联合含 `"mode"`、`:476` `mode: def.mode ?? "all"`、`:613` `mode: input.mode` | 三处全部一致 | ✅ |
| B | `AgentEditorView.tsx:169-193`（`:174` mode）、`:196` 依赖数组、`:630` dirty、`:744-756` 下拉 | `:171/174` 快照、`:197` 依赖、`:630` dirty、`:746-750` 下拉 —— 均在位（`:744-756` 为区块范围，实际节点 `:746`） | ✅ |
| B | `useAgentEditorFormState.ts:218-220`、`:278-290`、`:121`、`:84` | `:220` 快照、`:279-285` 基线对象（**确认无 `mode`**）、`:121`、`:84` 均一致 | ✅ |
| B | `agent-editor-state.test.ts` `T-CA2c:451` / `T-DESC5:1205` / `omits model fields:389` | 三处逐字一致 | ✅ |
| B | `AgentDefinitionEditorForm.tsx` 全仓零引用（Wave D 待删） | grep 仅命中该文件自身 7 处 | ✅ |
| S-D-02 | `handlers/vfs.ts:423-432` | 逐字一致 | ✅ |
| S-D-02 | `vfs-batch.service.ts:260-272`（唯一校验=空串） | 逐字一致 | ✅ |
| S-D-02 | 同文件 `:295-299` staging 根权威来源、`:280-293` 唯一消费方、`:291` 空判 | 一致 | ✅ |
| S-D-02 | `node:path` 已导 `sep`、未导 `resolve` | `:21` `import { basename, dirname, join, relative, sep }` | ✅ 修法所述「`resolve` 需新增」正确 |

### 1.2 牙齿三判据自检（按 RULE 三条）

- **①有牙吗**：五条的验收都能在「把实现改坏/删掉」时变红——
  M-03 靠「不回填真实 mtime / 仍写 cache」；M-04 靠「chat_session 段删掉」「前置拒绝删掉」；
  CS-02 靠「纯函数守卫删掉 ⇒ 假成功红 / 死循环超时红」（超时型牙齿是本组最硬的一条）；
  B 靠「`mode` 不进输出 ⇒ 两串相等」「基线侧漏传 ⇒ 恒 dirty」；
  S-D-02 靠「去掉 `+ sep` ⇒ 前缀撞车放行」「断言写成 return ⇒ 路径残留仍报成功」。
- **②进程/顺序/事务约束下会恒红吗**：CS-02 的 replaceAll 用例**刻意**用超时而非断言失败，
  这是合法设计（死循环无法被断言捕获），但需在 impl 时确认 node:test 默认超时不被调大；
  其余四条无进程级标记依赖。
- **③同一夹具只服务一套期望吗**：**发现一处真实风险** —— S-D-02 的既有两条正向用例与
  新增的两条反向用例共用同一 `tempDir` 观测面，但要求相反（见 MF-5.1），
  spec 未声明要换夹具，属 RULE ③ 的「互斥期望」形态。

---

## 2 · M-04 量级冲突的裁定

### 2.1 事实认定

- ledger §2.5（`ledger-v2.md:137`）M-04 的「量」列 = **M**（原文末列 `| M |`）。
- ledger §10 Wave B 末行（`ledger-v2.md:457`）把这批打包成「P1-S 批次」PR，并在动作列写
  **「全部量级 S、零结构变更」**，但同一格里**逐个点名**列出了 `M-04`。
- ⇒ 台账自相矛盾：**点名入批** 与 **量级声明** 二者只能取一。撰写机位在 §0.2 正确地把它挑了出来。

### 2.2 量级裁定：**M-04 确为 M，不是 S**（独立复核后维持台账「量」列，否定 Wave B 行的声明）

三条独立证据（均本机实测，非照抄台账）：

1. **跨域两文件 + 一处服务依赖结构变更**：`findSavedModelReferences(conn, …)` 需要
   `TdbcConnection`，而 `DefaultProviderServiceDeps`（`provider.service.ts:28-33`）
   **只有 `providers / suggestions / savedModels / secretStore`，没有 `conn`**。
   要在 `delete(id)` 里调守卫，必须给 deps 增 `conn` 并改工厂
   `create-provider-services.ts:44-49`（工厂侧 `conn` 已在手，`provider-model.service.ts:59`
   已是同样做法），施工点共 2 处（工厂 + `provider-service.test.ts:211` 的直接 new）。
   这已经越过 Wave B 行「**零结构变更**」的门槛。
2. **行为面变更而非补一行**：`delete(provider)` 从「静默清空被引用模型」变成「删不掉」。
   spec 自己在风险 1 承认这是「可见的产品行为变化」，并考虑过 `force` 备选——有产品面抉择就不是 S。
3. **新增一条全表扫描 + 两条脏数据容错**：`chat_session` 扫描还要 try/catch 包 `JSON.parse`
   （spec 已正确指出「抛错等于守卫失效，比不扫更糟」），这是有设计判断的改动，不是模板化补丁。

### 2.3 归属裁定：**留在本 PR，但必须独立 commit；同时把打包节的数字改对**

- **不建议整条移出本批**。理由：ledger 是**按 ID 点名**把它放进这批的（`:457`），
  「全部量级 S」只是该行的汇总口误；把它移走等于用口误推翻点名，Wave C 也**没有**承接它的格子
  （Wave C「事务边界收窄」行是 core-storage + core-data 的 CS-05/06/07/11 + RT-01，
  没有任何 provider 行的落点）。spec §0.2 备选案说的「改挂 Wave C 的事务边界格」**指向错误**。
- **采纳 spec 的默认案**（留 PR、单列 commit、commit 正文注明「本批含 1 条台账量级 M（M-04）」），
  但必须先把 §0.1 与 §11.1 的自相矛盾改掉（见 MF-P.1）：现在是「一个 PR、**四个** commit」，
  而硬约束①又要求「M-04 单独 commit」⇒ 实际是**五个**。impl 代理照现在的文本无法确定提交粒度。
- 顺带：§0.2 与 §11.5 已把这个冲突显式上呈 judge，**处理方式正确**，值得肯定——这正是
  PLAN 第四章第 8/9 条要求的「台账与代码不一致必须写清并交 judge」。

---

## 3 · must-fix 清单表

| # | 位置 | 级别 | 问题 | 建议改法（doc-fix 可直接落） |
|---|---|---|---|---|
| MF-5.1 | §10 S-D-02 · 验收 3 + 测试策略 | **高** | 「既有 `删除 staging 目录` / `IPC clearStaging 幂等` 必须仍绿」**实测会红**：两条用例传的是 `join(tempDir,"staging-a")`，而 `tempDir = mkdtemp(join(tmpdir(),"nm-desktop-vfs-staging-"))`（`desktop-db-test-env.ts:18`），测试态 `app.getPath("userData")` 被 stub 成 `/tmp/novel-master-test-user-data`（`electron-stub.mjs:19`）——**两个路径毫无包含关系**，新断言必拒。且这正是 spec 在 M-03 里警告过的失败模式（红了就放宽守卫 ⇒ 守卫作废） | 验收第 3 条改为「**必须先改夹具**」：把两条既有用例的 `stagingRoot` 换成 `join(app.getPath("userData"),"vfs-batch-export","case-a")`（先 `mkdir(...,{recursive:true})` 造 base），再断言仍绿；测试策略的「+2」改为「**+2 且改 2 条既有用例的夹具**」；风险栏补一句「若实现时改红既有用例，正确处置是修夹具而非放宽断言」 |
| MF-4.1 | §5 M-04 · 修法 2 | **高** | 修法要「在 `delete(id)` 里对每个 savedModel 调 `findSavedModelReferences`」，但 `DefaultProviderServiceDeps`（`provider.service.ts:28-33`）**没有 `conn`**，该函数首参即 `TdbcConnection`。spec 通篇未提这处依赖注入 ⇒ impl 会撞编译错或自造循环 import（`providerModelService` 已持有 `providers`，反向注入会成环） | 修法 2 增第 0 步：「给 `DefaultProviderServiceDeps` 增 `readonly conn: TdbcConnection`，工厂 `create-provider-services.ts:44-49` 传入（与 `:53-60` 给 `DefaultProviderModelService` 传 `conn` 同款），同步 `provider-service.test.ts:211` 的直接 `new`；**不得**改走 `providerModels` 注入（会成环）」 |
| MF-4.2 | §5 M-04 · 验收 2 | **高** | 验收写「断言 `providerModels.listByProvider(id)` 仍返回该模型」——`ProviderModelService` **没有 `listByProvider` 方法**（实测公开方法：`suggestList/fetch/save/create/savedList/editSaved/deleteSaved/updateSettings/resetContextWindowToDefault/getSavedById/getContextWindow/getTokenCounterMode`）。照抄即编译失败 | 改为 `bundle.providerModels.savedList(id)`（`:127` 既有方法），并注明「`listByProvider` 只存在于 repository 层，服务层没有」 |
| MF-4.3 | §5 M-04 · 修法 2 + 风险 | 中 | ① 抛 `ProviderError("PROVIDER_IN_USE", …)` 后又说「若未定义则复用 `SAVED_MODEL_IN_USE`」——`PROVIDER_IN_USE` **确实不存在**（`provider-errors.ts:8-23` 全码表无此项），双写法会让 impl 试错；② 理由「desktop IPC 的错误映射表按码分派，新增码要同步改映射」**不成立**：`apps/desktop/src` 全量 grep `SAVED_MODEL_IN_USE`/`BUILTIN_PROVIDER` **零命中**，`formatIpcError` 是按 `instanceof` 类分派后原样透传 `err.code` | 直接写死：「复用 `SAVED_MODEL_IN_USE` 并在 details 带 `providerId`（`ProviderError` 已支持 `providerId` 字段），**不新造码**——`formatIpcError` 对 `ProviderError` 是原样透传 code，新增码无映射表要改，但会让前端拿不到已处理的文案」 |
| MF-3.1 | §4 M-03 · 修法 3 | 中 | 让 `degraded` 标记穿过 `readWorkplaceFileBody → fillFileCacheFromVfs` 必然要**加宽共享类型 `FileCachePayload`**（`rule-snapshot-codec.ts`，被 `assemble-workplace-display` 与序列化/解析共用）。若只加在该类型上，`degraded` 会进入 `serializeFileCachePayload` 的写入面（虽然 `degraded` 分支跳过 writeBack，但类型污染是持久的） | 修法 3 明确载体：「在本模块内声明局部类型 `type FillResult = { payload: FileCachePayload; degraded?: boolean }`（或 `FileCachePayload & { degraded?: true }` 的本地交叉类型），**不改共享的 `FileCachePayload`**，`fillFileCacheFromVfs` 内部只在需要判降级处用交叉类型，返回给调用方的仍是 `FileCachePayload`」 |
| MF-3.2 | §4 M-03 · 验收 | 中 | 「用注入的 `sessionKkv.set` 计数器当观测面」——`createMemorySessionKkv`（`test/helpers/prompt-layout-test-helpers.ts`）**没有 set 计数器**，本文件既有 3 条用例的观测面统一是 `await sessionKkv.get(...) === null`。照 spec 写会去改 helper，与本片「不新增测试文件/只改既有文件」的边界打架 | 改为沿用本文件既有观测面：`assert.equal(await sessionKkv.get("s1", SESSION_KKV_DOMAIN_FILE_CACHE, fileCacheKey("full","/note.md")), null)`；若确实想要调用计数，允许在本文件内**局部包一层** `const setCalls = {n:0}` 的代理，而不是改共享 helper |
| MF-P.1 | §0.1 表 + §11.1 硬约束① | 中 | 「一个 PR、**四个** commit」与「M-04 单独 commit」互斥 ⇒ 提交粒度二义 | 二选一并全篇统一：建议写「一个 PR、**五个** commit：C1 / C2 / **C3a（六条杂项）** / **C3b（M-04）** / C4(CS-07)」，并同步 front-matter「量级」行与 §11.1 代码块 |
| MF-P.2 | §0.1 C3 行 | 低 | 「这**六**条互不相干」但同格列了 7 个条目（M-03/M-04/CS-02/CS-08/B/S-D-02/summarizeToolInput） | 数字改 7（或去掉计数） |
| MF-P.3 | §0.2 备选案 | 低 | 「改挂 Wave C 的**事务边界格**」——Wave C 该格是 core-storage + core-data（CS-05/06/07/11、RT-01），**无 provider 落点**，照此备选会无处可挂 | 改为「若 judge 决定移出本批，则 M-04 需在 Wave C 另立 provider 归属（或独立成 PR），Wave C 现有格无处承接」 |
| MF-P.4 | §5 / §8 依赖栏 | 低 | **S-D-02 与 CS-08 同改 `apps/desktop/src/main/services/vfs-batch.service.ts`**（S-D-02 动 `:260-272` + `:295-299`；CS-08 动 `stageVfsBatchExport` 的返回面 `:291` 及以下），二者同在 C3，两条依赖栏**都没写**这个同文件关系 | 在 S-D-02 依赖栏补：「与 CS-08 同文件（desktop `vfs-batch.service.ts`），**先做 S-D-02**（它抽出 `vfsBatchStagingBase()` 并改 `:295-299`），再做 CS-08（改 `stageVfsBatchExport` 返回面）」 |
| NF-2.1 | §6 CS-02 · 测试策略 | nit | 写「`packages/core/test/domain/tool/` 下的 edit/skill 工具 schema 用例」，但既有宿主在 **`test/tool/vfs-tools.test.ts` / `test/tool/skill-tool.test.ts`**（`test/domain/tool/` 不存在）。验收栏「若既有工具 schema 测试文件存在则加进去」是对的，两栏口径打架 | 测试策略改为「改：`packages/core/test/tool/vfs-tools.test.ts`（+1）、`packages/core/test/tool/skill-tool.test.ts`（+1）」，并删掉「不新增测试文件（除…）」的例外分支 |
| NF-4.1 | §5 M-04 · 依赖 | nit | 「与 wave-e 钩子⑤ **是同一条**…不得重复立条」——`wave-e.md:1210/1638` 的口径是「只写 `test.todo` 留证用例，实现建议 wave-b-core2」。两边的**兜底归属**一致，但 wave-e 那条 `test.todo` 在 M-04 落地后会成为冗余占位 | 在依赖栏补一句「M-04 落地后，wave-e H5.1.2 的 `test.todo` 占位应删除，改为引用本片用例」，避免两片各留一条 |

### 3.1 非 must-fix 的确认项（供 judge 参考）

- **M-04 回归风险面已实证解除**：`provider-service.test.ts:135/150` 两条 delete 成功用例
  **均未创建 saved model**，新前置拒绝不会拦下它们。spec 的风险提示方向正确、结论可放行。
- **CS-02 既有测试无一条依赖空串行为**：实测 11 条既有用例全部喂非空 `oldString` ⇒ `.min(1)` 不会误伤。
- **批次级验收命令**：`npm test -w @novel-master/core` 有效（`packages/core/package.json:121`
  已含 `-O globstar` 与两个 flag，对上 RULE:111-112）；`npx jest --maxWorkers=2` 有效（mobile `test: jest`）。
  仅 `node scripts/run-tests.mjs` 实际在 **`apps/desktop/scripts/run-tests.mjs`**，
  spec §0.4 用 `# apps/desktop` 注释暗示了 cwd，建议直接写成
  `npm test -w @novel-master/desktop -- "test/**/*.test.ts" --test-concurrency=2`。
- **§1 N-P1-02 验收里的 `npm test -w @novel-master/core -- test/...`**：core 的 test 脚本是
  `bash -O … -c '…'`，`--` 之后的参数落在 bash 的 `$0/$1` 而不是 tsx 行 ⇒ **这条「定向」命令多半
  跑的是全量**。spec 已给了正确的备选（`npx tsx --experimental-test-module-mocks --tsconfig … --test <file>`），
  建议把正确形式提为首选。不属本组，但同批，建议 judge 一并裁。

---

## 4 · 结论

**组 B：有条件 Go（No-Go until doc-fix）** —— 五条的病症与行号经 21 处实测全部成立、修法方向无一
需要推翻，但存在 3 条 must-fix 级缺口（S-D-02 的验收断言实测必红、M-04 漏 `conn` 依赖注入、
M-04 验收引用不存在的 API）加打包节的提交粒度自相矛盾，均为单轮 doc-fix 可闭合的局部补漏。

**M-04 量级裁定：确为 M，留在本 PR 但必须独立 commit（打包节须从「四个 commit」改为五个）**，
备选案「改挂 Wave C 事务边界格」指向的格子无 provider 落点，不可采纳。

**一句话理由**：病与行号可信、修法可行，但验收有两处跑不起来（S-D-02 夹具、M-04 API），
必须先把 spec 补到 impl 代理能一次做对，再谈 execute-ready。
