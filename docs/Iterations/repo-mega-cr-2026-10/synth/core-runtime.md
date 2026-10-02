---
zone: core-runtime
agent: reduce（W5 归并）
wave: W5
date: 2026-10-01
inputs:
  - raw/w2-core-agent.md
  - raw/w2-core-service-agent.md
  - raw/w4-runner-pro.md
  - raw/w4-runner-adv.md
  - raw/w3-xc-fullread.md
  - raw/w3-xc-cache-lifecycle.md
files_scanned: 0（本代理为归并层，不新增扫描；所有 file:line 均在原报告基础上**就地复核**）
verified_spots: 21
merged: 60
  P0: 2
  P1: 6
  P2: 18
  P3: 34
disputes: 8
adjudication:
  pro_upheld: 27
  pro_mitigated: 3
  pro_dismissed: 0
  pro_downgraded: 10
  pro_upgraded: 2
  adv_conceded: 6
  adv_sustained: 9
---

# W5 · synth/core-runtime —— agent 域 + service/agent 编排层 + runner 读路径/缓存生命周期

## 归并口径（本代理自定的三条规矩）

1. **同 file:line + 同根因 ⇒ 合并为一条**（如 `AgentSession` 两个死方法合并为 RT-10）；**同 file:line + 不同根因 ⇒ 拆条**（如 doom-loop 误杀 RT-09 与 doom-loop 不留痕 RT-05）。
2. **对抗裁决优先于单方定级**：检察官判 P2 而辩护人给出可核验反驳的，一律降级并把「处置方式」上交（RT-14 / RT-15 / RT-43）。
3. **w2/w3 单方发现的 P1/P0，先就地复核再入账**；复核不成立的直接降 P3 或剔入移交表，不占台账。
   复核成立的**升 P1 的**共 3 条（RT-05 / RT-06 / RT-07，其中 RT-07 只升到「代码 confirmed / 可见性 suspected」的分层置信），**降 P3 的**共 4 条（RT-26 / RT-33 / RT-34 / RT-43）。

---

## 架构小结（core-runtime 簇）

**这块代码是「智能体运行时」**：一次发送 = `runAgentTurn` 前奏（清洗输入 → backfill checkpoint → 解析 agent/model → append 用户消息 + capture baseline → 装配 toolCtx）交给 `DefaultAgentRunner` 的多步主循环（列消息 → 组装常驻工作区 → prepare → 压缩评估 → LLM → 并行工具 → checkpoint → 落 tool_results → doom-loop → usage 回锚）。旁挂三张进程内表（abort / stream / agent 定义），外加 `runChildAgent` 递归子代理。

**分层的真相与名义不符**：`AgentSession` 端口声明在 `domain/agent/session/`，两个生产实现在 `service/agent/impl/`，域内唯一实现是**测试假件** `InMemoryAgentSession` 且被 `public/agent.ts` 公开导出。域层因此看不见真实契约——`hideRange` / `truncateAfterMessage` 两个零调用方法就是这么活下来的（RT-10）。

**最大的架构债是「读路径全量物化」**：`chat_message` 的 `listBySession` 走 21 列并逐行 inflate，而 runner 在**每个 step** 里至少物化两次可见全会话（`:405` 自己一次、`:506` 的 visible-floor 触发器再一次），gemini 协议还多一次含 hidden 的更宽全量读（`:587-588`）。压缩后 hidden 占多数，于是「收窄了 includeHidden 还是卡」——因为收窄只砍行数，砍不掉每行的 inflate 成本，而 `messageContentPool` 的 4M 字符预算在千条 × 长正文会话上命中率掉到 0.53（RT-03）。**这三条是本簇唯一的 P0，且修法已现成**：`:405` 与 `:506` 合并成一次零风险；gemini 那条抄 `invalidateSessionApiPromptTokenEntry` 的失效范式做 memo 或做窄读口。

**第二个结构性问题是「抽象建了、接线没做」**：S-8 的 `IntegrityRepairRegistry` 5 个 operation 只接了 1 个（RT-移交）；`AgentStreamRegistry` 四张表**只写不读**，每个 token 都在 push 无人 join（RT-15）；`EphemeralOverlayAgentSession` 91 行 + runner 内 8 处分支零生产调用（RT-14）；`BuiltinToolContext.listSessionMessages` 三处装配零消费者（RT-24）。这些不是 bug，是**为未落地功能预留的孤儿**——reduce 阶段的正确处置不是「删」，而是「把取舍上交」。

**第三个问题是事件收口的对称性缺口**：主 run 有完整的前奏终态收口（`publishPreludeRunFinished/Failed` + `runnerEmittedTerminal` 观测窗，五道检查点全有测试钉），`runChildAgent` 侧**只有 finally 没有 catch**（RT-07）——子 run 前奏 4 处真 IO 抛错就一条终态都不发，而子会话单元已经被 `SUBAGENT_CHILD_SESSION_CREATED` 建出来了。

**可观测性欠账集中在「停止」这条链上**：10 个 abort 检测点各带一个精心命名的分支标签（`loop_start` / `after_assemble_workplace` / `after_compaction_eval` …），全部落进 `_branch` 未用的黑洞（RT-17）；`onRunFailed.stage` 恒为 `"runner.run"`，前奏 7 个 stage 标签全是死写（RT-20）。这与 RULE 记载的「2026-09-30 停止不即时生效」两次排查直接相关——**下一次复发时日志里没有任何信息可用**。

**配置型自伤集中在 doom-loop**：`runtime.doomLoopThreshold` 的 schema 是 `int().positive()`，值 1 会让**首次工具调用必抛 doom loop**（RT-09）；`doomLoopCrossRoundWindow` 取奇数或 <4 则跨轮检查静默变 no-op（同一根因的下半段）。都是「合法配置 + 静默错误行为」。

**缓存生命周期对 runner 读路径的因果链**：`sessionApiPromptTokenCache` 是模块级单例、`clearAll()` 生产零调用，而 rebootstrap（备份导入 / 云同步 pull）只清解压双池——云同步拉回同一条会话谱系时 sessionId 逐字相同，进程内热层继续拿旧库的 token 值作答，**同时污染 UI chip 和压缩阈值判定**（RT-22）。同型的还有 `file_cache` 清域四条高频路径全不调度 blob GC（RT-23），以及后台回填 `setTimeout(0)` 窗口里清域后旧正文被写回（RT-24b）。

**本簇的拍板项（标 intentional，不入台账）**：abort 注册前移到函数入口（`has()` 是双端判活源）、回合快照每 run 取一次、abort/stream 双层所有权比对 unregister、`publishPreludeRunFinished` 的 `runId:''` 硬约束、`searchMessages` 无 LIKE 粗筛、压缩不清 `rule_snapshot`/`file_cache`（2026-09-29 拍板）、`contentBodyPool` 键为明文 sha256 故无失效机制、legacy agent 字段迁移闸门、`listBySessionStatuses` 手工 `IN` 拼接防语法错。

---

## 台账

### P0

| ID | 位置 | 问题 | 多源 | 复核 | 建议 |
|---|---|---|---|---|---|
| **RT-01** | `service/agent/impl/agent-runner.ts:587-588`（装配 `logic/assemble-agent-runner-deps.ts:67-68`） | gemini 协议下**每 step** 一次全会话全量读（21 列、含 hidden、无 `includeHidden:false`），而消费方 `gemini-content-mapper.ts:339` 的 `buildToolUseLookup` 只要 tool_use 的 `id`/`name` | w3-xc-fullread-1 + w2-core-service-agent「数据访问」表（独立登记了 `:587-588` 这条每 step 读） | **已复核**：`:586-589` 确在 `for (let step...)`（`:398`）体内，条件 `protocol === "gemini"`；`assemble-agent-runner-deps.ts:67` 确认是裸 `listBySession(toolCtx.sessionId)` | 优先做 **(b) 进程内 memo**（`buildToolUseLookup` 幂等单调增长，失效点照抄 `invalidateSessionApiPromptTokenEntry`）；退一步做 (a) 窄读口。**覆盖 hidden 是有意的、全量读不是**，两件事分开改 |
| **RT-02** | `impl/agent-runner.ts:405` + `:506`（→ `domain/compaction-conditions/triggers/visible-floor.trigger.ts:21`） | runner 每 step **两次**独立全会话读：`:405` 自己 `session.list()`，`:506` 的 `shouldRequestCompaction` 经 `VisibleFloorTrigger` 再 `session.list()` 一次 | w3-xc-fullread-2 + w2-core-service-agent「每 step 全量可见读」条目 | **已复核**：`:398` 起 for 循环、`:405` 在循环首段；`:504-522` 传 `this.deps.session` 给条件评估；`visible-floor.trigger.ts:21` 确认 `await session.list()` 且只用 `visible.length > floor`。两次读**互不共享** | 把 `:506` 换成复用 `:405` 已拿到的 `visible.length`（触发器入参改传条数）——**零新增接口、零语义风险、立刻减半**。进一步可上 `listVisibleMessagesSince(sessionId, anchorSeq)` |

