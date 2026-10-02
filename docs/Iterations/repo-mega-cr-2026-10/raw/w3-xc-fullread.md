---
zone: xc-fullread
agent: cross-cutting
files_scanned: 41（生产代码 22 文件 + 读口实现 4 + 基准脚本 2 + 决策文档 3）
wave: W3
date: 2026-10-01
---

# W3 · xc-fullread —— 全量读残留的权威分类

## 摘要

`chat_message` 的全量读口 `listBySession` 在生产代码里还有 **21 个静态调用点**（去掉
port 声明 / 转发 / 注释共 29 处命中）。真正决定体感的不是「有多少处」，而是**调用频率**：
本报告把每处按「每 step / 每轮发送 / 每会话打开 / 一次性」四档定性，并给出每档的频率链
证据。全量读之所以贵，是因为它 `SELECT` 21 列（`sqlite-message.repository.ts:31`，含
`content_blob` 压缩正文与 `raw_json` LLM 原始响应）并对每行 inflate + `JSON.parse`；
仓库里**已经有 5 个更轻的收窄读口**（`listMessageHeadersBySession` / `listIdsAfterSeq` /
`countBySession` / `listBySessionTail` / `listBySessionFromSeq`），其中 3 处全量读有直接
的一对一替换。名单外新发现 3 个高危点：gemini 协议**每 step** 全量读、runner **每 step**
全量读（已知名单只挂了它的次要消费者 visible-floor.trigger）、fork/copy 的**事务内无
让步**全量读。

## 职责与边界

- 职责：全仓「读整会话消息正文」这一类读口的普查、定性、替换方案、优先级。
- 不在范围：写口 / 索引 / schema；`searchMessages`（intentional，见 F-16）；只读口的
  逐个实现审计（归 W2-core-sql / W2-core-chat）。
- 判据来源：`docs/apm/RULE.md:32`（正文压缩列 / 读路径双形态 / `searchMessages` 无 LIKE
  粗筛是 intentional）、`RULE.md:13`（hidden 语义）、`RULE.md:20`（seq 复用规则）、
  `RULE.md:97`（性能断言取数量级，不卡实测值 —— 故本报告全部数字按数量级给）。

## 对外接口（读口矩阵）

`MessageRepository`（`packages/core/src/domain/chat/repositories/message.port.ts`）全量读族
与收窄读族：

| 读口 | 定义 | 选列 | 解压正文 | 生产调用点数 |
|---|---|---|---|---|
| `listBySession(sessionId, {includeHidden?})` | `message.port.ts:17` | 21 列 | 是 | **21**（+3 转发/声明） |
| `listMessageHeadersBySession` | `:26` | 6 列（无 content） | 否 | 3 |
| `countBySession` | `:36` | COUNT(*) | 否 | 3 |
| `listIdsAfterSeq(sessionId, afterSeq)` | `:95` | id | 否 | 2 |
| `listBySessionTail(sessionId, limit)` | `:59` | 21 列 | 是（但只有 limit 行） | 4 |
| `listBySessionPage` | `:60` | 21 列 | 是（limit 行） | 3 |
| `listBySessionFromSeq(sessionId, fromSeq)` | `:54` | 21 列 | 是 | 2 |
| `listBySessionOffset(sessionId, offset)` | `:45` | 21 列 | 是 | 1 |

## 数据访问

全部走 `chat_message` 表（`sqlite-message.repository.ts`），无 KKV、无文件。
`MESSAGE_SELECT_COLUMNS` 定义在 `sqlite-message.repository.ts:31`，21 列，含
`content_json, content_encoding, content_blob, raw_json, attachments_json` 五个重列。
行解码 `rowToMessage` → `readRowContent`（`message-content-codec.ts:71`）→
`decodeMessageContent` → 进程内 `messageContentPool`（`decoded-content-cache.ts:195`）。

## 依赖关系

`listBySession` 生产消费方 → 频率：

