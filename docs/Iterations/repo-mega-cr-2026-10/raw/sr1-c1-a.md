---
zone: wave-c1 · 组 A（全量读收窄系列）
agent: readonly reviewer（spec-check-loop）
baseline_sha: fe79b781
scope: C1-1 / C1-2 / C1-3 / C1-4 / C1-5 + 全量 listBySession 残留名单现状核验
read_docs:
  - docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一章 + 第四章）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-c1.md（C1-1~C1-5 + N-1~N-7）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/SPEC.md（§2 分片分配表）
  - docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md（§2.3 / §8 / §10 Wave C / §8.1 RT-01 终裁）
  - docs/apm/RULE.md:125 / :126 / :139 / :16 / :46
---

## 0 · 审查口径

- 全部行号与引文在 `fe79b781` 上**逐处重新打开核对**（Read 工具定点读 + findstr 定位），台账/raw 行号漂移以本文为准。
- 病症从现行代码**重推导**，不采信 spec 的结论表述。
- 验收按「牙齿三判据」判：① 断言面可被实现者触达 ② 修复前红/修复后绿 ③ 不依赖人眼/不依赖未声明的前置。
- 性能断言一律计数式，本组五条**无一条卡毫秒**，符合 RULE「性能护栏取数量级回归线」与 wave-c1 N-7.1。

---

## 1 · 逐条 verdict 表

| 条目 | 病症代码重推导 | 证据行号核对 | 修法可行/完备 | 验收可测（牙齿） | 回归线实存 | 依赖闭合 | verdict |
|---|---|---|---|---|---|---|---|
| **C1-1** fork 上界读口 | ✅ 成立。`message.service.ts:320` 事务外 `listBySession` 读整会话，`:330` 事务内 `filter(m => m.seq <= upTo.seq)` 丢弃锚点后尾巴 | ✅ 全部命中：`:320`、`:330`、port `:17-20`/`:54-57`、repo `:263-299`、`:285-299`、`:387`、`:133-137`、`mapRows :243-244`/`:250-259`、`:28`(21 列) | ⚠️ 可行但有 2 处缺口（见 M-1/M-2） | ⚠️ I1/I2/I4/I5 计数式且可测；**I3 事实错误**（M-3）；R2 落「人眼核对」不满足判据③（M-4） | ✅ `test/chat/`、`test/vfs/read-ref-count.test.ts`、`test/vfs/read-ref-safety.test.ts`、`test/message-checkpoint/` 均实存；`test:fast` script 实存（`package.json:122`） | ✅ 无前置 | **条件通过** |
| **C1-2** truncateAfter(null 锚) | ✅ 成立。`:479` 事务外 21 列全量读，`:480` 取 ids，`:481` 才开事务 → 孤儿 checkpoint 窗口真实存在 | ✅ `:479/:480/:481/:491-496` 逐行命中；`MESSAGE_SELECT_COLUMNS :28` = 21 列（实测数列）；`truncate-tail-in-transaction.ts:72-87` 与 `:79-85` 硬约束注释在位 | ⚠️ 窄投影 + 移进事务方向正确且与 CD-02 反转注记一致（`delta-overview.md:206` 确认旧修法已过期）；但 5 处缺口（M-5~M-9） | ❌ **I5 TOCTOU 断言在真实 sqlite 语义下必然失败**（M-6）；I1/I3/I4 可测；I2 需与「仍 parse」口径并列表述（M-7） | ✅ 同上 + `test/session-kkv/`、`test/helpers/sql-counting-connection.ts` 实存 | ✅ C1-5 依赖本条，方向正确 | **条件通过** |
| **C1-3** subagent-tool:219 | ✅ 成立。`:219` 全量子会话读喂 `extractLastAssistantText`（`:93-107` 从尾倒扫） | ✅ `:218/:219/:220`、`:93-107`、`:96-105`、repo `listBySessionTail :353-373`、`DefaultMessageService :153-158` 全部逐字命中 | ❌ **不完备：`MessageService` 接口未加方法 → 编译红**（M-10）；既有 3 个测试 mock 只提供 `listBySession` → 必红（M-11） | ⚠️ I1 在「真跑一次 task」口径下与 agent 每 step 的 `listBySession(includeHidden:false)` 冲突，计数不可能为 0（M-12）；I2/I3/I4 可测 | ⚠️ 4 个 subagent-tool 测试文件实存，但 3 个的 messages mock 需同步改（M-11） | ✅ 无前置 | **条件通过（阻断项最重）** |
| **C1-4** listSessionMessages 死字段 | ✅ 成立。`builtin-tool-context.ts:174` 声明 + 3 处装配，生产侧 `.listSessionMessages(` 零命中（已实测） | ⚠️ 装配行号全对（`:174`、run-agent-turn `:912-913`/`:1269-1270`、`create-user-vfs-turn-service.ts:67`）；但**计数错**（M-13） | ✅ 修法可行 | ✅ I1 编译级 / I2 / I3 grep 级，三条都可测 | ✅ `test/tool/` 实存 25 个 `.test.ts` | ⚠️ 与 Wave D 批次 3 二选一，N-4 已写明，闭合 | **条件通过** |
| **C1-5** deleteSessionTree 事务内全量读 | ✅ 成立。`session.service.ts:227` 在递归删除事务内拉全会话正文只为 `.map(m => m.content)` | ✅ `:197/:198/:218-221/:227` 全部命中；copy 现 `:388`（确认 raw `:374` 已漂移）；`reposFor` 实际 `:49-56`（spec 写「:44-51 附近」，轻微漂移） | ⚠️ 复用 C1-2 读口可行；可选 yieldFn 透传路径描述不准（M-15） | ✅ I1（3 次）/I2/I3/I4 可测 | ✅ `test/session-fs/`、`test/vfs/`、`test/agent/` 实存 | ✅ 依赖 C1-2，闭合 | **条件通过** |