### P1

| ID | 位置 | 问题 | 多源 | 复核 | 建议 |
|---|---|---|---|---|---|
| **RT-03** | `infra/content-cache/logic/decoded-content-cache.ts:186-187` | `MESSAGE_CONTENT_POOL_MAX_CHARS = 4M` / `MAX_ENTRIES = 4096`，实测「千条 × 长正文（≈10M 字符工作集）」形态下扫完后 `poolHitRatio = 0.53`、**暖读耗时 == 冷读**——顺序扫把自己刚塞的条目逐出 | w3-xc-fullread-3（自标 P1→P2 犹豫） | 未复跑基准（复刻件）；采信报告口径，标 **数量级可用、绝对值不可当回归线** | RT-01/RT-02 修完后单次扫描量下降，本条自然缓解大半；**先不单独动内存预算**（需产品拍板 16→32 MB）。若单独处理：把上界提到「最大可见工作集 × 2」 |
| **RT-04** | `domain/agent/model/agent-definition.schema.ts:222-229` + `logic/validate-agent-definition.ts:73-89` | 域模型 `prompts.persist` 是**数组**、wire 是 `Record<name, block>`，非单射折叠。唯一的重名守卫 `assertUniqueBlockNames` 只在 `validateAgentPromptLayout()` 里，而 LLM 写路径走 `assertWritableAgentDefinitionShape`——它不调那个守卫，且 `toWire` 的折叠**发生在 decode 之前**，decode 结构上不可能发现重名 | w2-core-agent-1（+ F-18 指出同款序列化循环在 `validate-agent-prompt-layout.ts:345-351` 有守卫版副本） | 主代理已三步实锤（status.md「core-agent P1」） | `definitionToDocument` 改为先 `validateAgentPromptLayout(def.prompts)` 拿归一布局再序列化——**一次性消掉本条与 F-18 两个副本** |
| **RT-05** | `impl/agent-runner.ts:789` / `:798`（抛点） vs `:712` / `:930`（落库条件） | doom-loop 两道守卫抛错时 assistant 消息**已在 `:690-712` 落库**（`assistantAppendedInRun = true`），catch 里 `persistMessages && !assistantAppendedInRun` 不成立 ⇒ **不落任何失败消息**，直接发 FAILED 再 rethrow。转录里留下一条只有 tool_use、没有 tool_result 的**悬空 assistant** | w4-runner-pro-7（单方） | **已复核**：`:690` append → `:712` 置真 → `:789/:798` 抛 → `:914` catch 非 abort 分支 → `:930` 条件为假 → `:953` 发 FAILED → `:960` rethrow。LLM 侧由 `normalizeOrphanToolResultsForLlm`（`:580`）兜住，UI 侧是永不收敛的工具 chip | 给 doom-loop 单独一条 catch 分支（或在 `:789` 前预判会抛则先落错误消息再抛），保证策略性失败也有可回查痕迹。**自 P2 升 P1**：模型原地打转是高频用户场景，且现有注释（`:924-928`）自称「失败原因从一次性 toast 变为持久可回查」，本条正是该承诺的破口 |
| **RT-06** | `impl/agent-runner.ts:844-845`（+ 门 `:866` / `:965`） | `vfsMutated` 由**工具名单**（模型请求的 toolUses）推导，与执行结果无关：degraded（参数 JSON 非法、根本没跑）、工具跑失败都算突变 | w2-core-service-agent-9 + w4-runner-pro-8（两方独立发现、同一 file:line） | **已复核**：`:844` 在 `:807-842` 填实 `outcomes` **之后**但仍只看 `toolUses`；`:866-871` 的 checkpoint 门与 `:965` 的 FINISHED 门都依赖它；`:813-827` 的 degraded 分支确认会产生 `ok:false` 的 outcome | 改 `outcomes[i].ok === true && anyToolUseMutatesWorkspace([toolUses[i]])`。后果量级：一次参数写错的 `write` 触发 desktop `ShellNavProvider` 整棵工作区树 reload + 一次多余 checkpoint 快照。**假阴性方向不存在**（判定保守），是性能/噪声不是正确性 |
| **RT-07** | `logic/run-agent-turn.ts:1119`（try）/ `:1319`（finally，无 catch） | `runChildAgent` 只有 `try/finally`，**没有 catch**，与主 run 的 `publishPreludeRunFailed`（`:466-477`）不对称。前奏 4 处真 IO（`agentRegistry.list()` `:1144` / `effectiveSkills` / `session.append` `:1194` / `preferences.getSubagentStreamEnabled` `:1298`）任一抛错 ⇒ 该 childSessionId **一条终态事件都不发**，而 `SUBAGENT_CHILD_SESSION_CREATED`（`:1229` 的闭包内）已把子会话单元建出来了 | w2-core-service-agent-2 + w4-runner-pro-9（两方独立发现） | **已复核**：`:1119` try、`:1319` finally、其间无 catch；`:1185-1194` 的 append 与 `:1298-1300` 的偏好读都在 try 内且是真实抛点。跨 zone 未验：mobile 单元是否有 keep-alive/settled 超时兜底 | 补 catch 调 `publishPreludeRunFailed(runtime, childScope, error)` 后 rethrow（该 helper 已是 scope 化的，可直接复用）。**置信分层**：代码形状 confirmed、用户可见挂起 suspected（需 synth-apps-mobile 侧确认 `session-stream-unit-manager` 的兜底）→ 见争议 D-1 |
| **RT-08** | `service/template/impl/template-pull.service.ts:24-36` | 模板拉取覆盖 session 域 VFS + 目录规则行，但**不清 `rule_snapshot` 也不清 `file_cache`**，也没调 `clearSessionPromptCaches`；而 `loadOrFillFileCache` 命中即无条件返回、**无 mtime 校验** ⇒ 下一次 assemble 的 `<file>` 块与 workplace 指纹的 bodyLength 段一起陈旧 | w3-xc-cache-lifecycle-1（w2-core-service-vfs P1-1 独立撞车，跨簇） | **已复核**：`clearSessionPromptCaches` 全仓生产调用方只有 `character-card-import.service.ts:197` 与 `vfs-zip-io.service.ts:259` 两处导入路径，template-pull 全文无调用 | 事务提交后、`runDeferredBlobGc` 旁调 `clearSessionPromptCaches(sessionId, kkv)`（best-effort 语义与导入一致）。需按 `createSessionKkvService` 就地建服务 |

### P2