```
每 step（runAgentTurn → AgentRunner.run → for step 循环）
├── agent-runner.ts:405   session.list()                     ← ChatAgentSession.list() :35
├── agent-runner.ts:506   shouldRequestCompaction → VisibleFloorTrigger.shouldTrigger :21 → session.list()
└── agent-runner.ts:588   protocol==='gemini' → listAllSessionMessages（assemble-agent-runner-deps.ts:67）
每轮发送（runAgentTurn 前奏，run 一次）
├── run-agent-turn.ts:612 backfillMissingBaselines（事务内）
└── 双端 chip：session-prompt-input.service.ts（desktop:81 / mobile:95）
                ← chat-prompt-tokens.service / prompt-preview.service
每会话打开 / 每事件
├── desktop ConversationPanel.tsx:270 → IPC MESSAGES_LIST → handlers/messages.ts:91
├── mobile SubagentSessionScreen.tsx:97（无单元时兜底）
└── mobile chat-prompt-tokens.service.ts:458（precise build 失败时的 fallback）
每次 task 工具调用
└── subagent-tool.ts:219（读子会话）
一次性用户动作
├── message.service.ts:293 fork（事务外读）
├── session.service.ts:374  copy（事务内读）★ 名单外
├── message.service.ts:444  truncateAfter(null 锚) → 仅为拿 id
└── CLI 6 处（agent/message×3/model/prompt/commands.ts）
零消费者
├── run-agent-turn.ts:852 / :1201 / create-user-vfs-turn-service.ts:67（toolCtx.listSessionMessages）
└── mobile session-messages-loader.ts:19（loadSessionMessages）
```

## 量化基线（本报告实测）

复刻 `sqlite-message.repository.ts` 的 SQL 列集、`fflate` zlib 编解码、
`decoded-content-cache` 的 4M 字符 / 4096 条消息池口径，`better-sqlite3` in-memory，
每档 7 次取中位。脚本 `tmp/w3-fullread-bench.mjs`（**复刻件，非生产 dist**——本 worktree
`packages/core/dist` 未构建，故为口径等价的替身测量；数量级可用，绝对值不可当回归线，
遵 `RULE.md:97`）。消息体量：user 500B / assistant 2000B / `raw_json` 8KB。

| 口径 | n=200 | n=1000 | n=3000 | n=1000 长正文(4K/16K) |
|---|---|---|---|---|
| `listBySession` 冷解压池 | 53.1 ms | 137.4 ms | 292.7 ms | 227.6 ms |
| `listBySession` 暖解压池 | 5.7 ms | 20.7 ms | 80.0 ms | **220.8 ms** |
| `listBySession(includeHidden:false)` 冷 | 48.0 ms | 95.8 ms | 308.0 ms | 269.9 ms |
| `listMessageHeadersBySession` | 0.65 ms | 3.65 ms | 11.1 ms | 3.54 ms |
| `listBySessionTail(1)` | 0.05 ms | 0.04 ms | 0.04 ms | 0.04 ms |
| `countBySession` | 0.01 ms | 0.05 ms | 0.15 ms | 0.05 ms |
| `listIdsAfterSeq(0)` | 0.22 ms | 1.09 ms | 3.61 ms | 0.92 ms |
| backfill 倒扫 N+1（尾部 2 条，热态） | 0.01 ms | 0.01 ms | 0.01 ms | 0.01 ms |
| backfill 倒扫 N+1（**满程** N 次） | 0.31 ms | 2.06 ms | 6.99 ms | 2.24 ms |
| 消息池命中比（扫完后） | 1.00 | 1.00 | 1.00 | **0.53** |

关键比值（n=1000）：冷全量 / 头投影 = **37.7×**；冷全量 / `listIdsAfterSeq` = **126×**；
冷全量 / `COUNT(*)` = 2759×。Node 侧 fflate inflate 是原生 zlib；**RN Hermes 纯 JS inflate
有数倍放大**（`decoded-content-cache.ts:4-5` 自述「实测占读链 90%+ 成本」），故真机数字
应按此表 ×3~10 看。

## 发现清单

### F-w3-xcfullread-1 | P0 | packages/core/src/service/agent/impl/agent-runner.ts:588 | confirmed

```ts
if (protocol === "gemini" && this.deps.listAllSessionMessages != null) {
  toolUseLookupMessages = await this.deps.listAllSessionMessages();
}
```

**描述**：名单外最严重的一处。`listAllSessionMessages` 由
`assemble-agent-runner-deps.ts:67-68` 装配为 `runtime.messages.listBySession(toolCtx.sessionId)`
——**不带 `includeHidden:false`，含全部 hidden 行，且带 21 列**。调用点 `:588` 位于
`for (let step = 0; ...)` 循环体内（`:398`），**每 step 一次**。对比同文件 `:405` 的
`session.list()` 已经收窄到 `includeHidden:false`（`chat-agent-session.ts:35`）——同一循环里
两次全会话读，gemini 路径那次更宽。