**verdict 计数**：条件通过 5 / 成立 0 / 不通过 0；其中含 **3 条阻断级 must-fix**（M-10、M-11、M-12 全在 C1-3；M-6 在 C1-2）与 **1 条覆盖缺口**（M-14）。

---

## 2 · 残留名单现状核验表

「全量读收窄系列」要求把 residual `listBySession` 消费面盘清。下表为**在 `fe79b781` 上实测**的全仓生产调用点（`packages/core/src` + `apps/*/src`，排除 node_modules/dist/测试），
并标注是否已被 `e2d10b3f`（agent 每步读收窄）或其他既有改动收窄。

| # | 位置 | 形态 | e2d10b3f 后现状 | 归属 | 结论 |
|---|---|---|---|---|---|
| 1 | `service/agent/impl/chat-agent-session.ts:36` | `listBySession(id, {includeHidden:false})` | ✅ **已被 e2d10b3f 收窄**（SQL 层 `AND hidden = 0`，不取 hidden 行字节） | RT-02 的读数面 | 已修，Wave C 只需在 RT-02 落时消第二次读 |
| 2 | `service/agent/logic/assemble-agent-runner-deps.ts:74` | `listBySession(id, {includeHidden:false})` | ✅ **已被 e2d10b3f 收窄**（`listVisibleSessionMessages`） | RT-01（本体在 wave-b-core1 B1-6） | 已修「含 hidden」半；残留「21 列 + 无 memo」归 B1-6 |
| 3 | `service/chat/impl/message.service.ts:320` | 21 列全量，含 hidden | ❌ 未收窄 | **C1-1** | 本组覆盖 |
| 4 | `service/chat/impl/message.service.ts:479` | 21 列全量，含 hidden，**事务外** | ❌ 未收窄 | **C1-2** | 本组覆盖 |
| 5 | `domain/tool/builtin/subagent-tool.ts:219` | 21 列全量，含 hidden | ❌ 未收窄 | **C1-3** | 本组覆盖 |
| 6 | `service/chat/impl/session.service.ts:227` | 21 列全量，**写事务内** | ❌ 未收窄 | **C1-5** | 本组覆盖（名单外新发现） |
| 7 | **`service/chat/impl/project.service.ts:179`** | 21 列全量，**写事务内**，BFS 逐会话 | ❌ 未收窄 | **无任何条目认领** | ❌ **覆盖缺口（M-14）**：与 C1-5 同型同读口族（`(await r.messages.listBySession(session.id)).map(m => m.content)` → `aggregateReadRefs` → `adjustReadRefCount(-1)` → `deleteBySession`），删项目路径逐会话重复；wave-c1 的 C1-5 与 N-5 均未提及 |
| 8 | `service/chat/impl/session.service.ts:388` | 21 列全量，写事务内（copy） | ❌ 未收窄 | `wave-c2.md` C2-3（CS-11） | 跨片已认领，N-3 边界写明，闭合 |
| 9 | `service/agent/logic/run-agent-turn.ts:913` | `listSessionMessages` lambda 包 `listBySession` | ❌ 未收窄，但**生产零消费者** | **C1-4** | 死字段，删装配即消失 |
| 10 | `service/agent/logic/run-agent-turn.ts:1270` | 同上（子代理） | ❌ 同上 | **C1-4** | 同上 |
| 11 | `service/chat/create-user-vfs-turn-service.ts:67` | 同上 | ❌ 同上 | **C1-4** | 同上 |
| 12 | `service/chat/impl/message.service.ts:133-137` | 转发层 | — | 保留（N-5.3 已说明 UI/CLI 需全量语义） | 有意保留 |
| 13 | `apps/mobile/src/services/session-prompt-input.service.ts:95` | `includeHidden:false` | ✅ 已被 2026-09-30 首字延迟轮收窄 | — | 已修 |
| 14 | `apps/desktop/src/main/services/session-prompt-input.service.ts:81` | `includeHidden:false` | ✅ 同上 | — | 已修 |
| 15 | `apps/mobile/src/services/chat-prompt-tokens.service.ts:458` | `listBySession` + JS `.filter(m => !m.hidden)` | ❌ 未收窄（**复核逐字仍在位**） | N-5.2 登记为债务（不进本波） | 与 spec 描述一致，闭合 |
| 16 | `apps/cli/src/agent/commands.ts:194-195` | 同上 | ❌ | N-5.2 债务 | 闭合 |
| 17 | `apps/cli/src/model/commands.ts:87-88` | 同上 | ❌ | N-5.2 债务 | 闭合 |
| 18 | `apps/cli/src/prompt/commands.ts:136-137` | 同上 | ❌ | N-5.2 债务 | 闭合 |
| 19 | `apps/cli/src/message/commands.ts:115/172/184` | 全量（`:115` 后面还要 filter hidden，但 `:121-128` 需遍历 hidden 打 `[H]`） | ❌ 但**有正当理由** | raw F-11 已判定 `:116` 不算 | 闭合（`cli/message` 需全量） |
| 20 | `apps/mobile/src/services/session-messages-loader.ts:19` | 转发读口 | ❌ | apps 面，N-5.4 邻近 | 未认领但冷路径 |
| 21 | `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx:97` | 兜底全量 | ❌ | apps 面 | 未认领但冷路径 |
| 22 | `apps/desktop/src/main/ipc/handlers/messages.ts:140` | `MESSAGES_LIST` 全量 + 全量 IPC 克隆 | ❌ | N-5.4（raw F-12，apps 面） | 闭合 |