| ID | 位置 | 问题 | 多源 | 复核 | 建议 |
|---|---|---|---|---|---|
| RT-09 | `domain/agent/logic/doom-loop.ts:42-53` + `model/agent-definition.schema.ts:148` | `threshold = 1` 时 `toolUses.length < 1` 不成立 → `[x].every(...)` 恒真 ⇒ **首次工具调用就抛 DOOM_LOOP**。schema 是 `z.number().int().positive()`，接受 1 | w2-core-agent-5（+ F-19 同根因下半段：`doomLoopCrossRoundWindow` 取奇数或 <4 时跨轮检查静默变 no-op） | **已复核**：schema `:148/:149` 两处均 `int().positive()`；doom-loop `:43-53` 逻辑与 `:78-84` 的 guard 形状确认 | schema 改 `int().min(2)`；`doomLoopCrossRoundWindow` 改 `int().min(4).refine(偶数)`；两处再各加一道 `Math.max()` 兜底 |
| RT-10 | `domain/agent/session/agent-session.port.ts:52,60`（+ 三个实现） | `hideRange` / `truncateAfterMessage` **生产零调用**。全仓 `.hideRange(` 命中的接收者都是 `MessageService`/`MessageRepository` 上的同名不同接口；真实压缩链路走 `run-compaction.ts:66 → runHideMessageAction`。且 `truncateAfterMessage` 的端口注释说「abort 时回滚避免残留 partial」，而 `agent-runner.ts:680/729` 的 abort 路径明确**保留** partial——语义相反。测试里唯一钉住它的是 `agent-runner-abort-rollback.test.ts:584` 的**恒真存在性断言** | w2-core-agent-2 + w2-core-agent-3 + w4-runner-pro-15（三源合并） | **已复核**：`git grep hideRange/truncateAfterMessage` 在 `packages/core/src` + `apps` 内的非测试命中全部是实现/委托/`MessageService` 同名方法 | 删端口方法 + 三个实现 + 那条无牙断言；若判定「agent run 内压缩」是待接线能力，注释里写明接线计划与 owner |
| RT-11 | `domain/agent/session/impl/in-memory-agent-session.ts`（整文件）+ `public/agent.ts:33` | 测试假件住在生产树并被**公开导出**为 `@novel-master/core/agent` 的 API。14 个消费方全在 `packages/core/test/**`，`apps/**` 零引用。且它与生产在 seq 发号上分叉（`this.seq += 1` 单调计数器，删尾不回退；生产走 `MAX(seq)+1`，回滚后复用 seq） | w2-core-agent-14 + w2-core-agent-4（同根因合并） | 采信报告（域内端口/实现的 file:line 逐条可核） | 迁到 `packages/core/test/` 或 `src/testing/`，并从 `public/agent.ts` 摘掉。迁走前先修 seq 口径，否则迁移会把错误口径一起带走 |
| RT-12 | `logic/validate-agent-tool-policy.ts:63`（`tools.deny != null`） vs `logic/resolve-agent-tool-registry.ts:22`（`policy.deny != null && length > 0`） | allow/deny 互斥与空集语义在两个文件各实现一遍且判定不一致：校验层认为 `deny: []` 算「设了 deny」（与 allow 并存会抛互斥错），装配层认为「没设」（走全放行）。目前靠「校验一定先于装配跑」侥幸不炸 | w2-core-agent-6（单方） | 未单独复核（两处均为 2 行条件，读报告引文即可核） | 抽共享归一化纯函数返回 `{kind:"all"\|"allow"\|"deny", names}`，两处共用 |
| RT-13 | `domain/agent/session/agent-session.port.ts:16` vs `service/agent/impl/{chat,ephemeral-overlay}-agent-session.ts` | 端口在 `domain/`，两个生产实现却在 `service/agent/impl/`。域层因此看不到真实契约——这正是 RT-10 那两个死方法能长期存活的结构原因 | w2-core-agent-8 | 采信报告 | 下沉实现到 `domain/agent/session/impl/`，或至少在端口加 `@see` 指向真实实现方。**w2-core-agent 自己标注无法单独判定往哪边改**（下沉会引入对 `MessageService` 的反向依赖）→ 随 RT-10 的删除决策一并处理 |
| RT-14 | `service/agent/impl/ephemeral-overlay-agent-session.ts`（91 行）+ `impl/agent-runner.ts:228-230,366,504,743,868,930,983` + `agent.port.ts:24` | 整个 overlay 唯一激活条件是 `persistMessages === false`，**生产零调用方**（`run-agent-turn.ts:976` 不传、`:1314` 显式 `true`）。类头 `{@link runRunAgentAction}` 指向全仓不存在的符号 | w2-core-service-agent-7 + w4-runner-pro-14 + adv-L4 | **已复核**：`git grep persistMessages` 生产侧只有 `:1314` 的 `true`；符号 `runRunAgentAction` 全仓 0 命中 | **争议 D-2**：检察官主张删整类 + `persistMessages` 字段 + 6-8 处分支；辩护人主张保留（`AgentRunOptions` 是 public 契约、runner 内 8 处行为分叉各有测试）。reduce 立场：**事实成立，处置上交**。无论保留与否，悬空 `{@link}` 必改 |
| RT-15 | `service/agent/agent-stream-registry.port.ts:76-82` + `create-agent-stream-registry.ts:19-20,58-63` | 四张表在生产环境**只写不读**：`append` 在每个 text/thinking delta 上 push，一路累积到 step 末被 `reset` 清空，全程无人 `join`。port 头注释自认「无生产调用方」，其援引的「core-transport Q3」全仓查无出处 | w4-runner-pro-13（adv-B7 部分辩护但承认依据不可核） | **已复核**：`git grep streamRegistry` 在 `apps/**` 生产侧只有三处 runtime 构造 + 两处类型声明，`.get(`/`.has(` 零调用（仅测试 mock）。mobile 的 partial 走 `SessionStreamUnit.partialTextSegments` 自建 | **争议 D-3**：二选一——① 补一条 `streamRegistry.get(sessionId)` 的 IPC 读口（子会话页首屏用）；② 判定死子系统整块删。reduce 立场：无论选哪条，port 头注释的立论必须改掉 |
| RT-16 | `impl/agent-runner.ts:561`（每 step） vs `:301`（每 run） | `inferLlmProtocolFromSavedModelId` 留在 step 循环内，而它首行就是 `savedModels.findById(...)`、必要时再 `providers.findById`——这些入参 run 内恒定不变，`:301` 已经把同一个 savedModel 查出来缓存成 `savedModelForAppend` 了。同循环里 `tools`（`:273`）与 `skillsIndex`（`:277`）都被正确提升到循环外 | w4-runner-pro-4（单方） | **已复核**：`:398` for 循环、`:561` 在体内、`:301` 在循环外；`infer-llm-protocol-from-model-id.ts:25/:39` 确认两次查询 | 提到循环外与 `tools`/`skillsIndex` 并列。`maxSteps` 默认 20 ⇒ 每 run 白付 20~40 次查询，全在首字延迟关键路径上 |
| RT-17 | `impl/agent-runner.ts:341-343`（+ 10 处调用点 `:400,407,437,457,524,646,683,803,891,917`） | `handleAbort` 是 `async` 但体内无 `await`，却被 10 处逐一 `await`；参数 `_branch` 在 10 个精心命名的标签（`loop_start` / `after_assemble_workplace` / `after_compaction_eval` …）**一个都没被记录** | w4-runner-pro-2（adv-B3 辩护 + adv-L6 自认） | **已复核**（`:400/:407/:524` 三处调用点与标签确认；函数体一行） | 改同步 `markAborted(branch)`，`branch` 挂进 FINISHED payload 或 `console.debug`。**adv 的辩护只对 `async` 成立**（「将来要在 abort 路径做收尾不必改签名」），对「标签全丢」不成立——adv 自己在 L-6 承认「有意保留与忘了删之间没有分界」。本仓已两次因「停止不即时生效」做专项排查，第三次复发时日志里没有任何信息可用 |
| RT-18 | `logic/run-agent-turn.ts:749-767` + `service/coordinated-write.ts:124-127` | `CoordinatedWrite.run()` 只对**成功执行完毕**的步骤调 rollback。`capture` 步骤写入中抛错 ⇒ 其 `rollback`（`messageCheckpoint.release`）不执行；`append` 步骤在 `messages.append` 成功、`onUserMessageAppended()`（`:737`）抛错 ⇒ `:739-744` 的补偿删除也不跑，**留下一条没有 checkpoint 的 user 消息**，S-13 的 baseline 不变式被打破 | w2-core-service-agent-13（单方） | 未单独复核（引文自足） | 把「部分成功也需补偿」显式化：`execute` 内部自建 try/catch 做局部补偿，或把 `CoordinatedWrite` 语义补一句「execute 抛错视为未完成、不补偿」并修正调用点注释（**当前注释与行为相反**） |
| RT-19 | `logic/assemble-agent-runner-deps.ts:19,33-37,50-51,56` | 三重：① `:19` 注释引用的 `EventActionDeps` **全仓不存在**；② `savedModels`/`providers` 两个别名分支零生产调用方（两处调用点传的都是 `AgentTurnRuntimePort`，其字段名是 `savedModelRepo`/`providerRepo`，`??` 右侧恒 undefined）；③ `:56` 的 `as SavedModelRepository` 是**掩盖 undefined 的类型断言**——`savedModelRepo` 在入参类型里是可选的，两者都没给时运行期就是 `undefined`，而 runner 在 `:301` 直接 `this.deps.savedModels.findById(...)` | w4-runner-pro-11 + adv-L2（辩护人自认） | **已复核**：`EventActionDeps` 仅命中该注释行与一份历史 spec；`git grep savedModels ??` 确认只有 `:50/:51` | 删两个别名字段与 `EventActionDeps` 引用；`savedModelRepo` 改必填去掉 `as`（让类型系统兜住）。若要留口子用显式判空抛错 |
| RT-20 | `logic/run-agent-turn.ts:489,609,618,632,646,720,754,783,955` + `:1009-1011` | `stage` 唯一读取点是 catch 里的 `onRunFailed`（`:1011`），被 `if (runnerEntered)` 包住；`runnerEntered` 在 `:973` 置真，而 `stage` 在 `:955` 已写成 `"runner.run"`，其间无再赋值 ⇒ **`onRunFailed.stage` 恒为 `"runner.run"`**。前奏 7 个 stage 标签全是死写。desktop `agent-run.service.ts:97-99` 与 mobile `:83-84` 都把 `ctx.stage` 打进错误日志 ⇒ **线上失败日志里该字段无诊断价值，前奏期故障与 runner 期故障同形** | w2-core-service-agent-5（重复赋值部分）+ w4-runner-pro-1（stage 恒定部分）+ adv-L5（三源合并） | **已复核**：`:955` 赋值 → `:973` 置真 → `:1009-1011` 读取，中间无赋值；`:618`/`:632`/`:646` 的 `"resolve-agent"` 三次赋值确认 | 拆成「前奏失败 / runner 失败」两个回调入口（各自带真实 stage），或在前奏 catch 里也回调。先删掉 `:618`/`:632`/`:646` 三处同名不同义的重复标签 |
| RT-21 | `logic/run-agent-turn.ts:619-623`（session 分支） vs `apps/desktop/src/main/ipc/handlers/agent.ts:418-421`（workspace 指针） | 同一个 run 有两条 agent 解析路径：core 内部走 `resolveAgentForProject`（RULE 36：**永远**走 session 分支），desktop IPC 预检走 `resolveCurrentAgentDefinition`（`state.getCurrentAgentId()` 的 workspace 指针）。预检校验的模型与实际会跑的模型**可能来自两个不同 agent** | w4-runner-pro-23（单方） | 未复核（跨 zone 到 apps/desktop） | IPC 预检改走 `resolveAgentForProject`，或干脆删掉预检让 `runAgentTurn` 的 `mapResolveError` 承担报错。两个方向都会错：会话 agent 没配模型 ⇒ 消息已 append 才抛；workspace agent 没配 ⇒ 明明能跑却被先拒 |
| RT-22 | `bootstrap/novel-master-bootstrap.ts:331-345` + `infra/tokenizer/logic/session-api-prompt-token-cache.ts:29,48` | rebootstrap（桌面 `rebootstrapDesktopRuntime` 同进程 close→重建服务图，备份导入与云同步 pull 都走它）只清了解压双池。`sessionApiPromptTokenCache` 是**模块级单例、无上界 Map**，其 `clearAll()` **生产零调用**。云同步拉回同一条会话谱系时 sessionId 逐字相同、内容不同 ⇒ 进程内热层继续按旧库的 `promptTokens` 作答，**既污染 UI chip 又参与压缩阈值判定** | w3-xc-cache-lifecycle-4（跨簇：w1-desktop-main P1-1、w2-mobile-runtime F-2 同族） | **已复核**：`sessionApiPromptTokenCache` 的全部非测试引用只有 store 自身 + `public/provider.ts` 的 re-export；bootstrap 里无 `clearAll()` 调用 | 在 `clearDecodedContentCaches()` 旁补 `clearSessionScopedInProcessCaches()`，或把进程级缓存统一挂到一个注册表由 bootstrap 统一清。**跨簇去重见争议 D-5** |
| RT-23 | `domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts:325-343` + `domain/session-kkv/logic/deferred-file-cache-gc.ts:29-42` | 清 `file_cache` 域的四条高频路径（置位 / 规则保存 / 导入 / tail 截断）删掉引用行后**一律不调度 GC**，孤儿 `session_file_cache_blob` 跨重启残留。GC 只有 3 个调度点（删会话 / 删项目 / 手动清理），`runStartupMaintenanceOnce` 有进程级去重且只在两个一次性后台迁移跑完时触发 | w3-xc-cache-lifecycle-3（跨簇：w2-core-small F-6 同族） | 采信报告（`git grep runDeferredFileCacheGc` 三处调度点口径自足） | 抽 `clearSessionFileCacheDomain(conn, sessionId)` helper：内部 `clearDomain` 后 `void runDeferredFileCacheGc(conn)`（对齐 `deferred-revision-orphan-gc.ts` 既有先例），四处改调。**量级未实测**（需真机查 `count(*)` / `page_count` 增长曲线） |
| RT-24 | `domain/tool/builtin/builtin-tool-context.ts:174`（+ 装配 `run-agent-turn.ts:851` / `:1200` / `create-user-vfs-turn-service.ts:67`） | `listSessionMessages` 是**必填非可选**字段，于是每个 toolCtx 装配点都必须提供一条「全会话含 hidden 全量解压」的读口；注释点名的消费者 `chat_grep` 工具**在仓库中不存在**。因为是惰性闭包，**今天没有性能代价**（这是 w2-core-service-agent 对 W1 结论的反发现，status.md 已采纳） | w2-core-service-agent-3 + w3-xc-fullread-9（两源合并） | **已复核**：`git grep listSessionMessages` 非测试命中仅 1 处类型声明 + 3 处装配 | 风险在**契约形状**而非当前开销：任何人未来补一个消费它的工具，会静默引入大会话秒级读，而三处装配点都不会提醒。删字段（三处装配 + 14 个测试 mock 一起清）或改 `?:` 可选并标注「chat_grep 已下线」 |
| RT-24b | `domain/workplace/logic/load-or-fill-file-cache.ts:114-127,160-162` + `service/workplace/assemble-workplace-display.ts:175-187` | 2026-09-30 引入的后台回填把「压缩 + 落库」推到 `setTimeout(0)` 宏任务之后。若在这一个宏任务窗口里发生置位 / 规则保存 / 导入（三者都 `clearDomain(file_cache)`），在途回填会在清域**之后**把清域前读到的旧正文写回 ⇒ **旧正文复活**。窗口窄（一个宏任务），但 assemble 是逐文件循环、每个 miss 文件各登记一个宏任务，长前缀下窗口被拉长 | w3-xc-cache-lifecycle-7（单方） | 未单独复核 | `scheduleBackfill` 加会话级 generation 计数器（`clearDomain` 时 +1），回调写回前比对，不匹配则丢弃。**仓库已有同款先例**：`usage-stats.service.ts:540-560` 的哨兵协议 |
| RT-25 | `logic/run-agent-turn.ts:847-928`（主） vs `:1196-1278`（子） | `BuiltinToolContext` 装配逐字段复制：13 字段、82 行 vs 82 行、trim 后逐字相同 42 条。已出现可见漂移：probe 变量名一边 `toolProbe` 一边 `baseRegistry`；`agents` 注入的注释一边说「子/孙摘除后不注入」一边说「mode==="all" 且 depth<2」 | w4-runner-pro-17（adv-B14 强烈反对重构） | 采信双方量化（adv 给的 7 处语义差异清单可核） | **采纳辩护人立场**：7 处差异（vfs 取父 scope / workplace 取父 / sessionId 取子 / ChatAgentSession 三参 / resolveChildModelId 父 pin vs 子 / parentSignal / depth / includeCompactionOrchestrator=false）全部承载语义，抽公共函数要引入 7-8 个参数消 40 行重复，收益可疑。**降 P3 记为「有条件接受债」**：若孙代理再加第 8、9 处差异则性价比翻转 |