**消费方其实只要 tool_use 的 id/name**：`gemini-content-mapper.ts:339` 的
`buildToolUseLookup(lookupSource)` 只遍历 `block.type === 'tool_use' && block.name !== ''`
取 `id`/`name`，其余 block（text / thinking / tool_result 正文）与 `raw_json`、usage 12 列
全部丢弃。

**建议**（二选一，按代价排序）：
- (a) 新增 `listToolUseNamesBySession(sessionId)`：`SELECT content_json, content_encoding,
  content_blob FROM chat_message WHERE session_id=? AND role='assistant' ORDER BY seq`。
  省掉 `raw_json`（assistant 每条 8KB 量级）+ 半数行 + 12 个标量列。实测口径下 n=1000 从
  137 ms 降到约 40~50 ms（数量级 **3×**）。
- (b) 进程内 memo：`buildToolUseLookup` 是幂等且单调增长的（只会 append 新的 tool_use），
  按 sessionId 缓存 + 在 `append` / `rollback` / `fork` 失效即可。**代码库已有同款失效模式**
  可照抄：`invalidateSessionApiPromptTokenEntry` / `infra/tokenizer/logic/session-api-prompt-token-store.ts`
  （`message.service.ts:279`、`:460` 已在调）。命中后每 step 成本 → 0。
- 注：`:582-585` 的注释已承认「大会话上是秒级」，但把协议门当成了缓解。**覆盖 hidden 的
  语义是有意的**（压缩掉的早期 tool 往返仍可能被引用），**全量读不是**。这两件事要分开改。

### F-w3-xcfullread-2 | P0 | packages/core/src/service/agent/impl/agent-runner.ts:405 | confirmed

```ts
let visible = await session.list();
```

**描述**：已知名单把 `chat-agent-session.ts:35` 挂在 `visible-floor.trigger.ts:21` 名下，
但**频率更高的调用方是 runner 本身**：`:405` 位于 step 循环首行，每 step 一次，与压缩条件
评估（`:506` → visible-floor → `session.list()`）是**两次独立**的全量读。两者都落到
`chat-agent-session.ts:35` 的 `listBySession(sessionId, {includeHidden:false})`。

**建议**：`:405` 的 `visible` 随后只喂 `prepareUserMessagesForPrompt(visible, {...})`
（`:441`）与后续的 prompt 拼装。压缩/置位后 hidden 占多数，**可见正文仍是全量拉回 + 逐条
inflate**（`decoded-content-cache.ts:8-10` 描述的正是这个形态）。可行替换：
新增 `listVisibleMessagesSince(sessionId, anchorSeq)`（`seq >= ? AND hidden = 0`），
`anchorStepUsage` 已经在维护每 step 的 seq 锚点（`agent-runner.ts:898`），可直接复用；
前缀段走 KKV 记忆（`session-api-prompt-token-store` 同款）。
若先做小步：把 `:405` 与 `:506` 的两次读合并成一次（visible-floor 的判定只需要
`visible.length`，而 `:405` 刚拿到同一份数组）——**这一处改动零风险、立刻减半**。

**量化**：n=1000 冷 137 ms / 暖 20.7 ms；`visible-floor` 那次因为刚被 `:405` 暖过，
解码层是内存命中，**但 21 列的 SQL 往返仍要重付**（约 20 ms 量级）。

### F-w3-xcfullread-3 | P1 | packages/core/src/infra/content-cache/logic/decoded-content-cache.ts:186 | confirmed

```ts
const MESSAGE_CONTENT_POOL_MAX_CHARS = 4_000_000;
const MESSAGE_CONTENT_POOL_MAX_ENTRIES = 4096;
```

**描述**：这是 F-1/F-2 的**放大器**，也是「为什么有时收窄了 `includeHidden` 还是卡」的解释。
模块头 `:56-57` 自己写了警告：「池小于工作集会退化成 0 命中（顺序扫一遍即全部常驻）」。
实测第 4 档（n=1000，user 4KB / assistant 16KB ≈ 10M 字符工作集）证实：扫完后
**`poolHitRatio = 0.53`，暖读耗时 == 冷读耗时（比值 1.0×）**——顺序扫把自己刚塞进去的条目
逐出去了，每 step 都在重新 inflate 全量。