**核验小结**：spec 的 N-5 债务登记（CLI 4 处 + mobile `chat-prompt-tokens:458` 仍在位）与实测一致；
`e2d10b3f` 已收窄的两处（#1、#2）确认到位。
**唯一实质缺口是 #7 `project.service.ts:179`**——它与 C1-5 是同一段代码形态、同一读口族、同样在写事务内，
但既没进 C1-5 的修法，也没进 N-5 的债务登记。wave-c1 号称覆盖「全量读收窄残留」，此处漏了一格。

---

## 3 · 关键交叉核对（任务点 ①②③④）

### ① 修法与 RULE 既有失效语义是否兼容

| RULE 记录 | 与本组修法的关系 | 结论 |
|---|---|---|
| `:125` 每 step/每轮全量读必须头投影或 SQL 滤 hidden；**换实现必须同步换观测面** | C1-1/C1-2/C1-3/C1-5 都把 `listBySession` 换成新方法 → 既有 spy 观测面失效 | ✅ 兼容，且 N-7.2 已显式写明「C1-2 的 I1 必须直接 spy 新方法名 + 在 `spyFullSessionReads` JSDoc 补一句」。实测 `backfill-cursor.test.ts:256-299` 的 `contentCallCount()` 守的是 backfill 路径（走 `listBySessionOffset`），本组四条修法不触碰该路径，**不会被静默失效**；新的「零次全量读」锁由各条 I1 独立承担 |
| `:126` checkpoint backfill「无空窗」短路第二段恒失败 → 全量扫描是常态，必须按热路径验收 | 本组四条都不是 backfill 路径，但都按热路径口径写了计数断言 | ✅ 兼容 |
| `:139` 给读路径挂缓存后「读必抛」型断言必须换观测面 | 本组**不新增任何进程内缓存**（新读口都是无缓存直读） | ✅ 不触发。但 C1-5 可选步骤 3（`reposFor` 加 `yieldFn`）会改变 `mapRows` 分支形态 → 已有 `test/chat/message-repository-yield.test.ts` T-R2a 守的是 `runtime.messages` 那条链，`session.service` 那条链**无既有守**，须新增计数断言（M-15 关联） |
| `:16` 删除/改写/隐藏/置位/导入/切模型失效、**纯追加不失效**（API prompt 基线）；压缩不动 rule_snapshot/file_cache | 本组四条都不触碰任何 KKV 失效挂点与 prompt 基线 | ✅ 完全兼容，无交集 |
| `:46` usage_stats.toolUseCount 失效挂点 = 新增含 tool_use / updateContent / delete / truncateAfter / 回滚 / 导入；hide/show 与纯文本追加不失效 | C1-2 重排 `truncateAfter` 空锚分支，`:500-501` 的 `invalidatePromptTokens` / `invalidateToolUseCount` 两句**必须保留** | ⚠️ spec 修法 3 的代码片段只写到 `});`，**未显式声明这两句照旧**。它们在原代码里位于事务之后（`:500-501`），重排时极易连同 `return` 一起丢。必须写进修法（并入 M-5） |
| 压缩隐藏行也是 read 引用的持有者 | C1-2 新读口**不得**加 hidden 过滤 | ❌ 缺口：若实现者照 `listBySession` 的 `includeHidden` 惯例加了 `AND hidden = 0`，hidden 消息的 `contentRef` 永不计 −1 → revision 永不 GC（内容不可再生的方向）。修法 SQL 本身没写过滤，是**断言层没钉死**（M-5） |