### P3

| ID | 位置 | 问题 | 复核/来源 |
|---|---|---|---|
| RT-26 | `domain/agent/repositories/impl/sqlite-session-run-state.repository.ts:21-35` | 同一 `rowToState` 里 `token_source` 做了收窄函数、`status` 却是无校验 `as` 断言。DDL 自建表起即有 `CHECK (status IN (...))`（w2 已 `git show 0aaeacde` 实测）⇒ 现网不会脏 | **自 P2 降 P3**：靠 SQL CHECK 兜底、代码层零防御不是活跃 bug。保留是因为 `tokenSource` 就在旁边做了正确示范，反差明显 |
| RT-27 | `logic/validate-agent-definition.ts:73-79` vs `config-forms/stored-config-validity/assess-agent-definition-wire.ts:30-52` | 「是不是域形态 AgentDefinition」被独立实现两次；后者还靠**子串匹配**去命中 schema 侧写下的错误消息文本（`prompts.blocks` / `preferredModelId` …），任何人润色报错文案就静默退化 | w2-core-agent-15。提一份共用实现；legacy keyword 表改由 schema 侧导出常量 |
| RT-28 | `domain/agent/logic/doom-loop.ts:48-50` vs `:66-68` | 同一个「同名 + 同 JSON input」谓词在 96 行文件里两份实现（`assertNoDoomLoop` 内联手写，`sameToolUse` 就在同文件 `:66`） | w2-core-agent-11。`tail.every((t) => sameToolUse(t, first))` |
| RT-29 | `logic/generate-agent-run-id.ts:10-12` | 零逻辑透传包装；全仓其余 8 处 id 生成都直接调 `randomUUID` | w2-core-agent-12。删包装，规则统一 |
| RT-30 | `logic/validate-agent-tool-policy.ts:23-26` + `:34` | `raw` 在 `:34` 已归一一次，`migrationHint` 进来又归一一次（幂等，当前无害） | w2-core-agent-13。噪音级 |
| RT-31 | `logic/validate-agent-definition.ts:88-99` + `infra/serialization/decode.ts:20` | 一次 `decode()` 会抛**两个不同类、code 字符串相同**的错误（`AgentConfigError("INVALID_SCHEMA")` 与 `ConfigDecodeError("INVALID_SCHEMA")`）。现存两处都用 `instanceof` 当前安全，但任何新写的 `err.code ===` 比较会混为一谈 | w2-core-agent-16。不紧急，加注释即可 |
| RT-32 | `public/agent.ts:27-33` + `model/agent-definition.schema.ts:25,136` | 公开面一批零域外消费方：`DOOM_LOOP_THRESHOLD` / `CROSS_ROUND_WINDOW` / `assertNoDoomLoopInBlocks` / `assertNoCrossRoundDoomLoop` / `agentDefinitionDocumentSchema` / `validateAgentToolPolicy` / `InMemoryAgentSession`（后者已单列为 RT-11）。讽刺的是 doom-loop 的**基元** `assertNoDoomLoop` 没导出 | w2-core-agent-9 + -10（合并）。**移交 synth-dead 批次**统一删 |
| RT-33 | `impl/agent-runner.ts:403`（声明） / `:527`（读） / `:548`（写） | `stepCompactionEmitted` 声明在 **for 循环体内**（每 step 重置），读在写之前且同 step 内无其它置真路径 ⇒ `!stepCompactionEmitted` **恒为 true**，这个「防重复」守卫是纯装饰 | **自 P2 降 P3**（w4-runner-pro-3）。**已复核**。当前行为无害（压缩在 if 里，天然每 step 至多一次）；危险在于形状骗人——有人照它的意图再加一处压缩入口会误以为已有去重 |
| RT-34 | `impl/agent-runner.ts:909-912` + `:248` | `if (step + 1 >= maxSteps) { stopReason = "max_steps"; break; }` —— `stopReason` 初始化即 `"max_steps"`，且 for 条件在 `step+1 === maxSteps` 时本来就会自然终止 ⇒ 整个 if 是「赋一个已是当前值的常量 + 跳出一个本来也会结束的循环」 | **自 P2 降 P3**（w4-runner-pro-6）。**已复核**。零行为，纯误导 |
| RT-35 | `impl/agent-runner.ts:713-725`（+ `:597`） | `streamRegistry.reset` 是**数据面**操作（清 partial 累积），却被塞进「是否发布生命周期事件」的分支；同 step 另一半 `append` 的门槛是另一个条件（`options.stream && publishRunLifecycle`）。三处条件耦合在两个不同语义上 | w4-runner-pro-5。**降 P3**：`publishRunLifecycle: false` 当前无生产调用方，两条路今天等价 ⇒ 潜伏缺陷。移出 `if` 与 `append` 共用同一判据 |
| RT-36 | `impl/agent-runner.ts:394`（预取） vs `:399`（首个 abort 检查） | `$filetree` 回合快照的预取在 step 循环外、循环内第一个 abort 检查**之前**。进入 runner 时 signal 已 aborted 仍会付一次完整 `workplace.renderFileTree()` | w2-core-service-agent-8。窗口窄（`run-agent-turn.ts:941` 检查点②已先拦大部分），挪到检查点之后即可 |
| RT-37 | `logic/run-agent-turn.ts:625-630`（空输入校验） vs `:612`（backfill） | 空输入校验排在 `backfillMissingBaselines` **之后**。用户敲了空白点发送，仍要付整轮全量 backfill 扫描才拿到「消息不能为空」。检查点⓪（`:600`）只拦已 abort，不拦空输入 | w2-core-service-agent-10。把 `hasInput` 判定提到 backfill 之前（resume 分支仍需 backfill，留在原位） |
| RT-38 | `service/agent/impl/agent-registry.service.ts:124-140` | `assertUniqueDisplayName` 每次 upsert 做 `listIds` + **逐条串行 await `repository.get(otherId)`**（N+1）；且解码失败时**静默降级成用 UUID 当显示名**参与比较 ⇒ ① 一行坏数据（`prompts_json` 非法）会让它的名字变成 UUID，报 `DUPLICATE_NAME` 时信息误导；② 坏数据行的真实重名被漏检（`task` 工具按 name 查找会取到不确定的那个） | w2-core-service-agent-11（N+1 视角）+ w4-runner-pro-26（正确性视角，两源合并）。改走 `repository.list()` 内存比对；解码失败**跳过并 warn**而不是拿 id 顶替名字 |
| RT-39 | `domain/tool/builtin/subagent-tool.ts:219` | 每次 task 工具调用一次**子会话全量读**，只为取末条 assistant 的 text | w3-xc-fullread-8。末条 assistant **可能**在若干条 tool_result user 之后 ⇒ `tail(1)` 不安全。加 `listBySessionTailOfRole(sessionId,'assistant',limit)`，limit 取 5~10。**责任面属 domain/tool，转交 synth-core-misc** |
| RT-40 | `logic/run-agent-turn.ts:335` + `:1091` | 两处在共享 `AbortSignal` 上挂 `addEventListener(..., { once: true })`，**全程无 `removeEventListener`**。不 abort 就永久挂着：`:335` 挂在 caller 传入的 signal（组件级复用则 N 次消息挂 N 个闭包），`:1091` 挂在父 run 的 `internalController.signal`（父 run 存活期内每派发一个 task 子 run 多挂一个） | **已复核**（`git grep addEventListener/removeEventListener -- service/agent`）。w4-runner-pro-16。功能无害、闭包线性增长。finally 里摘（handler 提成具名引用） |
| RT-41 | `logic/run-agent-turn.ts:342` + `create-agent-abort-registry.ts:20-22` | 入口无条件 `register`（拍板项），而实现是 `map.set` 直接覆盖 ⇒ 同 sessionId 第二个 run 会**静默夺权**：用户点停止命中的是新 run 的 controller，旧 run 从此无法被 registry 中断；旧 run 的 finally 因所有权不匹配不删 map，若新 run 已结束则 `has()` 返 false ⇒ mobile 的「该会话已有进行中生成」门禁失效 | w4-runner-pro-19（自标 suspected）。三端 host 都有并发门禁（desktop `isDesktopAgentActive()`、mobile `abortRegistry.has`、cli 串行）⇒ **防御纵深缺失而非现网必现**。**争议 D-4** |
| RT-42 | `logic/run-agent-turn.ts:515-517`（注释承诺） vs `:529`（实现） | `runnerEmittedTerminal` 只按 `sessionId` 过滤，**无 runId 维度**。注释承诺「读到的永远是本 run 窗口内的事实」，实现的是 sessionId 语义。另一并发 run 的终态也会把标志置真 ⇒ 主 run 前奏 catch 会跳过补发 FAILED('') ⇒ 双端 refcount 泄漏 / `uiRunning` 永久 true | w4-runner-pro-20（自标 suspected）。**口径差本身 confirmed**。改 `markRunnerTerminal` 比对 `payload.runId === runId` |
| RT-43 | `logic/agent-run-shared.ts:40-49` vs `:57-71` | `resolveCurrentAgentId` 与 `resolveWorkspaceAgentForNewSession` 逐行同构 | w4-runner-pro-22。**采纳辩护人 B-13**：两者入参形状确实不同（后者是 `{state, agentRegistry}` 子集，服务端自己没有 sessions 字段），收窄是必要的类型解耦。P3 备注即可 |
| RT-44 | `logic/run-agent-turn.ts:1144` + `:1172-1177` | `runChildAgent` **无条件** `agentRegistry.list()` 拉全部 agent 定义，但 `assembleAgentsToolContext` 在 registry 不含 `agent` 工具时立即返回 undefined，而 task 的子代理与孙代理都被 `resolveAgentToolRegistry` 强制摘除 `agent` 工具 ⇒ 对绝大多数子 run 这次 IO 只有一个消费者会立刻丢弃 | w4-runner-pro-18（收益量级 suspected）。降级为惰性求值。`callable` 仍需全量，保留一次拉取共用 |
| RT-45 | `logic/run-agent-turn.ts:289-298` + desktop/mobile 各一份 | `mapResolveError` 三份拷贝，三份的 `AgentRunResolveError → AgentTurnError` 映射语义必须永远一致否则错误码漂移 | w4-runner-pro-24。纯函数，随 `runAgentTurn` 一起导出即可 |
| RT-46 | `logic/run-agent-turn.ts:184,203,225` vs `public/agent.ts` | 三个装配器 `assemble{Skills,Search,Agents}ToolContext` 都 export，但 public barrel 没转出，消费方只有 run-agent-turn 内部两处 + **三份 core 测试深引 service 内部路径** | w4-runner-pro-25。`run-agent-turn.ts` 因此是「对外契约 + 测试缝」混合模块，拆文件则测试全线断 |
| RT-47 | `service/agent/impl/agent-registry.service.ts:157` vs `:108-112` + `:72` | upsert 侧用 `defaulted.name.trim()` 比对保留名 `general`，delete 侧直接用 wire 原始 `name` ⇒ 口径不一致。历史脏数据（`name` 带首尾空白）能通过 delete 门把内置保留名 agent 删掉 | w4-runner-pro-27（suspected，需一条脏数据才触发）。三处统一走 `normalizeDisplayName(raw)` |
| RT-48 | `create-agent-stream-registry.ts:80-90` | `unregister(sessionId, handle?)` 的 handle **可选**（省略时直接删），注释说是兼容不关心所有权的调用方——但**没有任何调用方省略 handle**。这条「兼容路径」是能误删别人 partial 的地雷，而姊妹 API `AgentAbortRegistry.unregister` 的 controller 是必填、类型层面就杜绝了 | w4-runner-pro-28。把 handle 改必填，与 abort registry 对齐 |
| RT-49 | `impl/agent-runner.ts:987-999`（写终值） vs `:964-972`（发 FINISHED） | run 级 API 占用的**终值**写入发生在 FINISHED **之后**，而 FINISHED 同步分发 ⇒ 下游此刻读到旧值。desktop `onCoreRunFinished → refreshChatTokenStatsAfterRun` 正是「run 结束读一次占用」的注入点 | w4-runner-pro-29（suspected）。把终值写入挪到 FINISHED publish 之前（同步热层 + fire-and-forget，挪动无 IO 代价） |
| RT-50 | `logic/run-agent-turn.ts:567-604,774-781,800-804,828-832,941-947,1130-1134,1164-1168` | 「检查点命中 → 发 FINISHED('') → 返回合成 cancelled」这个 4 行块在主 run 出现 **5 次**、子 run **2 次**，共 7 份逐字复制。而 `preludeAbortResult()` 与 `publishPreludeRunFinished()` 本身就是为此抽的两个 helper，唯独把两者配对调用这步没抽 | w4-runner-pro-30。抽 `finishPreludeCancel()`，7 处收敛。语义一改要改 7 处，漏一处就是「有的检查点发 FINISHED 有的不发」 |
| RT-51 | `logic/run-agent-turn.ts:133-134` | `AgentTurnRuntimePort.userVfsTurn?` 成员自带注释「本模块不再使用」，`git grep` 在 service/agent 内只命中这一行。RULE 第 12 条已记载 user ops 链路整体拆除 | w4-runner-pro-21。删成员及其 import |
| RT-52 | `logic/run-agent-turn.ts:585-939`（实测 283 行） | 收口 `try`（`:585`）体在 `:586-653` 是 4 空格缩进，`:655-937` 整块**掉到 2 空格**（实测 283 行），`:939` 起恢复 4 空格。花括号闭合正确、行为无碍，但 try/catch 边界在视觉上被抹掉 | **三源合并**：w2-core-service-agent-4（约 290 行）+ w4-runner-pro-10（283 行）+ adv-L1（**65 行，数字明显错，以 reduce 实测为准**）。这一段恰是 r3-run-1/3/4 四轮打补丁的战场（检查点①②③④ 全在里面）。**定级 P3**（纯格式，零行为），但危害实打实：后续任何 diff 的噪声源。独立小 PR 补一级缩进 |
| RT-53 | `infra/tokenizer/logic/prompt-whole-cache.ts:363-366` | `promptWholeCache.clearSession` 生产零调用（`git grep` 只命中 KKV 层同名转发）。`buckets` 每会话一桶且**桶本身无上界**、`persistedItems` 与两个 `seededSessions` Set 同样按会话无界增长；删会话后全部残留 | w3-xc-cache-lifecycle-5。无脏读（键含 sessionId + 内容指纹，id 不复用），纯资源。在 `session.service.ts` 的 GC 旁补调 |
| RT-54 | `domain/chat/logic/chat-annotate-draft-store.ts:14` | `bySession` Map 无删会话挂点也无 rebootstrap 挂点。删会话后草稿残留（内存，无正确性影响）；rebootstrap 后同 sessionId 的旧草稿会被 `chipsFromAnnotateStore` 投影成 composer chip | w3-xc-cache-lifecycle-6 |
| RT-55 | `domain/chat/repositories/impl/sqlite-message.repository.ts:160` + `infra/sql-template/parser.ts:45-55` | `private readonly parser = new SqlTemplateParser()` 是**实例字段**，而 repository 普遍 per-call 新建（`reposFor(conn)` / `new SqliteMessageRepository(tx)` 等，全仓 23 处）⇒ `TemplateParser.astCache` 在绝大多数调用里都是**冷启动即抛**，这层缓存近乎零命中，纯负债 | w3-xc-cache-lifecycle-8。**争议 D-6**：与 w2-core-infra-sql 的 P1「AST 缓存无界、2000 arity 吃 337MB」结论方向相反，需 L3 合并后派 W6 复核 |
| RT-56 | `service/workplace/impl/workplace-view-cache.ts:55-66` | conn 级 `WeakMap<conn, Map<scopeKey, entry>>` 的内层 Map 每 scope 一条、**永不淘汰**；rebootstrap 换 conn 后 WeakMap 自动冷（该设计正确）。失效靠读时签名校验，**不会返回陈旧读** | w3-xc-cache-lifecycle-11。纯资源增长 |
| RT-57 | `service/session-fs/create-session-fs-service.ts:1` | 文件首字节是 UTF-8 BOM。core 内共 4 个文件带 BOM（另三：`domain/vfs/logic/extract-mutating-paths.ts`、`infra/llm-protocol/logic/sse-parse-errors.ts`、`tool-arguments-parse.ts`） | w2-core-service-agent-12。**转交 synth-apps-mobile 之外的 xc-encoding 批次**统一处理（与 U+FFFD 编码纪律同批） |
| RT-58 | `docs/apm/RULE.md:13` | RULE「hidden 消息」条目把「过滤逻辑」指向 `domain/agent/session/`——该目录下唯一做 hidden 过滤的是**测试假件** `in-memory-agent-session.ts:29`，生产过滤在 `service/agent/impl/chat-agent-session.ts` | w2-core-agent-21。文档修正建议（`docs/apm/` 本轮只读，不由本代理执行） |
| RT-59 | `infra/tokenizer/logic/chat-token-estimate-memo.ts:152-171` | memo 键含「消息尾戳（数量:末seq:长度和）」，同长度异内容的编辑键不变 ⇒ 返回编辑前的读数 | w3-xc-cache-lifecycle-13。**intentional，模块头已显式接受**（label 短暂陈旧、下一轮消息事件自愈），记录以免重复排查 |