**建议**：要么把字符上界提到「最大可见工作集 × 2」（先量真实上限），要么让
`ChatAgentSession.list()` 走分页/增量（回到 F-2），让单次扫描量落在预算内。
**这是取舍不是 bug**，所以定 P1 不定 P0：需要产品侧确认「单进程缓存 16 MB → 32 MB」的
内存预算是否可接受。

### F-w3-xcfullread-4 | P1 | packages/core/src/service/chat/impl/session.service.ts:374 | confirmed

```ts
await copyVfsTree(...);
const messages = await r.messages.listBySession(source.id);
```

**描述**：名单内那一条，但**真正的病灶比名单写的更重**，有两层：
1. **事务内读**：`copy()` 的 `this.deps.conn.transaction(...)` 从 `:338` 开始，这行在事务内。
   对比同语义的 `fork()`（`message.service.ts:293`）是**事务外**读。同一对孪生操作两套锁语义。
2. **无让步**：`r.messages` 来自 `reposFor(tx)`（`session.service.ts:44-51`），
   `new SqliteMessageRepository(conn)` **第二个参数 `yieldFn` 缺省** → `mapRows` 走
   `rows.map(rowToMessage)` 直通同步分支（`sqlite-message.repository.ts:193-196`），
   N 行 inflate + JSON.parse 一次占满 JS 线程。而 fork 用的 `this.deps.messages` 是
   注入件，mobile 经 `create-mobile-runtime.ts:111-113` 传了
   `createQuantumYield(16)`（`create-chat-services.ts:71`），有 50 行一片的让步。
   **同仓两处 `reposFor` 都没传 yieldFn**（`session.service.ts:48`、`message.service.ts:54`）。

**建议**：(1) 把 copy 的读挪到事务外（与 fork 对齐，`copy()` 已在 `:337` 先 `await this.get(id)`，
事务前多读一次即可）；(2) 给 `reposFor` 加可选 `yieldFn` 并从 deps 透传。
**量化**：n=1000 copy 读 86 ms（Node in-memory）；Hermes 上按 3~10× 放大 ≈ 0.3~0.9 s
单次同步阻塞。copy 是冷路径（用户手动复制会话），但一次就够卡一下。

### F-w3-xcfullread-5 | P1 | packages/core/src/service/chat/impl/message.service.ts:444 | confirmed

```ts
const all = await this.deps.messages.listBySession(sessionId);
const ids = all.map((m) => m.id);
```

**描述**：清空整会话（`afterMessageId == null`）分支，为了拿一串 id 走了 21 列全量 +
逐条 inflate。**同文件 `:469` 的 tail 分支已经用了正确答案**（`listIdsAfterSeq`），
两条分支口径不一致。

**建议**：`const ids = await this.deps.messages.listIdsAfterSeq(sessionId, 0);`
零新增接口。**量化：n=1000 时 137 ms → 1.09 ms（126×）**；n=3000 时 293 ms → 3.6 ms（81×）。
触发频率：用户点「清空重聊」，冷路径但一次成本就是整个会话的解压量。

### F-w3-xcfullread-6 | P1 | packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts:172 | confirmed

```ts
const has = await checkpointRepo.hasCheckpoint(sessionId, messages[i]!.id);
```

**描述**：名单内的 N+1。倒序扫消息头投影，每条**一次单行 SQL**，直到撞到有 checkpoint 的那条。
两个放大因素：
1. **整个循环在写事务内**：`message-checkpoint.service.ts:86`
   `await this.deps.conn.transaction(async (tx) => { ... backfillBaselineCheckpoints(...) })`。
   循环期间持 SQLite 写锁。
2. **N 不是常数**：两段式短路（`decideBackfillShortCircuit`）正常时 N≈新增段条数（2）；
   但**游标缺失 / `count < cursor`（删除可疑态）时回退全量**，此时 N = 全会话消息数
   （`RULE.md:20`：回滚是物理删尾、seq 复用，所以 `count < cursor` 在正常回滚后必然发生，
   每轮回滚都吃一次全量倒扫）。`:169` 的弃权点只能提前退出、不能缩短单次事务。