### ② 「换实现必须同步换观测面」的具体落点

- 本组新增两个窄读口 `listReadRefTargetsBySession` / `listBySessionTailOfRole` / `listBySessionUpToSeq`。
- 既有观测面 `backfill-cursor.test.ts` 的 `spyFullSessionReads()`（`:256-299`，实测存在）只 spy `listBySession` 与 `listMessageHeadersBySession`。
- N-7.2 已要求「新窄读口不在本 spy 覆盖内」写进 JSDoc + I1 直接 spy 新方法名。**这条做对了**。
- 缺口：spec 未要求把「本组四条路径上的 `listBySession` 必须恒为 0」立成**跨条回归锁**（当前散在四个新测试文件里）。可接受但建议在 N-7.2 补一句总锁口径。

### ③ RT-01 边界（本体在 core1，c1 只写关联读数）

- `wave-b-core1.md:19` 条目表 B1-6 = RT-01（P1）；`:847-848` 明确写「全量读收窄系列……全部属 wave-c1，本分片只负责提出统一读口」。
- `ledger-v2.md §8.1` 终裁：RT-01 定 **P1**、排 **Wave B**、修法为 memo+失效 或 tool_use 窄读口。
- `wave-c1.md` N-1 三条硬依赖：① RT-02[wave-a] 必须先落，且本分片断言**限定在具体读口方法名**上以与 RT-02 解耦；② RT-01 若走 memo 范式则 C1-2 的读口对它不可复用；③ 不要在 C1-1 读口上顺带做 RT-01。
- 实测：`agent-runner.ts:605-606` gemini 分支确为 `listVisibleSessionMessages()`，走 `includeHidden:false`，**未落 memo**；`:413` `session.list()` 与 `:516-519` `shouldRequestCompaction` 确为两次独立读。`wave-a.md:28` A1 = RT-02，依赖链成立。
- **边界清晰 ✅**。唯一瑕疵：条目总览表的「依赖」列对 C1-1/C1-2/C1-3 写「—」，而 `ledger §10 Wave C` 那一格写「**RT-02 必须先落**」。N-1 用「断言按读口解耦」解释了不冲突，但总览表没把这层写出来，读者只看总览会以为无依赖。P2 级建议。