### intentional（明确不报，仅防重复）

`sqlite-session-run-state.repository.ts:110-123` 手工拼 `IN (...)` 防语法错（w2-core-agent-23）｜`mergeAgentDefinitionPatch` 的 `as unknown as`（文件 doc 已声明有意，w2-core-agent-17）｜`SessionRunStateTokenSource` 历史别名（w2-core-agent-20）｜legacy agent 字段迁移闸门（w2-core-agent-22）｜`listBySessionStatuses` 空数组短路（w2-core-agent-23）｜abort 注册前移 + `has()` 判活（adv-B8，9 处生产消费方）｜回合快照（adv-B15/adv 附注）｜`wrapStreamForBus` 单 microtask 合批（6 条测试钉死，adv-B10）｜`chat-agent-session.ts:35` 的 `includeHidden:false`（2026-09-30 性能修复，adv-B16）｜`agent-run-lifecycle-helpers.ts` 留在 core（分层正确，adv-B17）｜`extractSubagentSessionIdFromOutcome` 与内部检测互补（`resolveSubagentSessionIdFromOutcome` 是私有的，adv-B11）｜gemini 全量读的**协议门**（`:582-585` 注释：openai/anthropic 不消费，覆盖 hidden 有意）——**注意：有意的是"覆盖 hidden"，不是"全量读"，见 RT-01**｜压缩不清 `rule_snapshot`/`file_cache`（2026-09-29 拍板）｜`contentBodyPool` 无失效机制（键为明文 sha256，同键必同值）｜`searchMessages` 全量 + 内存精筛（RULE 32 拍板）｜解压池"命中不查库"的明文寿命延长（模块头已接受）。