**替换方案已存在且现成**：`checkpointRepo.findCheckpointMessageIdAtOrBefore(sessionId, maxSeq)`
（`sqlite-message-checkpoint.repository.ts:313`，一条 JOIN + `ORDER BY cm.seq DESC LIMIT 1`）。
传 `maxSeq = Number.MAX_SAFE_INTEGER` 取「最后一条有 checkpoint 的消息 id」，再在已拿到的
`messages` 头投影里 `indexOf` + 1 —— **语义与倒扫逐条 `hasCheckpoint` 完全等价**
（两者都按 `chat_message.seq` 序、都不过滤 hidden、JOIN 已限定同 session）。
该方法当前只有 `resolve-target-tree.ts:60/82` 两个消费者，说明是**为 rollback 建的通用件**，
backfill 是漏掉的第三个。

**量化**：Node in-memory 下满程倒扫 n=1000 是 2.06 ms —— 但这是**同进程同步**数字。
RN op-sqlite 每次查询是一次桥往返，按每跳 0.1~0.5 ms 估，1000 次 = **0.1~0.5 s**，
且全程持写锁。修完是 **1 条 SQL**（0.01 ms 量级）。
`:255` 的 `createBaselineCheckpointBackfillOperation.detect()` 有同一个循环，
在事务外、用户手动触发，属冷路径，改不改无所谓，但**建议一起改**（同一个纯函数抽出来）。

### F-w3-xcfullread-7 | P2 | packages/core/src/service/chat/impl/message.service.ts:293 | confirmed

```ts
const all = await this.deps.messages.listBySession(sessionId);
...
const toCopy = all.filter((m) => m.seq <= upTo.seq);
```

**描述**：fork 在事务外读（这点比 copy 好），但**读的是全会话**，`seq > upTo.seq` 的尾巴
被整条读回、整条 inflate，然后丢掉。用户在第 3 条消息处 fork 一个 1000 条的会话时，
997 条正文白解压。

**注意**：fork 确实需要**正文**（要复制过去），所以不能换成头投影。
**建议**：新增 `listBySessionUpToSeq(sessionId, maxSeq)`（`seq <= ?`，21 列），
与已有的 `listBySessionFromSeq`（`message.port.ts:54`）对称。fork 常见场景是「在靠近尾部
处 fork」，收益中等；「从很靠前的消息 fork / 分支探索」场景收益接近全量。

### F-w3-xcfullread-8 | P2 | packages/core/src/domain/tool/builtin/subagent-tool.ts:219 | confirmed

```ts
const childMessages = await subagent.messages.listBySession(childSessionId);
const lastText = extractLastAssistantText(childMessages);
```

**描述**：名单内。频率 = **每次 task 工具调用一次**（主 agent run 里调 N 次子代理就 N 次全量读
子会话）。`extractLastAssistantText`（`subagent-tool.ts:93-107`）从尾部倒着找第一条
「role==='assistant' 且有非空 text block」的消息。子会话通常短，代价小；但
`maxSteps` 大的子代理跑几百步后这里是几百条全量读。

**建议**：加 `listBySessionTailOfRole(sessionId, 'assistant', limit)`（或给
`listBySessionTail` 加 `includeHidden:false` + role 过滤），limit 取 5~10。
严格说末条 assistant **可能**在若干条 tool_result user 之后，
所以「tail(1)」不安全；「tail(N) 里找最后一条 assistant」与现状等价（N 取够大即可）。

### F-w3-xcfullread-9 | P2 | packages/core/src/domain/tool/builtin/builtin-tool-context.ts:174 | confirmed

```ts
/** 列出会话消息（含 hidden，供 chat_grep）。 */
readonly listSessionMessages: () => Promise<readonly ChatMessage[]>;
```

**描述**：名单外。定义在 tool 上下文类型里，装配在 3 处
（`run-agent-turn.ts:851` 主 agent、`:1200` 子 agent、`create-user-vfs-turn-service.ts:67`
用户 VFS turn），全部是无参 lambda 包一次 `listBySession`。**全仓 grep 生产代码
`listSessionMessages` 零消费者**——注释说的 `chat_grep` 工具在本仓不存在
（`packages/core/src/domain/tool/builtin/` 下只有 agent / curl / search / skill / subagent / vfs）。

**定性**：**冷**（惰性 lambda，不调不付费），所以不是性能问题。
**但它是地雷**：任何未来工具接上 `ctx.listSessionMessages()`，立刻变成「每 step 每工具调用
一次全会话 21 列读」，而且代码里三处装配点都不会提醒你。
**建议**：直接删字段（三处装配 + 端口 + 14 个测试文件的 mock 一起清），
或者改成 `listMessageHeadersBySession` 让「误用」的代价降两个数量级。