### ④ RT-01 / CD-01 编号碰撞的处理

- `ledger-v2.md:463`（Wave C 表）写「CD-01 fork 缺上界读口」，而 §2.3 的 CD-01 是回滚 plan 与事务内状态不同源。
- spec 在 C1-1 抬头做了正名（「本条目按 **CD-13** 撰写，原始编号见 `synth/core-data.md:96`」），实测 `synth/core-data.md:96` 确为 CD-13 fork、`:97` CD-14 copy、`:98` CD-15 truncateAfter、`:100` CD-17 subagent-tool。✅ 编号对照准确。
- N-3 明确「本分片不认领真正的 CD-01，留给 judge 裁定」——**未越界** ✅。

---

## 4 · must-fix 清单（doc-fix 照抄级）

| ID | 条目 | 严重度 | 问题 | 照抄改法 |
|---|---|---|---|---|
| **M-1** | C1-3 | **阻断** | 修法 3 只写「`DefaultMessageService` 加转发方法」，但 `subagent-tool.ts:219` 的 `subagent.messages` 类型是 **`MessageService` 接口**（`builtin-tool-context.ts:45` → `service/chat/message.port.ts:18`）。接口不加方法 → `tsc` 直接红 | 修法 3 改为：「① `service/chat/message.port.ts` 的 `MessageService` 接口新增 `listBySessionTailOfRole(sessionId: string, role: string, limit: number): Promise<ChatMessage[]>`；② `DefaultMessageService` 加同款转发（照 `:153-158`）。**两处都要改，只改实现类不算修完**」 |
| **M-2** | C1-3 | **阻断** | 既有 3 个测试文件的 `MessageService` mock 只提供 `listBySession`（`test/tool/subagent-tool.test.ts:71`、`subagent-tool-parallel.test.ts:49`、`subagent-tool-vfs.test.ts:55`，均 `as unknown as MessageService` 强转）。改实现后 `listBySessionTailOfRole is not a function` → 回归线「test/tool/ 全目录全绿」与 I5/I6 必红 | 修法新增第 5 步：「同步给上述 3 个文件的 `messages` mock 补 `listBySessionTailOfRole`（照 `listBySession` 的实现形状，`:71` 的 `childMsgsBySession.get(sid) ?? []` 需按 role 过滤）」；并在「测试策略」里点名这 3 个文件 |
| **M-3** | C1-3 | **阻断** | I1「spy `listBySession` …… 跑一次 `task` → `listBySession` 调用数 **0**」与 T-SUB-TAIL1「跑一次 task」不自洽：真跑子代理时，agent 每 step 的 `session.list()` 就是 `listBySession(includeHidden:false)`（`chat-agent-session.ts:36`），计数不可能为 0 | I1 改为二选一并写死：**(a)** 沿用既有 mock 形态（`makeMockSubagent` 的 `runChildAgent` 是桩，不跑真 agent），此时 spy 面是 `MessageService` 层而非 repository prototype，断言改为「`listBySession` 0 次 + `listBySessionTailOfRole` 1 次」并**注明观测面是 service mock，不是 repository prototype**；或 **(b)** 真跑 agent，则断言必须写「`listBySession` 调用数 == step 数（全部 `includeHidden:false`）+ `listBySessionTailOfRole` == 1」。**推荐 (a)**，与既有 3 个测试文件同构、改动最小。测试策略里的「用 repository prototype spy（照抄 `spyFullSessionReads`）」一句同步改 |
| **M-4** | C1-1 | 中 | R2「`mapRows` 漏传 → 验收**必须人眼核对**」不满足牙齿判据③（不可机器验证）。仓内已有可复用的机器断言：`test/chat/message-repository-yield.test.ts` T-R2a（实测在位，断言 120 行出现 2 个让步点） | R2 改为：「新增断言 I6：用 `test/chat/message-repository-yield.test.ts` T-R2a 同款让步点计数法，断言 `listBySessionUpToSeq` 在 120 行夹具下让步 ≥1 次（证明走了 `mapRows` 分片分支而非 `rows.map` 直通）」；人眼核对降为 PR 描述里的提醒 |
| **M-5** | C1-2 | **阻断（正确性）** | ① 修法 3 的代码片段结束于 `});`，**未声明** `:500-501` 的 `await this.invalidatePromptTokens(sessionId); await this.invalidateToolUseCount(sessionId);` 照旧保留——重排时连同 `return` 一起丢会破坏 RULE `:46` 的 truncateAfter 失效挂点；② 新读口**必须不过滤 hidden**（`deleteBySession` 删全部行，过滤 hidden → hidden 消息的 `contentRef` 永不计 −1 → revision 永不 GC） | 修法 3 代码片段后补：「事务块结束后**原样保留** `await this.invalidatePromptTokens(sessionId); await this.invalidateToolUseCount(sessionId); return;` 三句（RULE `:46` 的 truncateAfter 失效挂点，删则 usage_stats.toolUseCount 不失效）」；新读口 JSDoc 补「**不过滤 hidden**：本读口产出的是「即将被 `deleteBySession` 全删」的消息集合，漏掉 hidden 行 = 漏减 read 引用 = revision 永不 GC」 |
| **M-6** | C1-2 | **阻断（验收不可通过）** | I5「在 `listReadRefTokensBySession` 的 spy 里插一条新消息 → 断言新消息要么进了 `targets` 要么没被删」在真实 sqlite 语义下**必然失败**：spy 与 `deleteBySession` 同在一个写事务、同一连接，读已发生 → 新消息不在 `targets`，却被 `deleteBySession(sessionId)` 一并删掉 → 正是断言明令禁止的「被删但 checkpoint 留着」。且「要么 A 要么 B」的析取式断言本身无牙 | I5 整体重写为**结构断言**：「在 `listReadRefTargetsBySession` 的 spy 里记录 `this.conn`（或用 `sql-counting-connection` 记录 SQL 顺序），断言该读发出的 SELECT 出现在同一连接上 **`BEGIN` 之后**、`DELETE FROM chat_message` 之前 —— 即「产出写集合的读确实在写事务内」。**不做并发注入**（单连接写事务内无法构造真正的并发窗口，用同连接注入只会稳定复现被禁止的坏状态）」 |
| **M-7** | C1-2 | 中 | I2「该次查询的 SELECT 列表不含 `raw_json` / `attachments_json` / `*_tokens`」与修法 2 的自述「本条省的是列数与事务外往返，**不是省 parse**（`content_json` 仍要整段 parse）」并列时，读者会误以为 I2 覆盖了 parse 成本 | I2 期望补一句：「`content_json` / `content_encoding` / `content_blob` **仍在 SELECT 列表内**（`collectReadRefs` 需要完整 `MessageContent`），本条收益 = 去掉 17 列中与 read 引用无关的 17 列中的重列 + 消除事务外往返，**不含 parse 成本**」 |
| **M-8** | C1-2 | 中 | R2 把坏行策略留成「两种都可接受，但必须二选一」——execute-ready spec 不应留未决二值 | 钉死默认案：「坏行按 **warn + 跳过**（对齐 `aggregateReadRefsFromAllMessages:190-195`）」，把 fail-fast 降为 PR 描述里的备选注记，不再要求实现者二选一 |
| **M-9** | C1-2 | 低 | `MessageReadRefTarget` 的类型落点未定。若声明在 `domain/chat/repositories/message.port.ts` 并从 `domain/vfs/logic/revision-ref-count.ts` import `ReadRefPointer`，会**首次**在 `domain/chat/repositories` 层引入 `@/domain/vfs` 依赖（实测该层当前零 vfs 导入），并与 vfs→chat 的既有边构成一条新的**纯类型环**（L0 口径下 runtime-safe，但会给 `L0/circular-alias` 普查新增一项） | 修法 1 补：「`MessageReadRefTarget` 的 `refs` 元素类型用 `import type { ReadRefPointer } from "@/domain/vfs/logic/revision-ref-count.js"`（**必须 `import type`**，编译后擦除、不成运行时环）；并在 PR 描述里记一笔「L0 circular-alias 普查预计新增 1 条 runtime-safe 类型环，core 从 9 环 → 10 环」 |
| **M-10** | C1-2 | 低 | 修法 2 写「逐行走 `readRowContent` **同款**双形态解码（必须复用 `decodeMessageContent`）」——「同款」易被读成「照着再写一份」。`readRowContent`（`sqlite-message.repository.ts:125-138`）是**同文件模块私有**函数，新方法就在同文件，直接调用即可 | 修法 2 改为：「逐行 **直接调用本文件既有的模块私有 `readRowContent(row)`**（`:125-138`，已含 `content_blob` 判定 + `decodeMessageContent` + `parseMessageContent`）——**不得新写一份解码分支**」 |
| **M-11** | C1-2 | 低 | 证据节写「9 个 token 计费列」，实测 `MESSAGE_SELECT_COLUMNS`（`:28`）的 `*_tokens` 列是 **5 个**（`prompt_tokens` / `completion_tokens` / `total_tokens` / `cache_read_tokens` / `cache_creation_tokens`）。按 RULE `:115`「条数/计数类结论一律实测复核」须改 | 改为「5 个 `*_tokens` 计费列 + `first_token_ms` / `duration_ms`」；同时可补一句「`seq` / `role` / `hidden` / `created_at_ms` / `session_id` 同样与本分支消费无关」 |
| **M-12** | C1-1 | 中 | 同 M-5 的 hidden 缺口在 C1-1 侧的对偶：fork 明确「Preserve hidden state」（`:376-377` 逐字在位），新读口若被加上 `AND hidden = 0`，fork 出来的会话会**丢 hidden 消息**（静默数据丢失）。修法 SQL 没写过滤，但 I2 的夹具描述「会话 100 条、锚点第 3 条」没说含 hidden 行 | I2 夹具改为「会话 100 条，**其中 ≥10 条 `hidden=true` 且分布在锚点两侧**」；期望补「hidden 行逐条保留（`hidden === true`），fork 出的消息数 == `listBySession().filter(seq<=N).length`」；修法 1 的 JSDoc 补「**含 hidden**（fork 保留 hidden 状态，见 `:376-377`）」 |
| **M-13** | C1-4 | 中 | 计数错。spec 三处写「其余 **30 处**命中全部在 `packages/core/test/**`（**14 个**测试文件）」，实测 **`packages/core/test/**` 下 65 处命中、33 个文件**（`agent-runner*.test.ts` 系列 10 个、`tool/` 10 个、`vfs/` 2 个、`chat/` 4 个等）。另「`agent-runner.test.ts` 8 次」实测 7 次（`:957/1033/1099/1199/1267/1339/1408`），「`hydrate-tool-results.test.ts` 15 次」实测 15 次 ✅ | 三处数字改为「65 处命中、33 个测试文件」；`agent-runner.test.ts` 的 8 次改 7 次；修法 4 的「14 个文件逐个删」改为「33 个文件逐个删（`Get-ChildItem -Recurse packages/core/test -Include *.ts \| Select-String listSessionMessages` 可复现清单）」 |
| **M-14** | 覆盖缺口 | 中 | `service/chat/impl/project.service.ts:179` 是与 C1-5 **完全同型**的残留（写事务内 `listBySession(session.id).map(m => m.content)` → `aggregateReadRefs` → `adjustReadRefCount(-1)` → `deleteBySession`），且在删项目路径上对 BFS 展开的**每个会话**重复一次。wave-c1 既未在 C1-5 修法中带上它，也未在 N-5 债务池登记 → 「全量读收窄系列」漏一格 | 二选一并写进 spec：**(a)** 并入 C1-5 修法第 1 步（把 `project.service.ts:176-182` 一并改为 `aggregateReadRefTargets(await r.messages.listReadRefTargetsBySession(session.id))`，并在 I1 期望里把计数从 3 改成「父+2 子 = 3（删会话）+ 项目侧按 BFS 会话数 N」）；或 **(b)** 在 N-5 债务池新增第 5 条：「`project.service.ts:179` 删项目路径同型全量读，与 C1-5 同修法，不进本波」。**推荐 (a)**——读口已经由 C1-2 引入，边际改动一行 |
| **M-15** | C1-5 | 低 | 可选步骤 3「`session.service.ts` 的 `reposFor` 加可选 `yieldFn` 并从 **`SessionServiceDeps`** 透传」路径描述不准：`SessionServiceDeps`（`:70-85`）是仓储依赖集合，`yieldFn` 属于工厂选项 `ChatServicesOptions`（`create-chat-services.ts:52-54`）。且 `createSessionService(conn, sessionDeps)`（`:114-119`）**当前不透传 options**，desktop/cli 的 session service 拿不到 `yieldFn`；mobile 走 `create-mobile-runtime.ts:113/176` 才传 | 改为：「给 `SessionServiceDeps` 增 `readonly messageRowYieldFn?: () => Promise<void>`，`reposFor(tx, yieldFn)` 透传给 `SqliteMessageRepository`；`createSessionService` 增第三参 `options?: ChatServicesOptions` 并转交；`create-mobile-runtime.ts:113/176` 的 `yieldFn` 同时喂 messages 与 sessions 两条链」；并补一条验收：「`deleteSessionTree` 在 500 条会话下让步点 ≥1（照 `test/chat/message-repository-yield.test.ts` T-R2a 计数法）——`session.service` 这条链**无既有守**，必须新立」 |
| **M-16** | C1-5 | 低 | 证据节写「`session.service.ts` 的 `reposFor` 全文见 `:44-51` 附近」，实测在 **`:49-56`**（`:44-51` 是上一段的 import 区）。虽 hedged「附近」，但本组纪律是逐处核对 | 改为 `:49-56` |
| **M-17** | 总览表 | 低 | 条目总览「依赖」列对 C1-1/C1-2/C1-3 写「—」，与 `ledger §10 Wave C`「**RT-02 必须先落**」表面冲突。N-1 已解释（断言按读口解耦），但总览表读者看不到 | 总览表「依赖」列改为「RT-02 先落（读数基线；本条断言按读口解耦，见 N-1.1）」 |

---

## 5 · 结论

**组 A：No-Go（not execute-ready）。**

一句话理由：五条的病症、行号、修法方向全部经代码重推导证实为真，但存在 **4 条阻断级缺口**——C1-3 漏改 `MessageService` 接口致编译红、3 个既有 subagent 测试 mock 未同步致回归线必红、其 I1 计数断言在真跑 task 口径下恒不成立；C1-2 的 I5 TOCTOU 断言在真实 sqlite 语义下必然失败且是析取式无牙断言，另有两处 hidden 语义缺口会分别导致 usage_stats 失效挂点丢失与 fork 静默丢 hidden 消息；外加 `project.service.ts:179` 这一与 C1-5 同型的残留既未修也未登记为债务，「全量读收窄系列」名不副实。

上述 17 条 must-fix 全部是 doc-fix 照抄级（不需重推导），闭合后本组可转 Go。