---

## 对抗裁决（w4-runner-pro 逐条 vs w4-runner-adv）

**口径**：upheld = 事实与定级均成立｜mitigated = 事实成立但辩护人的反驳改变了定级或处置｜dismissed = 事实不成立。**降级**单独标注。

| pro 条目 | adv 立场 | 裁决 | 落点 |
|---|---|---|---|
| F-01 onRunFailed.stage 恒定 | L-5 只认重复标签 | **upheld**（P2） | RT-20 |
| F-02 handleAbort async + 标签全丢 | B-3 辩护 async 与标签；L-6 自认标签无落点 | **upheld**（P2）；adv 辩护**仅对 async 成立**，标签必须落日志或删参数 | RT-17 |
| F-03 stepCompactionEmitted 恒真 | 无 | upheld，**降 P3** | RT-33 |
| F-04 每 step 协议推断 | 无 | **upheld**（P2） | RT-16 |
| F-05 reset 被事件开关裹住 | 无 | upheld，**降 P3**（当前无生产调用方传 false，两路今天等价） | RT-35 |
| F-06 max_steps 分支冗余 | 无 | upheld，**降 P3**（零行为） | RT-34 |
| F-07 doom-loop 不留痕 | 无 | **upheld，自 P2 升 P1** | RT-05 |
| F-08 vfsMutated 按名单 | 无（w2-core-service-agent-9 独立同发现） | **upheld，自 P2 升 P1** | RT-06 |
| F-09 子 run 无 catch | 无（w2-core-service-agent-2 独立同发现） | **upheld**；置信分层：形状 confirmed / 可见性 suspected | RT-07 → 争议 D-1 |
| F-10 缩进断层 | L-1 让步（数字 65 行有误） | **upheld**（P3）；行数以 reduce 实测 **283 行** 为准 | RT-52 |
| F-11 assemble deps 双别名 | L-2 **自认** | **upheld**（P2） | RT-19 |
| F-12 projects 必填未读 | B-6 辩护成立（public 签名墓碑，删要同步三端） | **upheld，降 P3** | RT（清理项，附 RT-20 端口清理批） |
| F-13 streamRegistry 只写不读 | B-7 承认事实、反对单方面删 | **upheld**（P2，事实层）；**处置上交** | RT-15 → 争议 D-3 |
| F-14 EphemeralOverlay 死代码 | B-9 反对删（public 契约 + 8 处行为分叉 + 6 条测试） | **mitigated，降 P3**；处置上交 | RT-14 → 争议 D-2 |
| F-15 AgentSession 两个死方法 | 无（w2-core-agent-2/3 独立同发现，三源） | **upheld**（P2） | RT-10 |
| F-16 abort 监听器不摘 | 无 | upheld，**降 P3**（功能无害） | RT-40 |
| F-17 toolCtx 42/82 重复 | B-14 **强烈反对重构**（7 处语义差异，量化 42/82） | **mitigated，降 P3，记为有条件接受债** | RT-25 |
| F-18 子 run 无条件 list() | 无 | upheld，**降 P3**（收益量级未证） | RT-44 |
| F-19 register 覆盖夺权 | 无 | upheld，**降 P3**（三端 host 门禁存在） | RT-41 → 争议 D-4 |
| F-20 runnerEmittedTerminal 只按 sessionId | 无 | upheld，**降 P3**（注释与实现的口径差本身 confirmed） | RT-42 |
| F-21 userVfsTurn 自认不使用 | 无 | **upheld**（P3） | RT-51 |
| F-22 resolveCurrentAgentId 重复 | B-13 **辩护成立**（入参形状不同、收窄必要） | **mitigated**（P3 备注，不改） | RT-43 |
| F-23 双 agent 解析路径 | 无 | **upheld**（P2） | RT-21 |
| F-24 mapResolveError 三份拷贝 | 无 | **upheld**（P3） | RT-45 |
| F-25 三装配器为测试 export | 无 | **upheld**（P3） | RT-46 |
| F-26 assertUniqueDisplayName | 无 | **upheld**（P3，含正确性子项） | RT-38 |
| F-27 general 保留名 trim 口径 | 无 | **upheld**（P3，suspected） | RT-47 |
| F-28 stream unregister handle 可选 | 无 | **upheld**（P3） | RT-48 |
| F-29 API token 终值写在 FINISHED 后 | 无 | upheld，**降 P3**（suspected） | RT-49 |
| F-30 检查点 4 行块 7 处复制 | 无 | upheld，**降 P3**（可维护性） | RT-50 |