### F-w3-xcfullread-10 | P2 | apps/mobile/src/services/chat-prompt-tokens.service.ts:458 | confirmed

```ts
const all = await runtime.messages.listBySession(scope.sessionId);
const visible = all.filter(m => !m.hidden);
```

**描述**：名单外。precise build 失败时的兜底（`loadChatPromptTokenLabelFallback`），
每轮 chip 刷新都可能命中（`:339` catch 里调）。**它有 `includeHidden:false` 可用却没用**——
`sqlite-message.repository.ts:218-222` 的注释点名这个开关就是为「只消费可见历史」的读口加的。
`session-prompt-input.service.ts`（desktop `:81` / mobile `:95`）**同一段逻辑已经改对了**，
这里是同一次改造（2026-09-30 首字延迟排查）的漏网。
**建议**：`listBySession(scope.sessionId, { includeHidden: false })`，删掉 `.filter`。
hidden 占比高的压缩会话上省掉的就是 hidden 部分的全部 inflate。

### F-w3-xcfullread-11 | P2 | apps/cli/src/{agent,message,model,prompt}/commands.ts | confirmed

名单外的**模式级**发现：`listBySession` 后接 JS 侧 `.filter(m => !m.hidden)`，共 4 处生产代码——
`cli/agent/commands.ts:195`、`cli/model/commands.ts:88`、`cli/prompt/commands.ts:137`、
`mobile/chat-prompt-tokens.service.ts:459`（与 F-10 同源）。`cli/message/commands.ts:116`
不算（它要给 hidden 行打 `[H]` 标记，需要全量）。
**定性冷**（CLI 一次性 / 兜底路径），但这是**同一段知识在 5 处重复**，
改一次忘一次已经发生过一次（`session-prompt-input.service.ts` 改了、这里没改）。
**建议**：一次性全改成 `includeHidden:false`；并在 `message.port.ts:14-16` 的
`includeHidden` 注释里加一句「JS 侧 filter hidden 是反模式」。

### F-w3-xcfullread-12 | P2 | apps/desktop/src/main/ipc/handlers/messages.ts:91 | confirmed

```ts
const messages = await rt.messages.listBySession(req.sessionId);
return { ok: true, data: messages.map(toDto) };
```

**描述**：名单外。desktop 聊天历史加载**没有分页通道**——`ipc-types.ts:85-97` 的 13 个
`MESSAGES_*` 通道里只有 `MESSAGES_LIST`（全量）和 `MESSAGES_SEARCH`，
**没有 tail / page**，而 mobile 侧有完整的 `listBySessionTail` / `listBySessionPage` 双口径
（`apps/mobile/src/services/session-messages-loader.ts:23-38`）。
`ConversationPanel.tsx:269-285` 在 `sessionId` 变化时 + `session-compacted` 事件时调，
每次还把每条消息 `toDto`（`bodyText` + `contentBlocks`，`messages.ts:70-83`）——
**全量解压 + 全量 IPC 结构化克隆**。700+ 消息的会话切一次会话页就付一次。
**建议**：加 `MESSAGES_TAIL` / `MESSAGES_PAGE` 两个通道直接复用 core 已有的
`listBySessionTail` / `listBySessionPage`（**core 侧零改动**），renderer 侧改成
mobile 同款首屏 tail + 上翻 page。

### F-w3-xcfullread-13 | P2 | apps/cli/src/agent/commands.ts:194 | confirmed

```ts
const all = await rt.messages.listBySession(sessionId);
const visible = all.filter((m) => !m.hidden);
const lastVisible = visible[visible.length - 1];
if (lastVisible?.role === "user") { options.allowResumeWithoutInput = true; }
```

**描述**：名单外。`nm agent continue`（无 --content）为了判末条可见消息的角色，
全量读全会话。**同一个判定在 core 里已经修过了**：`run-agent-turn.ts:631-643` 的注释
逐字写着「原先是全量 listBySession……2026-09-30 真机实锤 ~4s」，改成了
`listBySessionTail(scope.sessionId, { limit: 1 })`。core 侧修了，CLI 侧没跟上——
因为 `tail` 含 hidden，core 那边能判是因为它只判「末条是不是 user」不关心 hidden，
而 CLI 显式过滤了 hidden。**这说明两边其实要的语义不同**。
**建议**：给 `listBySessionTail` 加 `includeHidden?: boolean`（SQL 层加
`AND hidden = 0`，SQLite 允许子查询 ORDER BY + WHERE 组合），CLI 这处改
`listBySessionTail(sessionId, { limit: 1, includeHidden: false })`。
**定性冷**（CLI 一次性），但 4s 级首字节延迟值得修。