**adv 辩护成立（B-1/B-2/B-8/B-10/B-12/B-13/B-15/B-16/B-17）**：9 条，全部标 intentional / 不报。其中 B-8（`abortRegistry.has()` 是双端判活源，9 处生产调用方）**反过来锁死了** `:342` 的注册位置——任何以"简化"为名把注册挪回 runner 起步前的改动都会打掉 mobile token 读口抑制、desktop 停止按钮与发送门禁。这条建议写进 L3 的「勿动清单」。

**adv 六条让步项**：L-1→RT-52、L-2→RT-19、L-3→并入 RT-15、L-4→并入 RT-14、L-5→并入 RT-20、L-6→并入 RT-17。**6/6 全部转入台账**，无一条被辩护人挡下。

**汇总**：pro 30 条 → upheld 27（其中 10 条降级、2 条升级）、mitigated 3、dismissed 0。**降级 10 条的共同原因**：pro 用 P2 覆盖了「代码形状成立但今天无用户可见路径 / 零行为」两类，其中 4 条（RT-33/34/35/50）经 reduce 实测是**零行为或恒等**，8 条是潜伏缺陷。**升级 2 条**（RT-05/06）的原因：RT-05 打在代码注释自己承诺的「失败原因持久可回查」上，RT-06 有双源独立发现 + 三处消费门（checkpoint / STEP_COMMITTED / FINISHED）。