### F-w3-xcfullread-14 | P3 | apps/mobile/src/services/session-messages-loader.ts:19 | confirmed

```ts
export async function loadSessionMessages(runtime, sessionId) {
  return runtime.messages.listBySession(sessionId);
}
```

**描述**：名单外。**零调用死代码**——全仓 `loadSessionMessages` 的命中只有本定义
（测试里 mock 的是 `loadSessionMessagesTail` / `loadSessionMessagesPage` 两个姊妹函数，
没有 mock 这个）。`knip.json` 若没把 `apps/mobile/src/services` 排除就该报出来。
**建议**：删掉，别让下一个人以为「有全量 loader」而去用。

### F-w3-xcfullread-15 | P3 | apps/mobile/src/screens/stack/SubagentSessionScreen.tsx:97 | confirmed

```ts
if (manager.snapshot(sessionId) != null) {
  return (await manager.loadSessionTailMessages(sessionId)) ?? [];
}
return await runtime.messages.listBySession(sessionId);
```

**描述**：名单外。**兜底分支**——只有当 `manager.snapshot(sessionId) == null`（run 早已结束
且消息单元已出表）才走全量。频率：每打开一个已结束的子会话一次。
**建议**：兜底改 `listBySessionPage(sessionId, { limit: 首屏条数, beforeSeq: undefined })`
或直接 `listBySessionTail`——UI 首屏本来也只渲染尾部。次要。

### F-w3-xcfullread-16 | P3 | apps/cli/src/message/commands.ts:172/184 | confirmed

```ts
const list = await rt.messages.listBySession(sessionId);
const { fromSeq, toSeq } = resolveSeqRange(flags, list);
```

**描述**：`seqRangeFromFloors`（`apps/cli/src/message/floor.ts:18-40`）只用到
`messages.length` 和 `messages[floor-1].seq` —— **只要头投影就够**。
两处（`hide` / `show` 无 `--message` 时）。**定性冷**（CLI 一次性），
但替换是零成本的（`listMessageHeadersBySession` 已在 MessageService 上暴露，
`message.service.ts:135`）。**建议**：顺手改。

### F-w3-xcfullread-17 | intentional | packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:502 | intentional

`searchMessages` 的全量拉取 + 内存精筛**是 intentional**，不作为问题报。
依据：`docs/apm/RULE.md:32` 明写「`searchMessages` 无 LIKE 粗筛（明文列恒空），
keyword 非空走全量拉取 + `messageMatchesKeyword` 内存精筛」；`message.port.ts:108-113`
与 `sqlite-message.repository.ts:506-510` 的注释同款。旧 LIKE 方案已被评估为「漏召回 +
被 role 粗筛误杀」而**故意废弃**。`RULE.md:32` 同时钉死「明文行永远合法，新代码严禁假设
单一形态」——**任何试图用 `content_json LIKE` 换回 SQL 粗筛的改法都违反这条**。

### F-w3-xcfullread-18 | intentional | packages/core/src/service/agent/logic/run-agent-turn.ts:637 | intentional

`listBySessionTail(scope.sessionId, { limit: 1 })`（续跑判末条角色）**已修到位**，
列为 intentional 以免后续 agent 重复报。注释里的 2026-09-30 真机 ~4s 数字是**本仓实测**，
非照抄。同理 `run-agent-turn.ts:441` 之前的 `message-transcript-effects.service.ts:105`
（`:84-86` 注释：改 `listBySessionTail` 治本）、`hide-message.action.ts:55/69`
（头投影 + 窗口内补拉）、`message-rollback.service.ts:204/332/336`
（`countBySession` / `listBySessionFromSeq`）、`truncate-tail-in-transaction.ts:64`
（`listIdsAfterSeq`）**都是已收窄的正确形态**。

## 争议与存疑