---

## 跨簇移交（不在本台账计数，避免 L3 重复记账）

| 移交目标 | 条目 | 说明 |
|---|---|---|
| synth-core-data | w3-xc-fullread-4（`session.service.ts:374` copy 事务内全量读 + `reposFor` 无 yieldFn）、fullread-5（`message.service.ts:444` 空锚 truncateAfter 应用 `listIdsAfterSeq`）、fullread-6（backfill 每轮 N+1，`findCheckpointMessageIdAtOrBefore` 已存在只差接线）、cache-lifecycle-2（`truncateMessagesAfter` 漏失效 prompt_tokens + usage_stats） | 与 w2-core-service-chat / w2-core-checkpoint / w4-msgstore 三份输入**同题**。本簇保留「读路径全量物化」的架构叙事，台账条目请 L3 指定单一 owner |
| synth-core-storage | w3-xc-cache-lifecycle-1（模板拉取漏清两域，= w2-core-service-vfs P1-1，**主代理已实锤**）、w2-core-service-agent-1（IntegrityRepairRegistry S-8 抽象只落地 1/5） | RT-08 是本簇 RT-22 的上游触发条件之一（陈旧读），因果关系保留在本簇 |
| synth-core-misc | w3-xc-fullread-8（`subagent-tool.ts:219` 每 task 全量读子会话） | 责任面在 `domain/tool/builtin` |
| synth-dead | RT-32 一批零消费公开导出 | 与 L0/dead-exports 及 w3-xc-dead-core 的删除批次合并 |
| 编码批次 | RT-57（4 个文件带 BOM） | 与 w3-xc-encoding 的 U+FFFD 修复合并成一次编码卫生 PR |

---

## 争议上交（8 条）

**D-1 · RT-07 子 run 前奏抛错的用户可见性（core-runtime ↔ synth-apps-mobile）**
pro-09 自标 suspected（"子会话页会不会真的挂起"跨 mobile zone 未验，pro 明确点名 `startKeepAliveQuietly` / `settledGraceMs` 可能已兜住）；w2-core-service-agent-2 标 confirmed。代码形状无争议（`try/finally` 无 catch 已复核）。**需 synth-apps-mobile 侧回答**：mobile `session-stream-unit-manager` 对 starting/running 态是否有 keep-alive 或超时自愈。答"有"→ 降 P3；答"无"→ 维持 P1。

**D-2 · RT-14 EphemeralOverlayAgentSession 去留（产品决策，非技术）**
检察官（pro-14）：事件编排器已随 `0dae8526` 删除，生产零调用 ⇒ 91 行类 + 6-8 处分支 + `AgentRunOptions.persistMessages` 公开字段全死。辩护人（B-9）：`persistMessages` 是 public port 契约的一部分，runner 内 8 处行为分叉（overlay run 的 usage 不落 KKV / 失败消息不落库 / 空回复占位不落库）各有测试锁定，删掉等于收窄公开契约。**reduce 无法判定**：事实双方一致，分歧是"契约宽度算不算债"。需用户拍板是否收窄 `AgentRunOptions` 公开面。无论结论如何，悬空 `{@link runRunAgentAction}` 必改。

**D-3 · RT-15 AgentStreamRegistry 去留（同 D-2 形状）**
pro-13 主张整块删；adv-B7 承认"无生产调用方"但反对单方面删（mobile 侧 partial 已由 `session-stream-unit` 自持，语义重叠不冲突）。需确认：子会话页首屏是否有走 core registry `get()` 的路线图？有 → 接线（补一条 IPC 读口）；无 → 整块删 + 改掉 port 头注释里查无出处的「core-transport Q3」。

**D-4 · RT-41 abortRegistry 覆盖夺权是否值得加 core 层自守**
pro-19 判 suspected，理由是三端 host 都有并发门禁。但端口文档（`agent-abort-registry.port.ts:25-28`）把覆盖写成了预期行为，而后果链（旧 run 永久失去中断能力 + 旧 run 结束后 `has()` 返 false 打穿发送门禁）是完整的。**问题**：这种"host 门禁 + core 无自守"的分层惯例，本仓是继续沿用（则记为 intentional 冗余层缺失）还是在 core 补一道 `register` 重入检测？

**D-5 · RT-22 rebootstrap 缓存残留的跨簇去重**
同一根因在三个簇被独立报出：本簇 cache-lifecycle-4（`sessionApiPromptTokenCache` 跨库陈旧读）、synth-apps-desktop（w1-desktop-main P1-1 单例 rebootstrap 陈旧句柄）、synth-apps-mobile（w2-mobile-runtime F-2 `forgetSession` 零调用）。**需 L3 合并为一条**，否则台账会记三次。建议统一表述为"进程级派生缓存与库不同寿命"一族，列出全部 6~8 个未挂失效点的缓存。

**D-6 · RT-55 sql-template AST 缓存容量结论冲突**
`w2-core-infra-sql` 判 **P1**：「AST 缓存无界，`IN (...)` 动态绑定名每变体一份永不逐出，实测 2000 arity 吃 337MB」。`w3-xc-cache-lifecycle-8` 判 **P3**：「`parser` 是实例字段而 repository 普遍 per-call 新建（全仓 23 处），这层缓存**近乎零命中**，纯负债」。两者对同一层的容量结论方向相反。**需 L3 派 W6 验证**：到底有没有长寿命 parser 实例（bootstrap / 长驻 service）让缓存真的涨起来？若无 ⇒ 338MB 是误报，该删缓存；若有 ⇒ 是 P1 内存炸弹。**本簇不做判定**（责任面属 `infra/sql-template`，在 synth-core-storage 范围）。

**D-7 · RT-08 模板拉取的单一 owner**
`w3-xc-cache-lifecycle-1` 与 `w2-core-service-vfs` P1-1 是**同一处代码的两次独立发现**（主代理已实锤，见 status.md「core-service-vfs」行）。本簇按输入文件计入 RT-08，请 L3 确认只记一条。

**D-8 · RT-25 toolCtx 装配重复的处置窗口**
adv-B-14 主张"不建议本轮合并"（7 处语义差异，抽公共函数要 7-8 个参数消 40 行重复）。但报告同时预言"若孙代理再加第 8、第 9 处差异，届时性价比会翻转"。**问题**：L3 的优化 backlog 排期是按"立即重构"还是"记触发条件、下轮再评估"来记这条？reduce 倾向后者（写明触发条件：子 run 装配再增一处语义差异即重开）。

---

## W6 验证队列（reduce 提名）

1. **RT-03** 消息池 4M 字符上界 —— 需在 `packages/core/dist` 构建后跑现成基建 `packages/core/test/chat/message-content-perf-threshold.test.ts`，取真实命中率而非复刻件数字。
2. **RT-05** doom-loop 失败不留痕 —— 需实跑一次 doom loop 场景，确认 UI 上是否真的留下不收敛的工具 chip、转录里是否真的没有文字说明。
3. **RT-06** vfsMutated 假阳性 —— 需构造一次"参数非法的 write"，验证 desktop `ShellNavProvider` 是否真的整树 reload。
4. **RT-07** 见争议 D-1。
5. **RT-22** rebootstrap 陈旧读 —— 需实跑一次云同步 pull 后读 chip，比对进程内 Map 与库内 `prompt_tokens` 行。
6. **RT-23** file_cache blob 增长 —— 需真机长会话 + 反复置位/改规则，查 `count(*)` 与 `page_count` 曲线（报告自标量级未实测）。
7. **RT-24b** 回填竞态 —— 需在 `setTimeout(0)` 窗口内注入置位，验证旧正文是否复活。
8. **RT-09** doomLoopThreshold=1 —— 需实跑一个 `runtime.doomLoopThreshold: 1` 的 agent 定义，确认首次工具调用即终止（逻辑已复核，仅需实跑确认用户可见症状）。
9. **D-6** sql-template AST 缓存 —— 需在 `infra/sql-template` 范围内确认长寿命 parser 实例是否存在。