1. **F-1 到底该做 (a) 新读口还是 (b) 进程内 memo** —— 我倾向 (b) 优先：`buildToolUseLookup`
   的输入是单调追加的，memo 的正确性论证比新读口简单得多（只需在 4 个写口失效），
   而新读口还要处理「tool_use 在 content blob 里、无法只取一段」的问题（(a) 只能省列和
   省行，省不了 inflate）。但 (b) 引入新的进程级状态，与 `decoded-content-cache` 一样
   有「单进程单库」前提（`decoded-content-cache.ts:38-43`），**这一点需要主代理裁决
   是否接受第二份进程级缓存**。折中方案：(a) 做个只 SELECT 3 列 + `role='assistant'` 的
   窄读口，不引入缓存 —— 收益小但零风险。

2. **F-3 的池预算该不该涨** —— 需要产品/用户拍板内存预算。我实测的 0.53 命中率说明
   「长正文 + 千条消息」的会话形态确实会击穿 4M 字符，但**这是长尾会话**
   （短正文千条实测命中率 1.00）。所以 F-3 也许该降 P2，把重心放 F-2（从源头减少单次扫描量）。

3. **`RULE.md:97` 与本报告数字的关系** —— 我的基线是**复刻件**（`packages/core/dist` 未构建，
   我用 `better-sqlite3` + `fflate` 复刻了同一列集与同一编解码）。它能可靠地给出
   **数量级比值**（37× / 126× / 2759× 这类列数与 inflate 占比的比值与运行时无关），
   但绝对毫秒数不能当回归线。W6 验证代理若要复核，应在 dist 构建后跑
   `packages/core/test/chat/message-content-perf-threshold.test.ts` 那套现成基建。

4. **F-6 的 N 到底多大** —— 我论证了「每回合滚都吃一次全量倒扫」（因为 `RULE.md:20`
   明确回滚是物理删尾、seq 复用 ⇒ `count < cursor` 必然）。但这一条**没有实测**：
   需要在真机上打一次「长会话 → 回滚 → 发送」的计数日志确认倒扫实际迭代次数。
   这是 F-6 唯一的未实测环节，置信度标 suspected 而非 confirmed 的部分就在这里
   （代码结构本身是 confirmed）。

5. **跨 agent 重叠** —— F-5 与 `w2-core-service-chat.md` 报告的同一条、
   F-1/F-2 与 `w2-core-service-agent.md` 的 `chat_message` 每 step 读有重叠。
   我按协议未读它们的报告正文（只在一次 grep 输出里意外扫到几行），
   本报告的全部结论均以我自己的代码阅读 + 实测为准，重复项请 reduce 代理按 file:line 去重。

## 修复优先级（建议序）

| 序 | 编号 | 分级 | 一句话 | 改动面 |
|---|---|---|---|---|
| 1 | F-2 | P0 | runner `:405` 与 `:506` 两次全量读合并成一次 | 极小、零风险、立刻减半 |
| 2 | F-1 | P0 | gemini 每 step 全量读（memo 或窄读口） | 中；需裁决是否加第二份进程缓存 |
| 3 | F-5 | P1 | `truncateAfter(null 锚)` 改 `listIdsAfterSeq(id, 0)` | 一行，126× |
| 4 | F-6 | P1 | backfill 倒扫 N+1 改 `findCheckpointMessageIdAtOrBefore` | 一处纯函数，接口已存在 |
| 5 | F-4 | P1 | copy 的读挪出事务 + `reposFor` 传 yieldFn | 中，动事务边界需回归 fork/copy parity |
| 6 | F-3 | P1→P2 | 消息池 4M 字符 vs 工作集 | 需拍板内存预算 |
| 7 | F-10 + F-11 | P2 | 5 处 `listBySession`+JS 滤 hidden → `includeHidden:false` | 5 行 |
| 8 | F-12 | P2 | desktop 加 `MESSAGES_TAIL` / `MESSAGES_PAGE` | core 零改动，renderer 中等 |
| 9 | F-13 | P2 | CLI continue 改 tail(1, includeHidden:false) | 需给 tail 加 includeHidden |
| 10 | F-7 / F-8 | P2 | fork 收窄到 `seq <= upTo`；subagent 取末条 assistant | 各加一个窄读口 |
| 11 | F-9 | P2 | 删 `listSessionMessages` 死字段 | 三处装配 + 14 个测试 mock |
| 12 | F-14/15/16 | P3 | 死代码 / 兜底全量 / CLI hide-show 上头投影 | 小 |

第 1 项（`:405` 与 `:506` 合并）我单独排在最前：它不需要任何新接口、不改任何读端口语义，
只是把 `visible.length` 这个已经在手的值复用起来，是本轮唯一「零风险立刻减半」的动作。
