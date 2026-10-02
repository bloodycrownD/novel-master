# fix-spec · wave-c1（Wave C 性能分片一：全量读收窄 + 协议层 + smart-sort 事务）

> 基线：`fe79b781`（worktree `D:\Dev\nm-worktree\mcr`，分支 `feat/repo-mega-cr`）。
> 撰写机位：s-wave-c1。台账依据：`ledger-v2.md` §2.5（N-P1-06 / N-P1-07）、§6 #8~#12、
> §10 Wave C 节；`raw/w3-xc-fullread.md`（全量读权威分类）、`raw/w8-ds-llmproto-a.md`、
> `raw/w8-ds-llmproto-b.md`、`raw/w8-kt-sse.md`、`raw/w10-kt-sksp.md`；
> 参照 `synth/core-runtime.md`、`synth/core-data.md`、`synth/core-misc.md`、
> `synth/delta-overview.md`、`synth/revalidate-a.md`、`synth/revalidate-b.md`。
> **行号纪律**：本文件所有 `file:line` 均由撰写机位在 `fe79b781` 上**逐条重新打开核对**，
> 台账/raw 原文行号凡与本文不符**以本文为准**（漂移处在各条目「证据」小节显式标出）。
> **已修形态不复写为病灶**：RULE「每 step / 每轮发送前的全量消息读必须头投影或 SQL 层滤 hidden」
> （`docs/apm/RULE.md:125`）记的 `ChatAgentSession.list()` / `backfillMissingBaselines` 两处
> **已是正确形态**，本文件不把它们列为待修项，只把「换了实现后观测面必须同步换」写进注记。

---

## 0 · 条目总览

| # | 条目 | 严重度/簇 | 量 | 一句话修法 | 依赖 |
|---|---|---|---|---|---|
| **C1-1** | `fork` 全量读整会话（含 seq > 锚点的整条尾巴） | P1 · core-data | M | 新增上界读口 `listBySessionUpToSeq(sessionId, maxSeq)`，fork 改用它 | RT-02 先落（读数基线；本条断言按读口解耦，见 N-1.1） |
| **C1-2** | `truncateAfter(null 锚)` 为拿 id + read 引用走 21 列全量读（且在事务外，TOCTOU） | P1 · core-data | M | 新增窄投影读口 `listReadRefTargetsBySession`（id + content 三列）**并移进事务** | RT-02 先落（读数基线；本条断言按读口解耦，见 N-1.1） |
| **C1-3** | `subagent-tool.ts:219` 为取末条 assistant 文本全表解压子会话 | P2 · core-tool | S | 新增 `listBySessionTailOfRole(sessionId, 'assistant', limit)`，消费方改为 tail+role 过滤 | RT-02 先落（读数基线；本条断言按读口解耦，见 N-1.1） |
| **C1-4** | `BuiltinToolContext.listSessionMessages` 死字段（3 处装配 + 端口声明，生产零消费者） | P2 · core-tool | S | 删字段 + 三处装配 + 33 个测试文件的 mock | 与 Wave D 批次 3 协调 |
| **C1-13**（补记账, CR R1 c1/P2-2） | `listBySessionOffset` 头投影（21 列→6 列）无独立条目 | P2 · core-data | S | 唯一消费方 backfill 增量段判定只用 id；验收 G1（列集恰 6 键）/G2（offset 语义）/G3（SELECT 不含正文字节列）已落 `message-visibility.test.ts:132`；随 c667be0f 落地 |
| **C1-5** | `session.deleteSessionTree` 在写事务内全量读全会话正文 | P2 · core-data（**名单外新发现**） | S | 复用 C1-2 的 `listReadRefTargetsBySession` | **C1-2** |
| **C1-6** | **N-P1-06** `importRules` 先 `deleteAll` 再逐条 insert，全程无事务 | P1 · core-misc | M | service 引入 `conn` + repo 工厂，`importRules` 整体包单事务 | — |
| **C1-7** | **N-P1-07** `resetDefaults` / `deleteBatch` / `setEnabledBatch` / `reorderRules` / `moveRule` 多语句无事务；`renumber` 逐条 UPDATE | P1 · core-misc | M | 五个入口各包单事务；`renumber` 下沉为 repo 的单条批量 UPDATE（三处复用） | **C1-6**（同一套 deps 改造） |
| **C1-8** | §6 #8 gemini 同名并行 functionCall 塌陷成一个累加器 | P1 · infra-llmproto | S | 归并键改 `fc.id ?? \`${name}#${ordinal}\``，ordinal 取同一 chunk 内同名出现序 | — |
| **C1-9** | §6 #9 anthropic `max_tokens: 4096` 硬上限 ⇒ thinking 预算吃掉全部输出 | P1 · infra-llmproto | S | body 默认抬到 16000（与 `ANTHROPIC_SAMPLING_DEFAULTS` 共源）+ 钳制改 0.8 比例 | — |
| **C1-10** | §6 #10 `stream-partial-blocks` 丢 `thinkingSignature` | P1 · infra-llmproto | S | 类型补字段 + gemini / anthropic 两个 partial 收尾函数透传（第三个调用点 openai 侧无签名概念、已查无需改）+ 放宽 `:36` 的 push 守卫 | — |
| **C1-11** | §6 #11 Kotlin SSE `call.isCanceled()` 闸门把 callTimeout 静默吞掉 | P1 · mobile-native | S | 删闸门、改认显式 user-abort 标记；callTimeout 归类为 `kind:"timeout"` | — |
| **C1-12** | §6 #12 `SkspModule` 两个 `@ReactMethod` 无 Executor，内联阻塞原生队列 | P1 · mobile-native | S | 照 `TokenizerModule.kt:30-32` 加模块自有单线程 executor | — |

**Wave C 的验收口径**：本波是「有回归风险的性能结构」波（台账 §10），全部按**热路径标准**验收；
性能断言一律取**数量级回归线 / 计数式断言**（RULE「性能护栏取数量级回归线」），
**不拿实测毫秒卡线**。

---

## C1-1 · `fork` 全量读整会话（含锚点之后的整条尾巴）

- **严重度 / 簇**：P1 / core-data（消息存储层）。台账 §10 Wave C「全量读收窄系列」的一格。
  ⚠ **台账 ID 碰撞**：`ledger-v2.md:463` 把这条写成「**CD-01** fork 缺上界读口」，但同文件
  §2.3 的 **CD-01 是回滚 plan 与事务内状态不同源**（`message-rollback.service.ts` 一族），
  与 fork 毫无关系。fork 这条在 `synth/core-data.md:96` 的原始编号是 **CD-13**。
  ⇒ 本条目按 **CD-13** 撰写；judge 轮请把台账 §10 那格的「CD-01」正名为「CD-13」。
  （`synth/core-data.md:97` 的 CD-14 = `session.copy` 事务内全量读 = 台账 CS-11，
  **已在 `wave-c2.md` C2-3，本分片不重复**，见分片级注记 N-3。）

- **病症**：`MessageService.fork(sessionId, upToMessageId)` 在**事务外**读走**整会话**
  （21 列全投影 + 逐行 `JSON.parse` 正文），然后在事务内 `filter(m => m.seq <= upTo.seq)`
  把锚点之后的消息整条丢掉。用户在第 3 条消息处 fork 一个 3000 条的会话时，
  2997 条正文被读回、解析、再扔掉。

- **证据**（`packages/core/src/service/chat/impl/message.service.ts`，本轮逐行核对；
  raw 报告记的 `:293` 已漂移，**现为 `:320`**）：

  ```
  320    const all = await this.deps.messages.listBySession(sessionId);
  ...
  330      const toCopy = all.filter((m) => m.seq <= upTo.seq);
  ```

  仓储侧确认**缺上界读口**：`packages/core/src/domain/chat/repositories/message.port.ts:54-57`
  只有下界读口 `listBySessionFromSeq(sessionId, fromSeq)`，全量读口 `:17-20` 无上界参数；
  实现 `sqlite-message.repository.ts:263-299` 同样只有 `listBySession` / `listBySessionFromSeq`。

  **注意 fork 确实需要正文**（要复制过去 + 收集 read 引用 `aggregateReadRefs`，`:385-389`），
  所以**不能**换成头投影——只能换成上界读口。

- **修法**（文件 · 函数级）：

  1. `domain/chat/repositories/message.port.ts`：在 `listBySessionFromSeq` 之后新增
     ```ts
     /** 按 seq 升序列出「seq <= maxSeq（含上界）」的消息（fork 上界收窄用）。 */
     listBySessionUpToSeq(sessionId: string, maxSeq: number): Promise<ChatMessage[]>;
     ```
     JSDoc 必须写明「fork 消费方的全部读都在锚点及更早方向（`filter(seq <= upTo.seq)`），
     锚点之后的整条尾巴是纯浪费；与 `listBySessionFromSeq` 对称」，
     并补一句「**含 hidden**：本读口只加 `seq` 上界，**不得**加 `AND hidden = 0`——
     fork 明确「Preserve hidden state」（`message.service.ts:376-377`），滤掉 hidden 行
     会让 fork 出来的会话**静默丢消息**」。
     ⚠ SQL 里**只**允许出现 `AND seq <= #{maxSeq}` 一个新条件。
  2. `sqlite-message.repository.ts`：实现照 `listBySessionFromSeq`（`:285-299`）逐行同款，
     谓词改 `AND seq <= #{maxSeq}`，走 `queryTemplate` + `this.mapRows(rows)`
     （**必须复用 `mapRows`**，否则丢掉 `yieldFn` 分片让步，mobile 上退化成单次长任务）。
  3. `message.service.ts` · `fork`：`:320` 改为
     `await this.deps.messages.listBySessionUpToSeq(sessionId, upTo.seq)`；
     `:330` 的 `all.filter(...)` 改为直接用返回值（`toCopy = all`，变量名保留不改以最小化 diff）。
     **零新增过滤语义**：上界读口返回的集合与 `filter(seq <= upTo.seq)` 逐条等价。
  4. `MessageService` 侧**不需要**新增公开方法（`fork` 是 service 内部用 `deps.messages`，
     不经 `DefaultMessageService.listBySession` 转发层，`:133-137` 那一层不动）。

- **验收**：

  | 断言 | 方式 | 期望 |
  |---|---|---|
  | I1 读口收窄生效（计数式） | spy `SqliteMessageRepository.prototype.listBySession` / `listBySessionUpToSeq`，会话 100 条、锚点第 3 条、发起 fork | `listBySession` 调用数 **0**；`listBySessionUpToSeq` **1**；返回行数 **3** |
  | I2 结果等价 + **hidden 逐条保留** | 同一夹具（会话 100 条，**其中 ≥10 条 `hidden=true` 且分布在锚点两侧**），fork 前 3 条消息 = `listBySession` 结果的 `filter(seq<=3)` | 逐条 `deepEqual`（含 `content.blocks` / `hidden` / `attachments`）；**hidden 行逐条保留 `hidden === true`**；fork 出的消息数 == `listBySession().filter(seq<=3).length`。旧实现若被加上 `AND hidden = 0`，此断言必红 |
  | I3 空集合守卫仍在 | 锚点 seq 比库里最小 seq 还小 | 仍抛 `chatInvalidArgument("No messages to fork up to the given id")`，**且事务未开** |
  | I4 上界闭区间 | 锚点恰好是最后一条（`upTo.seq == MAX(seq)`） | fork 出全部消息，与修复前一致 |
  | I5 read 引用 +1 不回退 | `test/vfs/read-ref-count.test.ts` 全量 | 全绿 |
  | I6 走了 `mapRows` 分片分支（**代替人眼核对**，见 R2） | 照 `test/chat/message-repository-yield.test.ts` T-R2a 的**让步点计数法**，会话 100 条夹具下断言让位数 | `listBySessionUpToSeq` 让步 **≥1** 次（证明走 `mapRows` 分片而非 `rows.map` 直通）。若实现写成 `rows.map(rowToMessage)`，此断言必红 |
  | I7 命令 | `npm run test:fast -w packages/core -- test/chat/ test/vfs/read-ref-count.test.ts` | 全绿 |

- **测试策略**：
  - **新增** `test/chat/message-fork-upper-bound.test.ts`，用例名
    `T-FORK-UB1 锚点前 3 条：零次 listBySession、一次 listBySessionUpToSeq`、
    `T-FORK-UB2 上界读口结果与 listBySession().filter(seq<=N) 逐条等价（夹具含 ≥10 条 hidden，两侧分布）`、
    `T-FORK-UB3 空集合守卫仍在事务外抛出`、
    `T-FORK-UB4 100 条夹具下让步点 ≥1（照 T-R2a 计数法，证明走 mapRows 分片）`。
    观测面**必须用 repository prototype spy 或真实 sqlite**，**禁止**用
    「服务内部调了哪个方法」当断言（RULE「给读路径挂缓存后观测面必须换」的同族纪律）。
  - **复用**：`test/chat/` 下 fork / fork-copy-parity 既有用例（文件名以
    `Get-ChildItem test/chat -Filter '*fork*'` 实查为准）。

- **回归线**：`test/chat/` 全目录、`test/vfs/read-ref-count.test.ts`、
  `test/vfs/read-ref-safety.test.ts`、`test/message-checkpoint/` 全目录
  （fork 走 `seedForkCopyParity`，会建 checkpoint）。

- **依赖**：无前置。可与 C1-2 同 PR（两者都只动 message port + sqlite repo + service）。

- **风险与回滚**：
  - **R1 漏掉某条消费方**：`:330` 之后 `toCopy` 还被 `:387 aggregateReadRefs(toCopy.map(m => m.content))`
    与 `seedForkCopyParity` 消费——两者都吃**同一份 `toCopy`**，不各自再查库，故收窄对它们透明。
    已逐跳核对。
  - **R2 `mapRows` 漏传**：若实现写成 `rows.map(rowToMessage)`，mobile 上大结果集会退化成
    单个长任务（**性能回归而非功能回归**）。I1 的 spy 抓不到这一条 ⇒ **由 I6 的让步点计数
    机器断言**（照 `test/chat/message-repository-yield.test.ts` T-R2a，断言 120 行夹具下
    让步 ≥1 次）承担牙齿；PR 描述里保留一句「实现写的是 `this.mapRows(rows)`」的人工提醒，
    但**验收判据以 I6 为准，不得写成「人眼核对实现」**。
  - **回滚**：纯读口新增 + 一行调用替换，无 schema 变更、无写路径变更，`git revert` 单提交即可。

---

## C1-2 · `truncateAfter(null 锚)` 全量读 + 事务外 TOCTOU

- **严重度 / 簇**：P1 / core-data。台账 §10 Wave C「全量读收窄系列」的一格；
  与 `synth/core-data.md:98` 的 **CD-15** 同址；`delta-overview.md:206` 记的「CD-02 方向反转」
  描述的是**同一函数另一分支**（见下）。

- **病症**：`MessageService.truncateAfter(sessionId, null)`（「清空重聊」）分支，
  为了①拿一串 message id 去删 checkpoint 指针、②收集 read 引用做 `−1`，
  走 `listBySession` 拉**整会话 21 列**并逐行 `JSON.parse` 正文。
  而且这次读发生在 **`conn.transaction` 之前**（TOCTOU：读与写之间新 append 的消息会被删，
  但它的 checkpoint 不在 `ids` 里 → 孤儿 checkpoint）。

  **方向反转提示（不要照抄旧修法）**：`delta-overview.md:206` 与 `synth/core-data.md:85` 记载，
  台账原修法是「改用 `listIdsAfterSeq(sessionId, 0)`，省解压」——**这条现在不成立**：
  read 引用化（`read-tool-result-ref` 迭代）之后本分支**必须**读 `content`，
  `raw/w3-xc-fullread.md:221` 的建议已过期。本条目按**窄投影 + 移进事务**修，不按 id-only 修。

- **证据**（`packages/core/src/service/chat/impl/message.service.ts`，本轮逐行核对；
  raw 记的 `:444` 已漂移，**现为 `:479`/`:481`**）：

  ```
  479      const all = await this.deps.messages.listBySession(sessionId);
  480      const ids = all.map((m) => m.id);
  481      await this.deps.conn.transaction(async (tx) => {
  ...
  491          await adjustReadRefCount(
  492            new SqliteVfsRevisionRepository(tx),
  493            aggregateReadRefs(all.map((m) => m.content)),
  494            -1
  495          );
  496          await checkpoints.deleteCheckpointsForMessages(sessionId, ids);
  ```

  对照同文件 **tail 分支已在事务内**：`domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:72-87`
  的 `listBySessionFromSeq` 在事务回调内（调用方传入 `tx` 仓储），read `−1` 在 sweep 之前（`:79-85` 有硬约束注释）。
  ⇒ **两个分支的事务边界不一致**，这是本条要修的第二半。

  **21 列确认**：`sqlite-message.repository.ts:28` 的 `MESSAGE_SELECT_COLUMNS` 共 21 列，
  其中与本分支消费**完全无关**的重列有 `raw_json`（assistant 每条 8KB 量级）、`attachments_json`、
  **5 个** `*_tokens` 计费列（`prompt_tokens` / `completion_tokens` / `total_tokens` /
  `cache_read_tokens` / `cache_creation_tokens`，实测复核，RULE `:115`）+
  `first_token_ms` / `duration_ms`、`provider` / `provider_id` / `model_name`。
  另 `seq` / `role` / `hidden` / `created_at_ms` / `session_id` 同样与本分支的
  「id + contentRef」消费无关（本分支只用 `id` 排序与 `content`）。

- **修法**（文件 · 函数级）：

  1. `domain/chat/repositories/message.port.ts` 新增：
     ```ts
     /**
      * 列出会话内每条消息的 id 与其 read 引用指针（entryId/version），不解压/不解析
      * 正文以外的任何列。删除链（清空会话 / 删会话）需要「id 列表 + read 引用 −1 素材」
      * 两样东西，此前只能靠 21 列 `listBySession` 顺带取。
      *
      * ⚠ 不过滤 hidden：本读口产出的是「即将被 deleteBySession 全删」的消息集合，
      * 漏掉 hidden 行 = 漏减 read 引用 = revision 永不 GC（内容不可再生的方向）。
      */
     listReadRefTargetsBySession(sessionId: string): Promise<readonly MessageReadRefTarget[]>;
     ```
     `MessageReadRefTarget = { readonly id: string; readonly refs: readonly ReadRefPointer[] }`。
     **`ReadRefPointer` 类型从 `domain/vfs/logic/revision-ref-count.ts` 导出**（该文件已导出
     `collectReadRefs`，`:72`，返回类型即 `ReadRefPointer[]`）——不重新定义一份。
     ⚠ **必须是 `import type`**：`refs` 元素的类型用
     `import type { ReadRefPointer } from "@/domain/vfs/logic/revision-ref-count.js";`
     ——这是**首次**在 `domain/chat/repositories` 层引入 `@/domain/vfs` 依赖（该层当前零 vfs
     导入）。`import type` 编译后擦除 ⇒ 运行时不成环（L0 口径下 runtime-safe），
     但会给 `L0/circular-alias` 普查**新增 1 条类型环** ⇒ **PR 描述里记一笔**
     「core 类型环 9 → 10（runtime-safe，仅 `import type`）」。
  2. `sqlite-message.repository.ts` 实现：`SELECT id, content_json, content_encoding, content_blob
     FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC`，逐行
     **直接调用本文件既有的模块私有 `readRowContent(row)`**（`:125-138`，已含 `content_blob`
     判定 + `decodeMessageContent` + `parseMessageContent`）——**不得新写一份解码分支**
     （「同款」不是「照着再写一份」，新方法就在同文件、直接调用即可）；
     再调 `collectReadRefs(content)` 得到 `refs`。**坏行按「空 refs」处理并 `console.warn`**
     （与 `aggregateReadRefsFromAllMessages` 的坏行隔离口径一致，`:190-195`）。
     ⚠ **不改返回类型**：`collectReadRefs` 需要完整的 `MessageContent`，所以正文**仍要 parse**；
     本条省的是**列数**（21 → 4）与**事务外往返**，不是省 parse。验收断言必须照这个口径写。
     ⚠ **WHERE 子句不得加 `AND hidden = 0`**（hidden 行也要出现在 targets 里，见修法 1 的 JSDoc）。
  3. `message.service.ts` · `truncateAfter` 的 `afterMessageId == null` 分支重排为：
     ```ts
     await this.deps.conn.transaction(async (tx) => {
       const messages  = new SqliteMessageRepository(tx);
       const checkpoints = new SqliteMessageCheckpointRepository(tx);
       const targets = await messages.listReadRefTargetsBySession(sessionId);
       if (targets.length > 0) {
         await new SqliteSessionKkvRepository(tx).clearDomain(sessionId, SESSION_KKV_DOMAIN_BACKFILL_CURSOR);
         await adjustReadRefCount(new SqliteVfsRevisionRepository(tx),
           aggregateReadRefTargets(targets), -1);
         await checkpoints.deleteCheckpointsForMessages(sessionId, targets.map(t => t.id));
       }
       await messages.deleteBySession(sessionId);
     });
     ```
     事务块结束后**原样保留**原代码 `:500-501` 的三句，**一句都不许丢**：
     ```ts
     await this.invalidatePromptTokens(sessionId);
     await this.invalidateToolUseCount(sessionId);
     return;
     ```
     ⚠ 这三句是 RULE `:46` 的 truncateAfter 失效挂点（`usage_stats.toolUseCount` 失效），
     它们在原代码里位于**事务之后**，重排时极易连同 `return` 一起被吞 ⇒ **必须原样搬过来**。
     `aggregateReadRefTargets` 是本文件新增的模块私有小函数：把 `{refs}` 形状按
     「消息内去重、消息间累加」的既有口径聚合成 `ReadRefCountAggregate[]`
     ——**语义必须与 `aggregateReadRefs(contents)` 完全一致**，可让 `aggregateReadRefs`
     接受 targets 后复用同一条累加路径（推荐：在 `revision-ref-count.ts` 里给
     `aggregateReadRefs` 增加一个 `ReadRefPointer[][]` 的重载/伴生函数，
     **不要**在 service 层手写第二份 Map 累加）。
  4. tail 分支（`:512-541`）**本轮不动**：它已经在事务外读、在事务内写，
     同样有 TOCTOU，但它的读口是 `listBySessionFromSeq`（带正文、有上界），
     且属于 `CD-02` 的另一族问题（两条平行截断实现），**留给 §债务池**（见注记 N-5）。

- **验收**：

  | 断言 | 方式 | 期望 |
  |---|---|---|
  | I1 全量读归零（计数式） | spy `SqliteMessageRepository.prototype.listBySession`，造 500 条会话，`truncateAfter(sid, null)` | `listBySession` 调用数 **0**；`listReadRefTargetsBySession` **1** |
  | I2 列数收窄 | 用 `sql-counting-connection.ts`（`test/helpers/` 已有）spy 实际 SQL 文本 | 该次查询的 `SELECT` 列表**不含** `raw_json` / `attachments_json` / `*_tokens`；**并同时断言** `content_json` / `content_encoding` / `content_blob` **仍在 SELECT 列表内**（`collectReadRefs` 需要完整 `MessageContent`）——本条收益 = 去掉与 read 引用无关的重列 + 消除事务外往返，**不含 parse 成本**（与修法 2 的自述并列，勿误读为 I2 覆盖了 parse） |
  | I3 read 引用严格对账 | 造 3 条含 `contentRef` 的消息 → 清空 → 断言 `vfs_revision.ref_count` 回落、`listKeysWithRefCountUnderScope` 无残留；再造 1 条**坏行**（`content_json` 非法 JSON） | 正常行 `−1` 精确；坏行 warn 且**不影响其它行**（不整体回滚也不整体成功） |
  | I4 checkpoint 全清 | 造带 checkpoint 的会话，清空后 `SELECT COUNT(*) FROM message_checkpoint WHERE session_id=?` | **0**（无孤儿） |
  | I5 读确实在写事务内（**结构断言，取代原 TOCTOU 注入**） | ①在 `listReadRefTargetsBySession` 的 spy 里记录 `this.conn` 的连接身份；②或用 `sql-counting-connection` 记录 SQL 顺序 | 该读发出的 `SELECT FROM chat_message` 出现在**同一连接上**：`BEGIN` 之后、`DELETE FROM chat_message` 之前——即「产出写集合的读确实在写事务内」。**不做并发注入**：单连接写事务内构造不出真正的并发窗口，同连接注入只会稳定复现「被删但 checkpoint 留着」这条被明令禁止的坏状态 |
  | I6 tail 分支未回归 | `test/chat/` 回滚/截断既有用例 | 全绿 |
  | I7 命令 | `npm run test:fast -w packages/core -- test/chat/ test/vfs/` | 全绿 |

- **测试策略**：
  - **新增** `test/chat/truncate-after-readref-targets.test.ts`，用例名
    `T-TRUNC-RT1 清空整会话：零次 listBySession、查询只取 4 列`、
    `T-TRUNC-RT2 read 引用逐条 −1 且坏行隔离`、
    `T-TRUNC-RT3 产出写集合的读落在写事务内（SELECT 在 BEGIN 之后、DELETE 之前）`、
    `T-TRUNC-RT4 checkpoint / backfill 游标 / tool_use 缓存失效三件套照旧`。
  - I5 的观测面是**连接身份 + SQL 顺序**（spy 里记 `this.conn`，或用 `sql-counting-connection`
    记 SQL 先后），**不做并发注入**（单连接写事务内无法构造真正的并发窗口，见 I5 的理由栏）。

- **回归线**：`test/chat/` 全目录、`test/vfs/read-ref-count.test.ts`、
  `test/vfs/read-ref-safety.test.ts`、`test/message-checkpoint/` 全目录、
  `test/session-kkv/`（backfill 游标域）。

- **依赖**：**C1-5 直接复用本条的新读口**（必须先落 C1-2）。

- **风险与回滚**：
  - **R1 read 引用漏减 / 减错**：新读口若把 `refs` 聚合口径写偏，会出现「多减」或「漏减」。
    多减 → revision 被过早 GC（**内容不可再生**）；漏减 → blob 永不回收（ milder）。
    ⇒ I3 是本条**不可省**的断言，必须用真实 sqlite + 真实 `vfs_revision` 行核对，
    不得用 `adjustReadRefCount` 的 mock 调用计数当对账。
  - **R2 坏行处理改变既有语义**：现状是 `listBySession` 对坏行 fail-fast
    （`decodeMessageContent` 抛），本条改成 warn + 跳过。这会让「一条坏行原本让整个清空失败」
    变成「清空成功但那条的 read 引用没减」。**这是有意的降级**（对齐
    `aggregateReadRefsFromAllMessages:190-195` 的坏行隔离），但必须在 PR 描述里写明，
    且 I3 的坏行用例要断言「其它行照常减、坏行 warn」。
    ⚠ **本文件已钉死为「warn + 跳过」，实现者不再二选一。**
    （**备选注记**（仅留给 judge，不要求实现者选择）：若 judge 认为 fail-fast 更可取，
    则把 catch 里改成 `throw`——但该改动必须**同时**改 C1-5 的 R1 联动口径，且 I3 的
    坏行期望要反向重写。）
  - **R3 事务内读 + 写锁**：`listReadRefTargetsBySession` 现在在写事务内跑，
  会持有写锁更久——**口径订正（2026-10-02, cr-fix-spec L1-3/OQ8）**: 持有期 = 一次 SELECT + N 次 `JSON.parse`(8KB 量级单行解析是主导成本); 原文「总持有时间下降」只算 SQL 往返、漏了 parse, **不成立**。本读口真实收益 = 列数收窄(21->4)+消除事务外往返, 不省 parse; parse 随读进事务是已知且接受的锁代价(未来要缩短需重新评估窗口, 与「产出写集合的读必须留在事务内」判据冲突, 须单独立条)。
    与 `wave-c2` 的「backfill 移出事务」结论不冲突：本读产出的 `ids`/`refs`
    **就是要删的写集合**，按 wave-c2 注记 N-3 的判据「产出写集合的读必须留在事务内」处理。
  - **回滚**：新增 port 方法 + 一个分支重排。**回滚需同时回滚 C1-5**（否则 C1-5 无读口可用）。

---

## C1-3 · `subagent-tool` 为取末条 assistant 文本全表解压子会话

- **严重度 / 簇**：P2 / core-tool。台账 `synth/core-data.md:100` 的 **CD-17**
  （多源印证：chat-1 / w2-service-chat 争议 7）。频率 = **每次 `task` 工具调用一次**。

- **病症**：`subagent-tool.ts:219` 在子代理 run 结束后，为拿「末条 assistant 的合并文本」
  调 `listBySession(childSessionId)` 读**整条子会话**（21 列 + 逐行 parse），
  而消费函数 `extractLastAssistantText`（`:93-107`）是**从尾部倒着找第一条有非空 text block 的
  assistant 消息**。子会话通常短，但 `maxSteps` 大的子代理跑几百步后这里是几百条全量读，
  且每次 `task` 调用都重付。

- **证据**（`packages/core/src/domain/tool/builtin/subagent-tool.ts`，本轮逐行核对，行号与 raw 一致）：

  ```
  218    // AgentRunResult 不带文本，必须自己 listBySession 拿末条 assistant text。
  219    const childMessages = await subagent.messages.listBySession(childSessionId);
  220    const lastText = extractLastAssistantText(childMessages);
  ```

  `extractLastAssistantText` 的扫描形态（`:96-105`）逐字确认：**从尾往前、跳过非 assistant、
  跳过无 text block 的 assistant**，命中即 return。

  ⚠ **不能简单换成 `listBySessionTail(childSessionId, 1)`**：末条 assistant 之后可能压着若干条
  tool_result 的 user 消息（`raw/w3-xc-fullread.md:286-287` 已指出）。

- **修法**（文件 · 函数级）：

  1. `message.port.ts` 新增 `listBySessionTailOfRole(sessionId, role, limit): Promise<ChatMessage[]>`，
     JSDoc 写明「tail + role 过滤：role 在 SQL 子查询里过滤，`limit` 只数**该 role** 的行，
     所以 tool_result 夹在中间不会吃掉配额」。
  2. `sqlite-message.repository.ts` 实现照 `listBySessionTail`（`:353-373`）同款
     （外层再包一层 `ORDER BY seq ASC`），内层子查询加 `AND role = #{role}`；
     `clampedLimit = Math.max(1, Math.floor(limit))`；走 `this.mapRows(rows)`。
  3. **接口与实现两处都要改（只改实现类不算修完，`tsc` 会直接红）**：
     ① `service/chat/message.port.ts:18` 的 **`MessageService` 接口**新增
     `listBySessionTailOfRole(sessionId: string, role: string, limit: number): Promise<ChatMessage[]>`；
     ② `DefaultMessageService` 加同款转发（照 `:153-158` `listBySessionTail` 的形状）。
     ⚠ 之所以是接口：`subagent-tool.ts:219` 拿到的 `subagent.messages` 静态类型就是
     **`MessageService`**（链路：`builtin-tool-context.ts:45` → `service/chat/message.port.ts:18`），
     **不是** `DefaultMessageService` ⇒ 只改实现类时 `subagent-tool.ts:219` 编译不过。
  4. `subagent-tool.ts`：`:219` 改为
     `await subagent.messages.listBySessionTailOfRole(childSessionId, "assistant", 8)`；
     `extractLastAssistantText` **签名与逻辑一字不改**（输入类型 `readonly ChatMessage[]` 仍匹配，
     只是入参变小）。
  5. **limit 取 8 的依据（必须写进代码注释）**：一次 assistant 回合里「无 text block 的
     assistant 消息」只出现在「该 step 只发了 tool_use、没发正文」的情形，且相邻两个这样的
     step 之间必夹一条 tool_result 的 user 消息（`role` 过滤后不占配额）。
     ⇒ 8 给了约 4 倍余量。**残留差异**：若子代理连续 8 个 step 只发 tool_use 且更早处有正文，
     现状会取到更早那条、改后返回 `undefined`（走 `:244` 的
     `[子代理未完成任务: stopReason=…]` 兜底文案）。此差异**可接受且必须钉一条用例**。
  6. **既有 3 个测试文件的 `messages` mock 必须同步改（否则回归线必红）**：
     `test/tool/subagent-tool.test.ts:71`、`subagent-tool-parallel.test.ts:49`、
     `subagent-tool-vfs.test.ts:55` 三处的 `messages` 都是 `as unknown as MessageService`
     强转的桩，**只提供 `listBySession`** ⇒ 改实现后运行到 `:219` 会抛
     `listBySessionTailOfRole is not a function`。
     照各文件 `listBySession` 的实现形状给桩补上该方法
     （`:71` 的 `childMsgsBySession.get(sid) ?? []` **需按 role 过滤**后再取 tail）。

- **验收**：

  | 断言 | 方式 | 期望 |
  |---|---|---|
  | I1 全量读归零（计数式） | **口径 (a)（本文件写死）**：沿用既有 mock 形态（`makeMockSubagent` 的 `runChildAgent` 是桩，**不跑真 agent**），子会话 50 条（含 tool_result 夹层）夹具，**在 `MessageService` 层桩上**计数，跑一次 `task` | `listBySession` 调用数 **0**；`listBySessionTailOfRole` **1**。⚠ 观测面是 **service 层的桩**，**不是** repository prototype（原因与备选口径见测试策略） |
  | I2 结果等价（常规） | 同一夹具，比对修复前后 `extractLastAssistantText` 的返回值 | **逐字节相等** |
  | I3 结果等价（尾部夹 tool_result） | 末尾构造 `assistant(text) → user(tool_result) ×5` | 相等（证明 limit=1 的坑被避开） |
  | I4 差异边界 | 末尾连续 9 条无 text 的 assistant（tool_use-only）+ 更早 1 条有 text | 断言返回 `undefined` 且 `text` 走 `[子代理未完成任务: …]` 分支（**把已知差异钉成期望**） |
  | I5 既有 task 语义不变 | `test/tool/subagent-tool*.test.ts` 全量（4 个文件） | 全绿 |
  | I6 命令 | `npm run test:fast -w packages/core -- test/tool/subagent-tool.test.ts test/tool/subagent-tool-parallel.test.ts test/tool/subagent-tool-vfs.test.ts test/tool/subagent-meta-passthrough.test.ts` | 全绿 |

- **测试策略**：
  - **新增** `test/tool/subagent-tool-tail-read.test.ts`，用例名
    `T-SUB-TAIL1 零次全量读、取 tail(assistant,8)`、
    `T-SUB-TAIL2 尾部夹 5 条 tool_result 仍取到末条 assistant 正文（逐字节等价）`、
    `T-SUB-TAIL3 连续 9 条 tool_use-only assistant → 已知差异：undefined + 兜底文案`。
  - **既有 3 个文件必须同改（与 I5/I6 同一次 PR）**：
    `test/tool/subagent-tool.test.ts`、`subagent-tool-parallel.test.ts`、`subagent-tool-vfs.test.ts`
    的 `messages` 桩要补 `listBySessionTailOfRole`（见修法 6），否则 I5 / I6 必红。
  - **观测面（I1 口径，与既有 3 个测试文件同构）**：`makeMockSubagent` 的 `runChildAgent`
    走桩、**不跑真 agent**，所以 I1 的 spy 打在 **`MessageService` 层的 `messages` 桩**上，
    **不是** `SqliteMessageRepository.prototype`。
    ⚠ **为什么不能用 prototype spy 写 I1**：真跑子代理时，agent 每个 step 的
    `session.list()` 就是 `listBySession(includeHidden:false)`
    （`chat-agent-session.ts:36`，已由 `e2d10b3f` 收窄但**仍是 `listBySession` 这个方法**）
    ⇒ `listBySession` 的计数不可能为 0，原写法在真跑口径下恒不成立。
  - 🔗 **已闭合（judge-r1 B7 → 取 (a)）**。以下备选口径 (b) 仅作存档，本文件不按它撰写：
    **备选口径 (b)（已被 B7 否决，仅作存档）**：若 I1 改走真实 agent，则断言必须改为
    「`listBySession` 调用数 == step 数（**全部 `includeHidden:false`）+
    `listBySessionTailOfRole` == 1」**——此时观测面换回 repository prototype spy
    （照抄 `backfill-cursor.test.ts:256-299` 的 `spyFullSessionReads()` 形状），
    并同步修正 I1 的期望值。**本文件按 (a) 撰写**（与既有 3 个测试文件同构、改动最小）。

- **回归线**：`test/tool/` 全目录（14 个文件都 mock 了 `listSessionMessages`，删字段那条见 C1-4，
  本条不动它，两者可同 PR 也可分开——见注记 N-4）。

- **依赖**：无前置。

- **风险与回滚**：
  - **R1 limit 取值不当**：太小会漏（I4 已把边界钉成期望），太大退化成近似全量。
    取 8 时最坏读 8 行 × 21 列——对比现状的 N 行，**任何 N>8 都是净收益**。
  - **R2 role 过滤下沉到 SQL 改变了隐含语义**：`listBySessionTail` 现有两个消费者
    （`run-agent-turn.ts:695` 判末条角色、`message-transcript-effects` 相关）**语义不同**，
    **不要**给 `listBySessionTail` 加 role 参数（会波及它们）——新开一个方法，正是为了隔离。
  - **回滚**：新增 port + 一行调用替换，无写路径变更。

---

## C1-4 · `BuiltinToolContext.listSessionMessages` 是死字段（生产零消费者）

- **严重度 / 簇**：P2 / core-tool。台账/raw 未单列条目（`raw/w3-xc-fullread.md:289-306`
  的 **F-9**）。列在此处是因为它与 C1-1/C1-2/C1-3 同属「全量读收窄」一族，
  且它是**唯一一个「不调不付费、但一接上就变成每 step 全量读」的地雷**。

- **病症**：`BuiltinToolContext.listSessionMessages: () => Promise<readonly ChatMessage[]>`
  在三处装配点被无参 lambda 包一次 `listBySession`，而**生产代码里没有任何消费者**——
  注释里说的 `chat_grep` 工具在本仓不存在（`domain/tool/builtin/` 下只有
  agent / curl / search / skill / subagent / vfs）。

- **证据**（本轮全仓 grep 复核：`packages/` + `apps/` 全部 `.ts/.tsx`，排除 `node_modules`/`dist`）：

  ```
  packages/core/src/domain/tool/builtin/builtin-tool-context.ts:174   声明（1 处）
  packages/core/src/service/agent/logic/run-agent-turn.ts:912          装配（主 agent）
  packages/core/src/service/agent/logic/run-agent-turn.ts:1269         装配（子 agent）
  packages/core/src/service/chat/create-user-vfs-turn-service.ts:67     装配（用户 VFS turn）
  ```

  生产侧对 `ctx.listSessionMessages(` 的调用：**零命中**（`.listSessionMessages(` 全仓 src 无匹配）。
  其余 **65 处命中、33 个测试文件**全部在 `packages/core/test/**`（mock / 桩）
  ——`agent-runner*.test.ts` 系列 10 个、`tool/` 10 个、`vfs/` 2 个、`chat/` 4 个等
  （复核实测，RULE `:115` 条数类结论须实测）。

  三处装配的 lambda 体逐字确认：
  ```
  run-agent-turn.ts:912-913        listSessionMessages: (): Promise<readonly ChatMessage[]> =>
                                    runtime.messages.listBySession(scope.sessionId),
  run-agent-turn.ts:1269-1270      listSessionMessages: (): Promise<readonly ChatMessage[]> =>
                                    runtime.messages.listBySession(childSessionId),
  create-user-vfs-turn-service.ts:67  listSessionMessages: () => messageRepo.listBySession(sessionId),
  ```

- **修法**（文件 · 函数级）：

  1. `builtin-tool-context.ts`：删 `:174` 的字段声明；若上方 JSDoc 提到 `chat_grep`，一并删。
  2. `run-agent-turn.ts`：删 `:912-913` 与 `:1269-1270` 两个装配项。
  3. `create-user-vfs-turn-service.ts`：删 `:67`。
  4. `packages/core/test/**` **33 个文件**的 `listSessionMessages` 桩/mock **逐个删**
     （清单可复现：`Get-ChildItem -Recurse packages/core/test -Include *.ts | Select-String listSessionMessages`）。
     ⚠ 这些文件里 `hydrate-tool-results.test.ts` 出现 15 次、`agent-runner.test.ts` 7 次
     （`:957/1033/1099/1199/1267/1339/1408`），
     **必须逐文件实删**，不得靠 sed 全局删（会连带删掉 `listMessageHeadersBySession` 之类
     相邻符号——RULE「prettier/批量替换后必须逐处回退」的同族纪律）。

- **验收**：

  | 断言 | 方式 | 期望 |
  |---|---|---|
  | I1 生产零引用（编译级） | `npx tsc --noEmit -p packages/core` | 绿（漏删任一装配点会因类型缺字段而红） |
  | I2 全仓零命中 | `grep -rn "listSessionMessages" packages/*/src apps/*/src` | **0 命中** |
  | I3 测试侧零命中 | 同上 grep 扩到 `test` / `__tests__` | **0 命中** |
  | I4 命令 | `npm run test:fast -w packages/core -- test/tool/ test/agent/ test/chat/hydrate-tool-results.test.ts` | 全绿 |

- **测试策略**：**不新增用例**（删死码无行为面）。验收靠 I1/I2/I3 三条编译级 + grep 级断言。
  若 judge 认为「删字段」需要行为锁，替代方案见「风险 R2」。

- **回归线**：`npm run typecheck -w packages/core` + `npm test -w packages/core` 全量。

- **依赖 / 与其它分片的边界**：
  - 与 **Wave D 批次 3**（死码删除）的清单有交叠 ⇒ **本条与 Wave D 批次 3 必须二选一执行**，
    建议**留在本分片**（它属于「全量读收窄」的性能族，且 Wave D 批次 3 需先过拍板项 ★1/★3，
    不该被本条拖住）。见注记 N-4。

- **风险与回滚**：
  - **R1 漏删测试桩**：任一测试文件漏改 → 该文件编译红。I4 覆盖。
  - **R2 未来被接上**：本条的价值就是把「误用」的成本降为零。若 judge 认为删字段风险大
    （担心后续工具要用），**备选案**：字段保留但改为
    `listMessageHeadersBySession`（头投影），并把注释从「供 chat_grep」改成
    「只给头投影；要正文请显式申请新接口」。本文件按**默认案（删）**撰写。
  - **回滚**：`git revert` 单提交。

---

## C1-5 · `deleteSessionTree` 在写事务内全量读全会话正文（名单外新发现）

- **严重度 / 簇**：P2 / core-data。**台账与 raw 名单均未列**（`raw/w3-xc-fullread.md`
  只列了 `session.service.ts:374` 的 copy）。撰写机位在核对 C1-2 时顺带发现，
  属同一读口族、同一修法，故并入本分片。

- **病症**：`DefaultSessionService.deleteSessionTree(tx, session)` 在**写事务内**
  `await r.messages.listBySession(session.id)` 拉全会话正文，只为 `.map(m => m.content)`
  交给 `aggregateReadRefs` 做 read 引用 `−1`。会话删除是**冷路径**（用户手动删会话），
  但：①大事话在移动端会长时间持写锁；②`deleteSessionTree` 是**递归**的
  （`:218-221` 先删全部子会话再删自己），子会话多时是 N 次全量读串在**同一条事务**里。

- **证据**（`packages/core/src/service/chat/impl/session.service.ts`，本轮逐行核对；
  raw 记的 `:374` 是 copy，现 copy 在 **`:388`**；本条在 **`:227`**）：

  ```
  197    await this.deps.conn.transaction(async (tx) => {
  198      await this.deleteSessionTree(tx, session);
  ...
  218      const children = await r.sessions.listByParentSession(session.id);
  219      for (const child of children) {
  220        await this.deleteSessionTree(tx, child);
  221      }
  ...
  227        (await r.messages.listBySession(session.id)).map((m) => m.content)
  ```

  `reposFor(tx)` 构造的 `SqliteMessageRepository` **未传 `yieldFn`**
  （`session.service.ts` 的 `reposFor` 全文见 `:49-56`，与 `message.service.ts:56-62` 同款），
  ⇒ 走 `mapRows` 的**同步直通分支**（`sqlite-message.repository.ts:243-244`），N 行 parse 一次占满 JS 线程。

  **同型残留（同属本条，一并修）**：`service/chat/impl/project.service.ts:179`
  在**删项目**的写事务内、沿 BFS 展开的**每个会话**重复一次同形读
  （`(await r.messages.listBySession(session.id)).map(m => m.content)` → `aggregateReadRefs`
  → `adjustReadRefCount(-1)` → `deleteBySession`）。它此前既没进本条修法、也没进注记 N-5
  债务池 ⇒ 「全量读收窄系列」漏了一格，本轮**并入 C1-5 修法 1**。

- **修法**（文件 · 函数级）：
  1. 复用 **C1-2** 新增的 `listReadRefTargetsBySession`：
     `:224-230` 的 `aggregateReadRefs((await r.messages.listBySession(...)).map(m => m.content))`
     改为 `aggregateReadRefTargets(await r.messages.listReadRefTargetsBySession(session.id))`；
     **同一次改动把 `project.service.ts:176-182` 一并改掉**（删项目路径的同型读，
     BFS 展开的每个会话各一次，代码形态与上面一行完全相同）⇒ **读口已由 C1-2 引入，
     边际改动一行**。
     🔗 **已闭合（judge-r1 B8 → 并入本条）**。以下备选案仅作存档：
     **备选案**（已被 B8 否决，仅作存档）：若把 `project.service.ts` 排除在本条之外，
     则改为在注记 N-5 债务池**新增第 7 条**登记「`project.service.ts:179` 删项目路径同型全量读，
     与 C1-5 同修法，不进本波」——但那样「全量读收窄系列」就仍留一格未收窄的尾巴。
     **本文件按并入案（默认）撰写。**
  2. **读必须留在事务内**（产出的是 `−1` 写集合，wave-c2 注记 N-3 判据）——本条**不移动事务边界**。
  3. 可选（**建议同 PR 一起做**）：**按下面的透传路径做，不要照字面「给 deps 加 yieldFn」**——
     ① `SessionServiceDeps`（`session.service.ts:70-85`）增
     `readonly messageRowYieldFn?: () => Promise<void>`；
     ② `reposFor(tx, yieldFn)` 把该函数透传给 `SqliteMessageRepository`；
     ③ `createSessionService(conn, sessionDeps)`（`:114-119`）**当前不透传 options**，
     故给它加第三参 `options?: ChatServicesOptions`（`yieldFn` 属于工厂选项
     `create-chat-services.ts:52-54`，**不属于仓储依赖集合**）并转交；
     ④ `create-mobile-runtime.ts:113/176` 的 `yieldFn` **同时**喂 messages 与 sessions 两条链
     （desktop/cli 的 session service 未传 options ⇒ 该链无 `yieldFn`，属既有现状）。
     **这一步会让 `mapRows` 走分片让步分支**，必须与 C1-2 的读口一起验收（I6）。

- **验收**：

  | 断言 | 方式 | 期望 |
  |---|---|---|
  | I1 全量读归零 | spy `listBySession`，删一个 500 条会话（+2 个子会话），再走一次删项目路径（BFS 会话数记 N） | `listBySession` 调用数 **0**；`listReadRefTargetsBySession` = **父 + 2 子 = 3（删会话）+ 项目侧按 BFS 会话数 N** |
  | I2 read 引用精确回落 | 造 3 条含 `contentRef` 的消息 → 删会话 → 断言 `vfs_revision` 行 `ref_count` 归 0 / 行被 GC；未引用的 revision **不被**误删 | 与 `test/session-fs/` 既有 delete 用例叠加断言 |
  | I3 递归语义不变 | 父 + 2 子，删父 → 断言 3 个 session 及其消息/VFS/KKV/run_state 全清 | 全清（与现状一致） |
  | I4 子会话 read 引用 | 子会话含 `contentRef` 指向父 revision | `−1` 精确（子会话删了不等于父 revision 可 GC，父还在引用） |
  | I5 **删项目路径的 read 引用不回归** | 造带 `contentRef` 的多会话项目 → 删项目 → 断言 `vfs_revision.ref_count` 归位、checkpoint 无孤儿 | 与现状逐条一致（`project.service.ts:179` 是本轮并入修法的同型读） |
  | I6 **让步点 ≥1**（仅当修法 3 做了才立） | 500 条会话的 `deleteSessionTree`，照 `test/chat/message-repository-yield.test.ts` T-R2a 的让步点计数法 | 让步 **≥1** 次。⚠ `session.service` 这条链**无既有守**（T-R2a 守的是 `runtime.messages` 那条链）⇒ **必须新立这条断言** |
  | I7 命令 | `npm run test:fast -w packages/core -- test/session-fs/ test/vfs/` | 全绿 |

- **测试策略**：
  - **新增** `test/session-fs/delete-session-readref-targets.test.ts`，用例名
    `T-DEL-RT1 删会话零次全量读、每会话一次窄投影`、
    `T-DEL-RT2 子会话递归删除的 read 引用逐条 −1`、
    `T-DEL-RT3 父会话仍引用的 revision 不被误 GC`、
    `T-DEL-RT4 删项目路径（BFS 多会话）零次全量读、每会话一次窄投影`、
    `T-DEL-RT5 修法 3 落地后 deleteSessionTree 在 500 条会话下让步点 ≥1`。
  - 复用 `test/session-fs/` 既有删除链用例（文件名以实查为准）。

- **回归线**：`test/session-fs/` 全目录、`test/vfs/read-ref-count.test.ts`、
  `test/agent/`（子会话生命周期）。

- **依赖**：**必须在 C1-2 之后**（读口是 C1-2 引入的）。

- **风险与回滚**：
  - **R1 与 C1-2 的坏行策略联动**：C1-2 已钉死 **warn + 跳过**，本条**自动继承**；
    （仅当 judge 把 C1-2 改判 fail-fast 时，删会话才会因一条坏行整条失败 ⇒
    那种情形下**两个条目必须同改**，本条自动跟随 C1-2，无需另行决策）。
  - **R2 递归 × 事务的既有放大**：本条不改变「递归全在一条事务内」的现状
    （那是另一族问题，见债务池注记 N-5），只把每次读的**列数**从 21 降到 4。
  - **回滚**：与 C1-2 绑定回滚。

---

## C1-6 · N-P1-06 `importRules` 先清空整表再逐条插入，全程无事务

- **严重度 / 簇**：P1 / core-misc（`ledger-v2.md` §2.5 N-P1-06，对抗 upheld）。
  **台账论证最强的一条后果**：bundle 里任一条 insert 失败 ⇒ 用户已有的**全部**智能排序规则
  已被 `deleteAll` 抹掉且不回滚 ⇒ 排序静默退化为自然序；
  且 desktop 侧会被 `normalizeYamlError` 包成「YAML 无效」，把 DB 故障**误报成格式错误**。

- **证据**（`packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts`，
  本轮逐行核对；台账记的 `:246-249` **一字不差，恰好命中**）：

  ```
  246    await this.deps.rules.deleteAll();
  247    for (const entity of entities) {
  248      await this.deps.rules.insert(entity);
  249    }
  250    return this.deps.rules.listOrdered();
  ```

  **结构上开不了事务**（台账原文「连 `conn` 都没有」）——本轮复核确认
  （deps 接口在 `fe79b781` 上占 `:56-60`：`:58` 是 JSDoc 注释行、`builtinSeed` 在 `:59`、
  `}` 在 `:60`）：
  ```
  56  export interface SmartSortRuleServiceDeps {
  57    readonly rules: SmartSortRuleRepository;
  58    /* ← JSDoc 注释行（说明第三个字段，本身不带字段） */
  59    readonly builtinSeed: readonly SmartSortBuiltinSeedRow[];
  60  }
  ```
  仓储侧每个方法都是单条 `executeTemplate`（`sqlite-smart-sort-rule.repository.ts:75-99` insert /
  `:138-145` deleteAll），**无批量、无事务**。

  三端调用方也都没包（台账列的三个位置，本轮全部核实路径已变，见下）：
  - desktop：`apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts:171`
    `await rt.smartSortRule.importRules(req.bundle)`；`:173-175` catch → `formatIpcError`。
  - desktop YAML 通道：`apps/desktop/src/main/services/smart-sort-rule-yaml.service.ts:37-40`
    `catch → throw normalizeYamlError(error, "智能排序规则 YAML 无效")`
    （`normalizeYamlError` 在 `packages/core/src/common/normalize-yaml-error.ts:7-12`，
    逐字确认它对任何 `Error` 都拼前缀 ⇒ **DB 故障被贴上「YAML 无效」标签**）。
  - mobile：`apps/mobile/src/services/smart-sort-rule-yaml.service.ts:32-35` 同款。
  - CLI：`apps/cli/src/sort-rule/commands.ts:65` `const svc = rt.smartSortRule;`（走同一 service）。
    ⚠ 台账记的 CLI 路径 `apps/cli/src/sort-rule/commands.ts:184` 本轮未逐字核对到
    `importRules` 调用（该文件里 grep 到的是 `isBuiltinSmartSortRuleId` 等），
    **CLI 是否直调 `importRules` 待实现时以实查为准**，不影响本条修法（修在 core）。

- **修法**（文件 · 函数级）：

  1. **deps 改造（本条与 C1-7 共用，一次做完）**：
     `smart-sort-rule.service.ts` 的 `SmartSortRuleServiceDeps` 改为
     ```ts
     export interface SmartSortRuleServiceDeps {
       /** 根连接：多语句写入口用它开事务（单语句入口不开）。 */
       readonly conn: TdbcConnection;
       /** 按连接造仓储的工厂（事务回调内必须用 tx 句柄造，见 RULE「AsyncMutex 不可重入」）。 */
       readonly createRules: (conn: TdbcConnection) => SmartSortRuleRepository;
       readonly builtinSeed: readonly SmartSortBuiltinSeedRow[];
     }
     ```
     类内新增 `private rules(conn: TdbcConnection = this.deps.conn)` 取当前连接上的仓储；
     `this.deps.rules` 全量替换为 `this.rules()`。
     **保留 `deps.rules` 字段**（可选）会让「单语句入口忘了换 tx」成为可能 ⇒
     **推荐只留工厂**，并在类型注释里写死「仓库只经 `this.rules(conn)` 取得」。
  2. `create-smart-sort-rule.service.ts`：注入
     `{ conn, createRules: (c) => new SqliteSmartSortRuleRepository(c), builtinSeed }`。
     **两个 app runtime 与 CLI 的装配点不改**（工厂签名 `createSmartSortRuleService(conn)` 不变）。
  3. `importRules`：`:246-250` 包进
     ```ts
     return this.deps.conn.transaction(async (tx) => {
       const rules = this.rules(tx);
       await rules.deleteAll();
       for (const entity of entities) { await rules.insert(entity); }
       return rules.listOrdered();
     });
     ```
     **校验段（`:234-245`）保持在事务外**（读多写零，留在事务外能少持锁，
     且台账 adv 让步 F-2 指出的撞号防御位置不变）。
  4. **错误语义（必须一并处理，否则台账的「误报格式错误」半边还在）**：
     `importSmartSortRuleYamlWithDialog`（desktop `:35-41` / mobile `:30-38`）的 catch
     改为**只对校验类错误**套 `normalizeYamlError`，事务/DB 类错误原样抛。
     ⚠ **判据必须按「反转」写，不能按正向白名单列举**（复核已实测）：`parseText`
     （`infra/serialization`）对 **YAML 语法错**、`decode()`（`infra/serialization/decode.ts`）
     对 **schema 校验错**抛的都是 `ConfigDecodeError("INVALID_SCHEMA")`
     （`errors/config-decode-errors.ts:14-19`），这一类才是「YAML 无效」**最常见**的失败路径；
     按 `instanceof SmartSortRuleError` 正向列举会把它整类漏判成 DB 类
     ⇒ 「YAML 无效」标签从主路径上消失（功能回归）。
     **默认案（本文件按此撰写）＝反转判据**：只让 `TdbcError` / 事务类错误**绕过**
     `normalizeYamlError`，其余一律照旧套前缀——改动最小、**不新增 core 公开导出面**。
     ⚠ `ConfigDecodeError` 未在任何 `packages/core/src/public/*` 导出（全量 grep 零命中），
     app 侧**无法** `import` 它 ⇒ 任何方案都不得把它写进判据。
     **备选案（②）**：在 core 侧新增 `SmartSortRuleError` 的子类 `STORAGE` 做精确分流，
     此时 `ConfigDecodeError` 只需留在「套前缀」那一侧；改动更大，本文件不采用。

- **验收**：

  | 断言 | 方式 | 期望 |
  |---|---|---|
  | I1 原子性（**核心断言，有牙**） | 造 3 条用户规则 + N 条内置；构造一个 bundle 使**第 2 条 insert 失败**（重复 `rule_id` 撞已存在内置 id，或让 `insert` 在第 2 次抛）；调 `importRules` | 抛错；**断言 `listRules()` 与调用前逐条 `deepEqual`**（一条都没变——`deleteAll` 被回滚）。旧实现下此断言**必红** |
  | I2 事务边界 | spy `conn.transaction`，`importRules` 一次 | `transaction` 调用数 **1**；`listOrdered` 在**事务内**（返回值即事务内读） |
  | I3 单语句入口不开事务 | spy `conn.transaction`，依次调 `listRules` / `createRule` / `updateRule` / `setEnabled` / `deleteRule` / `deleteBatch`（C1-7 修完后） | 全部 **0** 次（`deleteBatch`/`setEnabledBatch` 除外，见 C1-7 I2） |
  | I4 校验仍在事务外 | bundle 含重复 `ruleId` → 断言 `transaction` 调用数 **0** 且表未被动 | 沿用既有 `importRules 拒绝重复 ruleId 与非法规则（先校验后替换，不半删）`（`smart-sort-rule.service.test.ts:379`） |
  | I5 错误标签（**双向，有牙**） | desktop/mobile 的 YAML 导入：①I1 的 DB 故障注入路径；②喂一份 **YAML 语法错 / schema 违规**的 bundle | ①**不含**「YAML 无效」；②**仍含**「YAML 无效」前缀——②是反转判据的牙齿（按旧的正向白名单实现时它必红） |
  | I6 命令 | `npm run test:fast -w packages/core -- test/smart-sort-rule/ test/smart-sort/` | 全绿 |

- **测试策略**：
  - **新增** `test/smart-sort-rule/smart-sort-rule-transaction.test.ts`，用例名
    `T-SRTX1 importRules 中途失败 → 全表逐条不变（deleteAll 被回滚）`、
    `T-SRTX2 importRules 恰好一次事务，且 listOrdered 在事务内`、
    `T-SRTX3 单语句入口零事务`、
    `T-SRTX4 校验失败零事务、零写入`。
    **故障注入缝**：**不能**走 `createSmartSortRuleService(conn)`——该工厂只收 `conn`、
    内部自造 deps（`create-smart-sort-rule.service.ts:18-25`），**无法注入**。
    ⇒ 测试直接 `new DefaultSmartSortRuleService({ conn, createRules, builtinSeed })`
    （类从 `@/service/smart-sort-rule/impl/smart-sort-rule.service.js` 引），
    `createRules` 传一个带计数/抛错/**连接身份记录**的装饰仓储（C1-7 的 I4 也复用它）。
    影响面可控：`DefaultSmartSortRuleService` 全仓唯一构造点是工厂 `:21-24`、
    唯一调用点是 `create-workplace-service.ts:28`，工厂签名不变 ⇒ 改 deps 面不波及 app 侧。
    这样注入缝与实现同源（RULE「验收断言的三条牙齿」之一）。
    ⚠ **不得**用「spy `rules.deleteAll` 被调用过」当断言（那对回滚无牙齿）。
  - **复用**：`test/smart-sort-rule/smart-sort-rule.service.test.ts` 的
    `T-SR3 importRules 拒绝重复 ruleId 与非法规则（先校验后替换，不半删）`（`:379`）——
    本条修完后它必须**仍绿**，这是「校验段位置不变」的现成锁。
  - **新增**（app 侧）`apps/desktop/test/smart-sort-rule-import-error.test.ts`：
    `T-SRTX-D1 DB 故障不被贴「YAML 无效」标签`、
    `T-SRTX-D2 YAML 语法错 / schema 违规**仍**贴「YAML 无效」标签（反转判据的另一半）`
    （纯函数级，不起 Electron：直接对 `normalizeYamlError` 与新判据做单测）。

- **回归线**：`test/smart-sort-rule/` 全目录、`test/smart-sort/` 全目录、
  `test/bootstrap/smart-sort-rule-seed.test.ts`（seed 是 `INSERT OR IGNORE`，与本条正交）、
  `apps/desktop/test/smart-sort-rules-view.test.ts`。

- **依赖**：无前置。**C1-7 复用本条的 deps 改造**（必须同 PR 或 C1-6 在前）。

- **风险与回滚**：
  - **R1 嵌套事务**：若某个调用方已经在事务里调 `importRules`（本轮 grep：**无**），
    `conn.transaction` 会抛 `NESTED_TRANSACTION`。当前零命中 ⇒ 不必套
    `runInTransactionOrConn`；**若实现时发现新调用方，按
    `sqlite-message.repository.ts:91-103` 的同款兜底复制一份**（并在该文件注记 N-5 里
    提醒 judge「该模式已有第三份拷贝」的风险）。
  - **R2 长事务**：bundle 上限多大？`bundleRulesToEntities` 的条数无显式上限（本轮未查实）。
    ⇒ 事务内是「1 条 DELETE + N 条 INSERT」，N 若达数千则移动端大事务风险成立
    （RULE「TDBC 驱动层」的 disk I/O 事故族）。**本条不解决它**，但必须在 PR 描述里写明
    「替换式语义要求原子，N 上界另开条目」——见注记 N-6。
  - **R3 反转判据可能漏标 DB 故障**：判据写成「只让 `TdbcError` / 事务类绕过」后，
    若驱动把异常包了一层（不再 `TdbcError` 派生），DB 故障仍会被贴上「YAML 无效」。
    ⇒ I5 的第 ① 条就是它的牙齿（注入 I1 的故障后断言 message 无前缀）。
    反过来，旧口径担心的「zod 校验失败丢掉前缀」在本方案下**不会发生**：
    `ConfigDecodeError` / `ZodError` / `SmartSortRuleError` 全部留在「套前缀」那一侧，
    **不再做正向白名单列举**。
  - **R4 事务内经根连接写 = 死锁（不是「事务外写」）**：`this.rules()` 默认取根连接，
    而 better-sqlite3 的 `transaction()`（`packages/tdbc-driver-better-sqlite3/src/connection.ts:46-76`）
    在整个 async 回调期间**持有 `AsyncMutex`**（`mutex.ts:16-23` 是非重入 promise 链，
    op-sqlite `connection.ts:59` 同构）⇒ 真发生「事务内经根连接写」，测试不是变红而是
    **永久挂起**。⇒ 本条所有「包事务」的改法都必须把 `tx` 句柄显式传下去，
    并在代码注释里把这一条写成硬约束。
  - **回滚**：deps 改造 + 一个分支包事务。回滚须与 C1-7 一起（共用 deps）。

---

## C1-7 · N-P1-07 `resetDefaults` 等五处多语句无事务 + `renumber` 逐条 UPDATE

- **严重度 / 簇**：P1 / core-misc（`ledger-v2.md` §2.5 N-P1-07，对抗 upheld）。
  台账原文：「`renumber` 被三处复用，中途失败留下排序号有洞或撞号，
  而 `listOrdered` 用 `ORDER BY sort_order, rule_id` 决胜、撞号时行为不可预测」。

- **证据**（`smart-sort-rule.service.ts`，本轮逐行核对；台账记的 `:253-288` / `:132-147` /
  `:163-170` / `:372-382` **全部一字不差命中**）：

  ```
  132  async deleteBatch(ruleIds: readonly string[]): Promise<void> {
  133    // 先全量校验（存在 + 非 builtin）再删除，避免半删状态
  134    for (const ruleId of ruleIds) {
  ...
  144    for (const ruleId of ruleIds) {
  145      await this.deps.rules.delete(ruleId);
  146    }
  ```

  ```
  163  async setEnabledBatch(ruleIds, enabled) {
  164    for (const ruleId of ruleIds) {
  165      await this.setEnabled(ruleId, enabled);      // 每次都 find + update 两条语句
  166    }
  167  }
  ```

  ```
  261    for (const rule of rules) {
  262      if (isBuiltinSmartSortRuleId(rule.ruleId)) {
  263        await this.deps.rules.delete(rule.ruleId);     // 段 1：逐条删 builtin
  267    for (const row of this.deps.builtinSeed) {
  268      await this.deps.rules.insert({ … });             // 段 2：逐条重灌 seed
  287    await this.renumber(finalOrder);                   // 段 3：显式重编号
  ```

  ```
  372  private async renumber(orderedIds: readonly string[]): Promise<void> {
  373    const rules = await this.deps.rules.listOrdered();
  375    for (let i = 0; i < orderedIds.length; i++) {
  377      if (rule == null || rule.sortOrder === i + 1) { continue; }
  380      await this.deps.rules.update({ ...rule, sortOrder: i + 1 });   // 逐条 UPDATE
  ```

  **`renumber` 的三处复用点**（台账原文，本轮逐个确认）：`moveRule:199`、`reorderRules:223`、
  `resetDefaults:287`。仓储 `update`（`sqlite-smart-sort-rule.repository.ts:101-127`）
  是整行 UPDATE（10 列），**只改一个 `sort_order` 也要重写全行**。

- **修法**（文件 · 函数级）：

  1. **仓储新增单条批量 UPDATE**（`sqlite-smart-sort-rule.repository.ts` + `smart-sort-rule.port.ts`）：
     ```ts
     /** 批量重排：一条 UPDATE … CASE WHEN（或等价 upsert 形态）把 sortOrder 按 pairs 落库。 */
     updateSortOrders(pairs: readonly { readonly ruleId: string; readonly sortOrder: number }[]): Promise<void>;
     ```
     实现形态：`UPDATE smart_sort_rule SET sort_order = CASE rule_id #{c0} THEN #{o0} … ELSE sort_order END
     WHERE rule_id IN (…)`；空数组 no-op（不发 SQL，照 `batchInsert` 的空数组约定，
     `message.port.ts:73-77`）。**分片**：pairs 按 200 一片（对齐
     `SqliteMessageRepository.BATCH_PARAM_BUILD_CHUNK = 200`），避免 999 变量上限。
     JSDoc 注明「只改 `sort_order`，不刷 `updated_at_ms`」（沿用 `renumber` 现有语义：
     `:371` 注释「时间戳不刷」）。
  2. **`renumber` 改为「收集 → 一次 `updateSortOrders`」**：
     ```ts
     private async renumber(
       rules: SmartSortRuleRepository,
       current: readonly SmartSortRule[],   // ← 调用方在事务外读到的列表，本方法不再自己读
       orderedIds: readonly string[],
     ): Promise<void> {
       const byId = new Map(current.map(r => [r.ruleId, r]));
       const pairs = orderedIds
         .map((id, i) => ({ rule: byId.get(id), sortOrder: i + 1 }))
         .filter(p => p.rule != null && p.rule.sortOrder !== p.sortOrder)
         .map(p => ({ ruleId: p.rule!.ruleId, sortOrder: p.sortOrder }));
       if (pairs.length > 0) { await rules.updateSortOrders(pairs); }
     }
     ```
     **签名变更（三处缺一不可，样例与散文必须同款）**：`renumber` 接收①**仓储实例**
     （事务内必须是 `tx` 造的）、②**当前规则列表**（调用方在**事务外**读好传进来，
     本方法内部**不再 `listOrdered()`**——否则事务内会多一次读，且与 R4 的返回值口径打架）、
     ③目标 id 序。**三处调用方（修法 3/4/5）各自传入它已经在事务外读到的那个列表**
     （`moveRule` / `reorderRules` 的事务前 `listOrdered()` 快照、`resetDefaults` `:254`
     那个为用户规则相对序而读的列表），**不得**在事务回调内新起一次读。
  3. **`moveRule`**（`:172-202`）：`listOrdered()` 留在事务外读（把结果存成 `snapshot`），
     事务内只做 `renumber(txRules, snapshot, ids)` + 返回值所需的 `listOrdered()`。
     语义保持「幂等 move（`target === from` 时不发任何写）」不变（`:196` 的守卫不动）。
  4. **`reorderRules`**（`:204-225`）：**全部校验留在事务外**（`:206-222` 的重复/全覆盖检查是纯读，
     在那次读里顺带拿到 `snapshot`），事务内只 `renumber(txRules, snapshot, orderedIds)`。
  5. **`resetDefaults`**（`:253-288`）：三段（删 builtin → 重灌 seed → renumber）**整体包一条事务**。
     `:254` 的 `listOrdered()`（为了快照用户规则相对序）**留在事务外**——
     它是纯读；移进事务会让长事务更持锁。它同时就是 `renumber` 的第②参数
     （`renumber(txRules, snapshot, finalOrder)`），事务内**不再读一次**。
  6. **`deleteBatch`**（`:132-147`）：`:134-143` 的全量校验留事务外，
     `:144-146` 的逐条 delete 包一条事务。
  7. **`setEnabledBatch`**（`:163-170`）：整体包一条事务。
     ⚠ `setEnabled`（`:149-161`）自身是单条写（find + update 两条语句，find 是读），
     **不改 `setEnabled` 本体**（单条入口不该开事务，见 C1-6 I3）——
     `setEnabledBatch` 在事务内**内联** find+update 的逻辑，不再经 `this.setEnabled`
     （否则会经 `this.rules()` 拿到**根连接**的仓储 ⇒ **事务内经根连接写 ⇒ AsyncMutex 不可重入
     ⇒ 永久挂起（死锁）**，**不是**「事务外写，等于没包」：`tdbc-driver-better-sqlite3/src/connection.ts:46-76`
     的 `transaction()` 在整个 async 回调期间持有 `AsyncMutex`（`mutex.ts:16-23` 是非重入 promise 链，
     op-sqlite `connection.ts:59` 同构））。
     **这是本条最容易写错的一处**，必须在代码注释里把「事务内只用 tx 句柄」写成硬约束。
  8. **`resetDefaults` 的 seed 幂等性注记**：台账原文说「seed 是 `INSERT OR IGNORE` 幂等，
     只补缺失行，会掩盖问题」——**本轮复核修正**：service 层的 `resetDefaults` 用的是
     `rules.insert`（**普通 INSERT，不是 OR IGNORE**，`smart-sort-rule.service.ts:268`）；
     `INSERT OR IGNORE` 在 bootstrap 的 `seedBuiltinSmartSortRules`
     （`bootstrap/smart-sort-rule/builtin-smart-sort-rules.ts:122`）。
     ⇒ 事务修好后，**「内置规则永久缺失」的后果不存在了**（失败即回滚）；
     而 bootstrap seed 的幂等性不受影响（它在 bootstrap 事务内）。
     **把这条写进 PR 描述**，避免 reviewer 按台账原文找错地方。

- **验收**：

  | 断言 | 方式 | 期望 |
  |---|---|---|
  | I1 `resetDefaults` 原子性（有牙） | 造 2 用户 + 7 内置；在第 3 条 seed insert 处注入失败；调 `resetDefaults` | 抛错；`listRules()` 与调用前**逐条 deepEqual**（含 `enabled` / `sortOrder`）。旧实现下必红 |
  | I2 `deleteBatch` 原子性 | 3 条规则，第 2 条 delete 注入失败 | 前 1 条**仍在**（旧实现下已被删掉） |
  | I3 `setEnabledBatch` 原子性 + **在事务内写** | 3 条规则，第 2 条 update 注入失败 | 全部 `enabled` 不变；且 spy 断言 **`conn.transaction` 被调 1 次**、写语句用的是 **tx 句柄**（不是根连接——**用注入缝的装饰仓储做连接身份断言**，见 I4；`sql-counting-connection.ts` 记录不了连接身份） |
  | I4 「单事务 = 隐式事务」纪律（**观测面已改**） | 用**已在计划内的 `createRules` 注入缝**（见 C1-6 测试策略）：装饰仓储在构造时记下自己是用哪个 `conn` 造的；spy `conn.transaction` | 事务回调内建出的**每一个**仓储拿到的都是 **tx 句柄**（与 `transaction` 回调传入的句柄**对象同一性**相等），**零个**拿到根连接；并同时断言 `createRules` 的调用次数（事务内建仓储的次数） |
  | I5 `reorderRules` 校验在事务外 | 传部分覆盖 / 重复 id 列表 | 抛 `INVALID_ARGUMENT` 且 `transaction` 调用数 **0** |
  | I6 `renumber` 批量下沉（计数式） | spy `SqliteSmartSortRuleRepository.prototype.update` 与 `updateSortOrders`，20 条规则全量 reorder | `update` 调用数 **0**；`updateSortOrders` **1**；返回的 pairs 长度 = 实际需要改的行数（未变动的行不进 pairs） |
  | I7 撞号决胜不变 | 手工造两条同 `sortOrder` 的行 → `listOrdered` | `ORDER BY sort_order, rule_id` 的决胜结果与修复前逐条一致（`:55` 的 SQL 不动） |
  | I8 既有语义全绿 | `test/smart-sort-rule/smart-sort-rule.service.test.ts` 全量（4 个 describe / **19** 条 `it(` 用例——复核逐行实测点过，`:44/65/86/116/132/154/168/192/219/248/271/292/306/358/379/413/423/433/457`） | 全绿——尤其 `T-SR1` 的「reorderRules keep sort_order consecutive 1..N」、`T-SR2` 的两条 resetDefaults 用例、`T-SR3` round-trip |
  | I9 命令 | `npm run test:fast -w packages/core -- test/smart-sort-rule/` | 全绿 |

  **⚠ I4 的观测面为什么不能用 `sql-counting-connection.ts`**（复核已实读）：
  `test/helpers/sql-counting-connection.ts:59-67/78-82/151-175` 的
  `SqlCounter.record(via, sql)` **只记 `(sql, kind, via)`，没有任何连接身份**
  ⇒ 根连接与 tx 连接的语句在计数里**完全不可区分**，「记录每条写语句的连接标识」
  用既有基建**不可满足**；更糟的是真发生漏写时不是变红而是**永久挂起**
  （AsyncMutex 不可重入，见修法 7 / R1），违反 RULE「验收三牙齿」的可观测性要求。
  ⇒ 唯一合规做法是 I4 写的注入缝方案；**备选**：给 `SqlCounter.record` 加一个 `connTag`
  字段（扩展既有装饰器，不算新造 mock 连接）。

- **测试策略**：
  - **新增** `test/smart-sort-rule/smart-sort-rule-transaction.test.ts`（**与 C1-6 同一文件**，
    便于共用注入缝与 `beforeEach` 隔离夹具），追加用例名
    `T-SRTX5 resetDefaults 中途失败 → 全表不变`、
    `T-SRTX6 deleteBatch / setEnabledBatch 中途失败 → 零半删`、
    `T-SRTX7 setEnabledBatch 的写全部落在事务内（连接身份断言，走 createRules 注入缝）`、
    `T-SRTX8 renumber 下沉后零次逐条 update、一次批量`、
    `T-SRTX9 reorderRules 校验失败零事务`。
  - **观测面纪律**：I6 的 `update`/`updateSortOrders` 计数必须在 **repository prototype** 上打，
    不在 service 上打；I4 的连接身份**只能**来自 C1-6 已在计划内的 `createRules` 注入缝
    （装饰仓储记录自己是用哪个 conn 造的），**不得**新造一个 mock 连接
    （mock 会让事务语义失真）；`sql-counting-connection.ts` 的 `SqlCounter.record`
    记不了连接身份（见上注），**不得**拿它当 I4 的观测面。

- **回归线**：`test/smart-sort-rule/` 全目录、`test/smart-sort/` 全目录、
  `test/bootstrap/smart-sort-rule-seed.test.ts`、`test/workplace/`（排序规则参与工作区排序）、
  `apps/mobile/__tests__/smart-sort-rule-editor-screen.test.tsx`。

- **依赖**：**C1-6**（deps 改造共用）。C1-6 与 C1-7 **必须同一 PR**——
  拆开会留下「C1-6 改了 deps、C1-7 还没用上」的中间态。

- **风险与回滚**：
  - **R1 `setEnabledBatch` 经根连接写**（最高风险，见修法 7）：故障形态是**永久挂起**
    （AsyncMutex 不可重入 ⇒ 死锁），**不是**变红 ⇒ 验收必须用 I4 的连接身份断言在**当场**抓到，
    不得靠「测试超时」发现。I4 是它的牙齿。
  - **R2 `renumber` 少刷 `updated_at_ms`**：现有 `:371` 注释明说「时间戳不刷」，
    新批量方法**必须保持**；若顺手刷了时间戳，UI 的「最近修改」排序会变。I8 的
    `deepEqual`（若既有用例含 `updatedAtMs`）可覆盖；否则在 I1 的断言里显式带上该字段。
  - **R3 批量 UPDATE 的 SQL 形态**：老版 SQLite 的 999 变量上限 ⇒ 分片 200 必须落地。
    I6 只数调用次数抓不到「单片变量超限」，**必须再补一条**：构造 600 对的 reorder
    （分 3 片）并断言不抛 `too many SQL variables`（与 `wave-c2.md` C2-9 的 I1 同款断言口径）。
  - **R4 `moveRule` / `reorderRules` 的返回值**：两者都 `return this.deps.rules.listOrdered()`，
    改造后必须返回**事务内**读的结果（事务提交后读会看到别人插的行）。**语义不变式**：
    返回值 = 调完 `renumber` 后的 `listOrdered`。已在修法里写死。
  - **回滚**：与 C1-6 绑定（同一 PR）。

---

## C1-8 · §6 #8 gemini 同名并行 functionCall 塌陷成一个累加器

- **严重度 / 簇**：P1 / infra-llmproto。**第二源复核结论：成立**（见分片级注记复核表）。
  台账 §6 #8；证据源 `raw/w8-ds-llmproto-a.md:119-150`（F-w8-llmproto-a-01，探针实跑）。

- **病症**：`mergeFunctionCallPart` 的累加器 Map 键是 `fc.id ?? fc.name`。
  Gemini 在 `functionCall.id` 缺席时（API 明确允许省略）退化为**按函数名归并** ⇒
  **并行的两个同名工具调用被压成一个累加器**，`:133-136` 是**赋值不是累加**
  ⇒ 第二个 chunk 的 `args` 整体覆盖第一个。最终 `blocks` 只剩一条 `tool_use`，
  且携带的是**最后一次**调用的参数；而**流事件只发一次**（`tryEmitGeminiToolUseIfComplete:96-98`
  的 `emittedFunctionCallKeys` 守卫在 `:109` 写入，把并行的第二次 `tryEmit` 直接抑制掉了）
  ⇒ 那唯一一条流事件携带的是**第一次**的 args 快照，
  **与落库 block 的末次快照不一致**。
  ⇒ 工具调用**静默丢失 + 参数串味**。

  **对照**：非流式路径 `geminiPartsToBlocks` 在 id 缺席时合成 `${name}-${blocks.length}`
  （`gemini-content-mapper.ts:262-265`，raw 探针实测得 `["ls-0","ls-1"]`）⇒
  **同一条响应在流式与非流式下产出的 tool_use id 与条数都不同**。

- **证据**（`packages/core/src/infra/llm-protocol/logic/gemini-sse-parser.ts`，
  本轮逐行核对；台账 `:122` **行号准确**）：

  ```
  122    const key = typeof fc.id === "string" && fc.id !== "" ? fc.id : fc.name;
  123    let acc = state.functionCalls.get(key);
  124    if (acc == null) {
  125      acc = { name: fc.name, argsJson: "", id: key };
  130      state.functionCalls.set(key, acc);
  132    if (isRecord(fc.args)) {
  133      const newJson = JSON.stringify(fc.args);
  134      if (newJson !== acc.argsJson) {
  135        acc.argsJson = newJson;          // ← 赋值，不是累加
  ```

  对照非流式（`gemini-content-mapper.ts:260-266`）：
  ```
  262      const id =
  263        typeof functionCall.id === "string" && functionCall.id !== ""
  264          ? functionCall.id
  265          : `${functionCall.name}-${blocks.length}`;
  ```

  **下游危害链**（本轮逐跳复核，行号按复核改正——台账/raw 的 `:763`/`:807` 均已漂移）：
  `agent-runner.ts:781-784` filter toolUses → `:825-827` 的 `degradedById`
  **只装 `result.degradedToolCalls`（参数 JSON 非法的降级调用），不是去重表**；
  `:831-848` 的可执行循环**遍历每一个** `tool_use` block 塞进 `runnableCalls`，
  **没有任何 id 去重**。
  ⇒ 真正的危害是**上游 `blocks` 塌成一条 ⇒ 有一个调用根本没被产出**，
  **不是**「Map 吃掉一条、同 id 只执行一次」。

- **修法**（文件 · 函数级）：

  1. `GeminiSseParserState` 新增 `readonly nameOrdinals: Map<string, number>`（**进程内、每条流一份**，
     挂在已有的 `createGeminiSseParserState()` 上，与 `functionCalls` 同寿命）。
  2. **`mergeFunctionCallPart` 签名加一个 `ordinal` 入参**（由调用方在遍历 parts 时算），
     归并键改为：
     ```ts
     const key =
       typeof fc.id === "string" && fc.id !== "" ? fc.id : `${fc.name}#${ordinal}`;
     ```
  3. **`ordinal` 的定义必须钉死（本条的全部难点）**：
     **同一个 chunk 的 `content.parts` 数组内、同名 `functionCall` 的 0 基出现序号**。
     在 `processGeminiResponseChunk` 的 parts 循环（`:165-191`）开头建一个
     `const perChunkNameSeq = new Map<string, number>()`，
     每次遇到 `functionCall` 时 `const n = perChunkNameSeq.get(fc.name) ?? 0;
     perChunkNameSeq.set(fc.name, n + 1)`，把 `n` 传下去。
     **为什么这样是稳定的**：SSE 的增量语义是「每个 chunk 携带当前完整的 parts 快照」，
     一个持续增长的调用在后续 chunk 里**出现在同一 part 位置、同名序号不变** ⇒ key 稳定、
     `argsJson` 继续被同一条累加器更新；而并行的第二个同名调用占另一个序号 ⇒ 独立累加器。
  4. **默认案＝只改流式侧，非流式侧不动**：复核已逐行走查 `gemini-content-mapper.ts:266-275`
     —— `blocks.length` **单调递增**，两个同名调用**必然**拿到不同 id ⇒ **该路径无缺陷**，
     塌陷只发生在流式侧。改它属于「无病而治」，代价是**纯 wire 可见变化**
     （同一会话里新旧两种 id 形态混存，见 R2），收益仅是两条路径的字面同构。
     🔗 **已闭合（judge-r1 B9 → 不对齐两侧）**。以下备选案（两侧对齐）仅作存档，不作为本条口径：
     **备选案（两侧对齐，已被 B9 否决，仅作存档）**：`geminiPartsToBlocks:262-265` 的 `${name}-${blocks.length}`
     同样改成「同名出现序号」口径（`${name}#${ordinal}`），使**同一份响应在流式与非流式下
     产出同构的 id 序列**。⚠ 选这条时 **R2 的真机验证从「建议」升为阻塞前置**
     （Gemini 对 `functionCall.id` 的容忍度本轮**未实测**；未跑通「并行同名工具调用的
     中断-续跑」不得合），且验收 I5 改为两条路径 deepEqual。
  5. **`buildToolUseLookup` 的 name 回退不用改**：`gemini-content-mapper.ts:62-66`
     已经把 `block.name → name` 也塞进 lookup（注释明写「Gemini may echo function name as
     call id when the API omits functionCall.id」），改名后仍成立。
  6. **`emittedFunctionCallKeys` 语义不变**：它按归并键去重，改键即改去重粒度（这正是要的）。

- **验收**：

  | 断言 | 方式 | 期望 |
  |---|---|---|
  | I1 并行同名不塌陷（有牙） | 喂两个无 id 的 `read_file`，args 分别 `{path:"a.md"}` / `{path:"b.md"}` | `finishGeminiSse` 的 `blocks` 里 **2 条** `tool_use`（修复前 1 条）；两条 `input.path` 分别为 a / b（修复前只有 b）；两条 `id` **互不相同**且都含 `read_file` 前缀 |
  | I2 单调用 args 增长仍累积 | 单个无 id `read_file`，三个 chunk 依次给 `{path:"a"}` / `{path:"a","n":1}` / `{path:"a","n":1,"m":2}` | `blocks` **1 条**，`input` 等于**最后一个完整快照**（不是三段拼接）——证明 ordinal 未把同一调用拆成三条 |
  | I3 有 id 时行为不变 | 两个带**不同 id** 的同名调用 | 键 = 原 id，行为与修复前逐条一致 |
  | I4 有 id 时不掺 ordinal | 单个带 id `fc-1` | key 恰为 `"fc-1"`（断言 `blocks[0].id === "fc-1"`，不含 `#`） |
  | I5 流 / 非流口径一致（**默认案下只断流式侧**） | 默认案：同一份 parts 数组喂 `feedGeminiSseChunk`+`finish`；另单独喂 `geminiPartsToBlocks` | 默认案：流式侧 **2 条**、id 互异；非流式侧 id 字面量与修复前**逐条一致**（证明本条**没碰**非流式路径）。备选案（两侧对齐）下改为：两条路径的 `(id, name, input)` 序列**逐条 deepEqual** |
  | I6 下游两条都进 `runnableCalls`（无 id 去重） | `agent-runner` 侧 `:825 degradedById` 的既有测试 + `test/tool/read-tool-result-ref.test.ts` | 全绿；I1 的两条 `tool_use` **都**进入可执行集合（`:831-848` 不按 id 去重） |
  | I7 **两个同名调用分处两个 chunk**（ordinal 口径唯一会再次塌缩的形态） | 两个无 id 同名 `read_file`，分别只出现在 chunk 1 与 chunk 2（供应商标成增量 part 的形态） | **2 条** `tool_use`、args 分别正确。⚠ 若供应商真按增量 part 发，两者 ordinal 都是 0 ⇒ 此断言会红——那正是本口径的已知边界（见 R1），**该形态若在本仓不可构造，必须按 R1 的口径在代码注释与 PR 描述里明写** |
  | I8 命令 | `npm run test:fast -w packages/core -- test/infra/llm-protocol/` | 全绿 |

- **测试策略**：
  - **新增** `test/infra/llm-protocol/gemini-parallel-same-name.test.ts`，用例名
    `T-GPSN1 并行两个无 id 同名调用 → 2 条 tool_use、args 不串味、id 互异`、
    `T-GPSN2 单调用跨 chunk 增长 → 仍 1 条、参数取最后快照`、
    `T-GPSN3 有 id 时键与修复前逐条一致（不含 #ordinal）`、
    `T-GPSN4 默认案：流式侧 2 条 id 互异、非流式侧 id 与修复前一致`
    （备选案下改为「流式与非流式产出同构 id 序列」）、
    `T-GPSN5 两个同名无 id 调用分处两个 chunk → 期望 2 条 tool_use`。
  - **复用**：`test/infra/llm-protocol/gemini-sse-parser.test.ts`（13 条既有用例，
    含 `functionCall 参数增长时累积 args 并在 finish 时 emit tool-use`（`:109`）与
    `functionCall thought_signature stays on tool_use`（`:94`））—— 这两条是 I2 的现成锁，
    改键后**必须仍绿**。

- **回归线**：`test/infra/llm-protocol/` 全目录（5 个 sse parser 测试文件 + transport）、
  `test/tool/` 全目录、`test/agent/agent-runner*.test.ts`。

- **依赖**：无前置。

- **风险与回滚**：
  - **R1 ordinal 语义选错 / 残余塌缩形态**：若 Gemini 的增量形态不是「每 chunk 全量 parts 快照」
    而是「只带新增 part」，①同一调用会被拆成多条；②更隐蔽的是**两个同名调用分处两个 chunk**
    时两者的 ordinal 都是 0 ⇒ **再次塌缩**。
    **缓解**：I2（跨 chunk 增长的单调用必须仍 1 条）是①的牙齿；
    **I7（两个同名调用分处两 chunk ⇒ 期望 2 条）才是本口径完整性的牙齿**——
    I1（同 chunk 两调用）与 I2（单调用增长）**都抓不到②**，R1 的牙齿已由 I2 改为 I7。
    ⚠ 若该形态在本仓不可构造/不可观测，则必须在**代码注释与 PR 描述**里明写：
    「本口径依赖全量快照形态；增量形态下同名分 chunk 调用仍会塌缩，届时需改用全局序号 + part 位置」，
    并把 R1 的牙齿改指 I5。
  - **R2 wire 可见变化**（默认案下，流式侧 id 形态从 `${name}` 变 `${name}#${ordinal}`；
    备选案下非流式的 `${name}-${blocks.length}` 也一并变）：存量会话里的历史 `tool_use` id
    不受影响（回传时按原样发），但 `gemini-content-mapper.ts:196` 会把 `block.id` 原样填进
    `functionCall.id` ⇒ 新旧两种形态会在同一会话里混存。Gemini 对 `functionCall.id` 的容忍度
    本轮**未实测**（原始报告同样标 suspected）。**缓解**：回传时 id 只是关联键，服务端按位置配对。
    **默认案下的验收要求**：真机跑一次「并行同名工具调用」的中断-续跑（人工，AGENTS.md 硬规则下操作）。
    ⚠ **若 judge 选中备选案（两侧对齐），这条真机验证从「建议」升为阻塞前置**——
    真机报 400 就退回默认案（只改流式侧），主要危害（静默丢调用）仍已消除。
  - **R3 下游执行的 id 前提**：`agent-runner.ts:831-848` 的可执行循环按 block 逐个塞进
    `runnableCalls`、**不做 id 去重** ⇒ I1 只要保证 `blocks` 产出**两条**，两条就都会被执行。
    **若不改（保留塌陷）**，后果不是「Map 吃掉一条、少执行一次」，而是
    **`blocks` 只剩一条 ⇒ 有一个调用从头到尾没被产出**。
  - **回滚**：默认案下是**单文件改动**（只动 `gemini-sse-parser.ts`），`git revert` 单提交；
  备选案才追加非流式那一处对照改动。

---

## C1-9 · §6 #9 anthropic `max_tokens: 4096` 硬上限吃掉全部输出预算

- **严重度 / 簇**：P1 / infra-llmproto。**第二源复核结论：成立，且后果比台账记的更严重**
  （见复核表）。台账 §6 #9。

- **病症**：新建已保存模型的默认配置是
  `generation: { sampling: { enabled: false }, thinkingLevel: "high" }`
  （`domain/provider/model/default-saved-model-settings.ts`）。此组合下：
  1. `anthropic.adapter.ts:134` 硬编码 `max_tokens: 4096` 写进 body；
  2. `resolveEffectiveMaxTokens(sampling, "anthropic")` 在 `sampling.enabled === false`
     时返回 `ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = 4096`（`resolve-thinking-wire.ts:47` 与 `:62`）；
  3. `thinking-level-presets.ts:58-62` 算出
     `budget = min(16384, max(1, 4096 - 1)) = 4095`。

  ⇒ **thinking 占 4095、可见正文只剩 1 token**。且 **low 档 preset 也是 4096**
  ⇒ 钳制后同样是 4095 ⇒ **三档无差别**。

- **证据**（本轮逐行核对；台账记的 `anthropic.adapter.ts:134` +
  `apply-thinking-to-body.ts:22` **两处行号都准确**）：

  ```
  anthropic.adapter.ts:132-137
      const body: Record<string, unknown> = {
        model: req.vendorModelId,
        max_tokens: 4096,
  ```
  ```
  anthropic.adapter.ts:144-150
      if (req.sampling?.protocol === "anthropic") {
        const s = req.sampling.anthropic;
        if (s.max_tokens != null) body.max_tokens = s.max_tokens;   // 只在 sampling 打开且显式配了才覆盖
      }
  ```

  ```
  apply-thinking-to-body.ts:22-25
      body.thinking = {
        type: thinking.anthropic.type,
        budget_tokens: thinking.anthropic.budget_tokens,
      };
  ```

  ```
  thinking-level-presets.ts:58-62
        const effectiveMax = resolveEffectiveMaxTokens(sampling, "anthropic");
        const budget = Math.min(
          ANTHROPIC_PRESET_BUDGET[level],       // low 4096 / medium 8192 / high 16384（:14-18）
          Math.max(1, effectiveMax - 1)         // ← 4095
        );
  ```

  ```
  resolve-thinking-wire.ts:18   const ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = 4096;
  ```

  **被单测锁死成期望值**（本轮确认）：`test/provider/thinking-level-presets.test.ts:60`
  `assert.equal(params.anthropic.budget_tokens, 4095);`

  **⚠ 已知待办与本条的关系**：`docs/Iterations/thinking-default-high/prd.md` 的
  「不包含范围」列了「修复 Anthropic 默认 `max_tokens` 下 low/medium/high 钳制相同的问题
  （另开迭代）」——**那只覆盖「三档相同」这个症状，不覆盖「可见输出仅剩 1 token」这个后果**。
  本条按 P1 撰写，不按 intentional 处理（与台账一致）。

- **修法**（文件 · 函数级）：

  1. **消除镜像常量**：`resolve-thinking-wire.ts:18` 的
     `ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = 4096` 删除，改为从
     `domain/provider/model/protocol-sampling-defaults.ts:25` 的
     `ANTHROPIC_SAMPLING_DEFAULTS.max_tokens`（已是 **16_000**）取值。
     **单一来源**：`export const ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = ANTHROPIC_SAMPLING_DEFAULTS.max_tokens;`
     JSDoc 注明「adapter body 默认与 UI 采样默认值必须同源——本条修法的根因就是这两个 4096/16000
     各写一份又互相不知道」。
  2. **adapter 的 body 默认同步**：`anthropic.adapter.ts:134` 的 `max_tokens: 4096`
     改为引用同一个常量，但**直接引值域那一侧**：
     `import { ANTHROPIC_SAMPLING_DEFAULTS } from "@/domain/provider/model/protocol-sampling-defaults.js"`
     并取 `ANTHROPIC_SAMPLING_DEFAULTS.max_tokens`。**同源目标不变**（仍是那一个常量）。
     ⚠ **不要经 `resolve-thinking-wire.ts` 中转**：它与 `thinking-level-presets.ts`
     已构成一对**既存循环依赖**（后者 `:11` 引前者的 `resolveEffectiveMaxTokens`），
     为一个数字把整对循环拖进 adapter 的启动链不划算（当前求值序虽安全，但白付暴露面）。
     infra→domain 的**值**依赖在本仓已有先例——`anthropic.adapter.ts:9-10` 已从
     `@/domain/chat/content/*` 引值；本条只引常量，不引逻辑。
  3. **钳制公式改成比例**：`thinking-level-presets.ts:58-62` 改为
     ```ts
     const budget = Math.min(
       ANTHROPIC_PRESET_BUDGET[level],
       Math.max(1, Math.floor(effectiveMax * ANTHROPIC_THINKING_BUDGET_RATIO))
     );
     ```
     新增模块私有常量 `const ANTHROPIC_THINKING_BUDGET_RATIO = 0.8;`
     JSDoc 写死理由：**Anthropic 的 `max_tokens` 含 thinking 占用** ⇒ budget 必须是它的
     一个真子集，留 20% 给可见正文；三档 preset（4096/8192/16384）在 max=16000 时
     分别得到 4096 / 8192 / 12800 ⇒ **三档不再相同**。
  4. **`applyAnthropicThinkingToBody` 不动**（它只是把已算好的 budget 写进 body，
     病灶不在它）。**但 spec 里要留一句**：若未来出现「body.max_tokens 被 `req.extraBody`
     覆盖成更小值」（`:153` 的 `Object.assign(body, req.extraBody)` 是最后一道、
     覆盖一切），则钳制用的 `effectiveMax` 与实际发出去的 `max_tokens` 会脱钩 ⇒
     **修法 3 的比例钳制让脱钩的后果从「输出只剩 1 token」降级为「thinking 偏多/偏少」**，
     这本身就是本条要买的保险。

- **验收**：

  | 断言 | 方式 | 期望 |
  |---|---|---|
  | I1 默认配置下三档可区分（**核心**） | `thinkingLevelToModelThinkingParams(level, "anthropic", model, { enabled: false, ... })`，level ∈ {low, medium, high} | budget 依次为 **4096 / 8192 / 12800**（修复前三者全 4095） |
  | I2 可见正文有余额 | 对 I1 三个值断言 `budget < body.max_tokens` 且 `body.max_tokens - budget >= 3200` | 成立（修复后余额 3200 / 3200；修复前为 1） |
  | I3 常量同源 | 断言 `ANTHROPIC_BODY_DEFAULT_MAX_TOKENS === ANTHROPIC_SAMPLING_DEFAULTS.max_tokens` | 严格相等（编译期即可断言） |
  | I4 adapter body 实际取值 | 复用 `test/provider/model-request-sampling.test.ts` 的 T10 基座（`mock.fn` fetch 捕获 anthropic body，`:36-61`）建一个 `req`（sampling 缺省 / `enabled:false`）→ 捕获 fetch body | `body.max_tokens === 16000`；`body.thinking.budget_tokens === 12800`（high 档） |
  | I5 sampling 显式配置仍优先 | 同一 captured-body 基座（I4） | `sampling: { enabled: true, params: { protocol: "anthropic", max_tokens: 8000 } }` ⇒ body `max_tokens === 8000`；budget `=== floor(8000*0.8) = 6400` |
  | I6 极端小 max_tokens 不炸 | `max_tokens: 100` | budget `=== 80`（`Math.max(1, …)` 保底仍在，且 80 < 100）；`max_tokens: 1` → budget `=== 1`（保底生效，不出现 `budget >= max_tokens` 的非法请求） |
  | I7 **既有断言必须改（两条，缺一即漏）** | ①`test/provider/thinking-level-presets.test.ts:60` 的 `4095`；②`test/provider/resolve-thinking-wire.test.ts:10` 的 `assert.equal(resolveEffectiveMaxTokens({ enabled: false }, "anthropic"), 4096)` | ①改为 I1 的期望值（high 档 **12800**）；②改为 **16000**。⚠ ②是**复核补列的必红项**——修法 1 一旦改同源，该断言立刻变红，原 spec 只列了①。（同文件 `:27-39` 的 `budget < effective` 复核为 8192 < 16000，**仍绿，不必动**。）**两条都必须在 PR 描述里点名** |
  | I8 命令 | `npm run test:fast -w packages/core -- test/provider/ test/infra/llm-protocol/` | 全绿 |

- **测试策略**：
  - **改** `test/provider/thinking-level-presets.test.ts`：`:51-62` 那条用例扩成三档参数化
    （用例名 `Anthropic 档位 budget 受 effective max_tokens 按 0.8 比例钳制，三档可区分`）。
  - **改** `test/provider/resolve-thinking-wire.test.ts:10`：`4096` → `16000`
    （与 I7 ② 对应，PR 描述里点名）。
  - **新增** `test/provider/anthropic-max-tokens-budget.test.ts`，用例名
    `T-AMT1 默认配置 body.max_tokens=16000、high 档 budget=12800、余额≥3200`、
    `T-AMT2 sampling 显式 max_tokens 优先且按 0.8 钳制`、
    `T-AMT3 max_tokens=1 时 budget 退到 1（不发非法请求）`、
    `T-AMT4 常量与 ANTHROPIC_SAMPLING_DEFAULTS 同源`。
  - I4/I5 需要捕获 adapter 发出的 body：**基座是 `test/provider/model-request-sampling.test.ts`**
    （T10 用 `mock.fn` fetch 捕获 anthropic body，`:36-61`）——**复用 T10 的 captured-body 写法**，
    **不新造 mock fetch 框架**。
    ⚠ 原 spec 指的「`test/infra/llm-protocol/` 里既有的 fetch stub 基建
    （`anthropic-sse-parser.test.ts` 所在目录附近）」**不存在于所指位置**——
    `anthropic-sse-parser.test.ts` 根本不构造 adapter。
  - 新增的 `test/provider/anthropic-max-tokens-budget.test.ts` 与 C1-10 同 PR 时，
    **同样落在 `test/provider/` 这条基座线上**（不要另起目录）。

- **回归线**：`test/provider/` 全目录、`test/infra/llm-protocol/` 全目录、
  `test/prompt/`（thinking context 偏好切片）、`test/config-forms/`（采样表单的默认值显示）。

- **依赖**：无前置。**与 C1-10 同 PR**（两者都在 thinking 语境，reviewer 一起看更省事，
  但无强制顺序）。

- **风险与回滚**：
  - **R1 抬高 max_tokens 触发供应商上限**：部分中转站 / 老模型对 `max_tokens` 有硬上限
    （个别模型上限就是 4096）。**本轮未实测**，raw 报告也未覆盖。
    ⇒ PR 描述必须写明「若某服务商报 `max_tokens` 超限，备选：保留 4096 body 默认、
    只把钳制改 0.8 比例（此时三档仍全为 3276，可见正文 820 token——**比现状的 1 token
    大幅改善但三档仍无差别**）」。这是**降级备选**，不是等价方案。
  - **R2 计费口径变化**：`max_tokens` 只是上限不是预留，Anthropic 按实际输出计费
    ⇒ 抬高**不增加费用**。但中转站若按 `max_tokens` 预扣/限流则行为未知。
  - **R3 `extraBody` 覆盖脱钩**（见修法 4）：已由比例钳制把危害降级；
    **不**在本条加「读 `extraBody.max_tokens` 回灌钳制」——那会让 domain 层反向依赖
    adapter 的合并顺序，见注记 N-7。
  - **回滚**：两个常量 + 一个公式 + 一处测试期望；`git revert` 单提交。
    ⚠ 回滚会让 I7 那**两条**被改过的测试期望失效 ⇒ 回滚必须同时把
    `thinking-level-presets.test.ts:60` 改回 `4095`、`resolve-thinking-wire.test.ts:10` 改回 `4096`。

---

## C1-10 · §6 #10 `stream-partial-blocks` 丢 `thinkingSignature`

- **严重度 / 簇**：P1 / infra-llmproto。**第二源复核结论：成立**。
  台账 §6 #10；证据源 `raw/w8-ds-llmproto-b.md:115-135`（F-w8-ds-llmproto-b-3，探针实跑）。

- **病症**：中断（用户停止）时走 `buildStreamPartialBlocks` 生成 partial 快照，
  该函数把 `thinkingSignature` **全丢了**：`StreamPartialToolUse` 类型里根本没有该字段，
  `thinking` 块的构造也不带签名。
  而 gemini 侧 `functionCallsToToolUses`（`gemini-sse-parser.ts:268-275`）**明明带出来了**，
  anthropic 侧 `state.blocks` 里的 thinking / tool_use 块**也带签名**。
  ⇒ **同一份输入，正常收尾带签名、中断收尾不带**。
  thinking 偏好为「全量保留」时（`apply-thinking-context-for-llm.ts:95-100`）这条 partial
  消息会被原样回传，而 gemini/anthropic 对无签名的 thought/thinking 块会 400。

- **证据**（`packages/core/src/infra/llm-protocol/logic/stream-partial-blocks.ts`，
  本轮逐行核对；台账记的 `:36-55` / `:13-17` **行号准确**）：

  ```
  13  export type StreamPartialToolUse = {
  14    readonly id: string;
  15    readonly name: string;
  16    readonly input: Record<string, unknown>;
  17  };                                        // ← 没有 thinkingSignature
  ...
  36    if (thinking.trim() !== "") {
  37      blocks.push({ type: "thinking", text: thinking });     // ← 没有签名
  ...
  42    for (const tu of input.toolUses ?? []) {
  43      blocks.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });  // ← 没有签名
  ```

  `domain/chat/model/content-block.ts` 侧**字段早就存在**（本轮确认）：
  `:40`（`ToolUseBlock.thinkingSignature`）、`:197`（`ThinkingBlock.thinkingSignature`）、
  `:204`（`RedactedThinkingBlock.thinkingSignature`）。⇒ **纯类型/贯通缺失，不是模型缺字段**。

  **签名有来源（本轮逐处确认）**：
  - gemini：`FunctionCallAccumulator.thinkingSignature`（`gemini-sse-parser.ts:32`）
    → `functionCallsToToolUses` 输出带 `thinkingSignature`（`:272-274`）
    → `finishGeminiSsePartial:390-396` 把它传给 `buildStreamPartialBlocks`（**类型上被截断**）。
    文本级签名另有 `state.thinkingSignature`（`:39`、`:343-345` 的正常路径用它）。
  - anthropic：`state.blocks` 里的 thinking / tool_use 块自带签名
    （`finishAnthropicSsePartial:404-409` 的 `.map(b => ({ id, name, input }))` **把它丢了**）；
    同函数 `:397-403` 把 thinking 块的 `.b.text` join 起来时也**只取文本**。

- **修法**（文件 · 函数级）：

  1. `stream-partial-blocks.ts` 的两个类型补字段：
     ```ts
     export type StreamPartialToolUse = {
       readonly id: string;
       readonly name: string;
       readonly input: Record<string, unknown>;
       /** 不透明 round-trip 签名（Gemini thought_signature / Anthropic signature）。 */
       readonly thinkingSignature?: string;
     };

     export type StreamPartialInput = {
       readonly text: string;
       readonly thinking: string;
       /**
       * thinking 文本级签名（取该流最后一个非空签名）。
       * ⚠ 该字段**仅由 gemini / anthropic 两个 partial 收尾函数提供**；
       * openai 的调用点（`openai-content-mapper.ts:469-475`）既不传 `toolUses`，
       * 也不传本字段（OpenAI 侧无签名概念）。
       */
       readonly thinkingSignature?: string;
       readonly toolUses?: readonly StreamPartialToolUse[];
     };
     ```
  2. `buildStreamPartialBlocks:36-48` 两处 push 补
     `...(x.thinkingSignature != null ? { thinkingSignature: x.thinkingSignature } : {})`，
     形状与 `gemini-sse-parser.ts:343-345` / `:272-274` 的现有写法**逐字一致**（单源风格）。
     `onStream?.({ type: "tool-use", … })` **不带签名**（`LlmStreamEvent` 的 tool-use 变体
     无该字段，本轮已核 `adapter.port.ts`）⇒ **流事件侧不动**。
     ⚠ **同时必须把 `:36` 的 push 守卫从 `thinking.trim() !== ""` 放宽为**
     `thinking.trim() !== "" || input.thinkingSignature != null`
     （**本条选定方案 ①**，不选则 I2/I3 在 signature-only 输入下**不可满足**）：
     上游两处建 thinking 块的守卫分别是
     `text !== "" || signature !== ""`（`anthropic-sse-parser.ts:112-117`）与
     `thinking !== "" || state.thinkingSignature != null`（`gemini-sse-parser.ts:339`）
     ⇒ **存在「只有签名、没有文本」的块**（这正是 Anthropic Claude 4+ 的常态形态）。
     只补字段不改守卫，partial 侧对这类块**根本不 push** ⇒ I2/I3 恒红且无处方。
     `ThinkingBlock.text` 在 `content-block.ts:193-198` **无长度约束**；
     模块注释里「content_json 拒绝空 text」约束的是 `TextBlock`，与这里无关。
     ⚠ 放宽后既有 `T7: abort partial keeps thinking without empty text` 必须**仍绿**
     （它的输入既无文本也无签名 ⇒ 仍不 push，见 I6）。
     **备选案（②）**：不改守卫，把 I2/I3 收窄为「对**有文本**的块序列相同」，
     并把「signature-only 输入下 partial 与正常路径仍不对称」登记为**已知限制**（R 级）
     ——本文件不采用（等于把 Claude 4+ 的常态形态继续留在不一致里）。
  3. `gemini-sse-parser.ts` · `finishGeminiSsePartial:390-396`：补传
     `thinkingSignature: state.thinkingSignature`。
  4. `anthropic-sse-parser.ts` · `finishAnthropicSsePartial:397-409`：
     - thinking：`.join("")` 的同时收集签名——取**最后一个非空 `thinkingSignature`**
       （与 gemini 的 `state.thinkingSignature`「后到覆盖」语义一致），
       作为 `StreamPartialInput.thinkingSignature` 传入；
     - toolUses：`.map(b => ({ id: b.id, name: b.name, input: b.input }))`
       改为 `.map(b => ({ id: b.id, name: b.name, input: b.input,
       ...(b.thinkingSignature != null ? { thinkingSignature: b.thinkingSignature } : {}) }))`。
  5. **`redacted_thinking` 的处理不动**（`:410-418` 已经把它塞进 `otherBlocks` 原样追加、
     签名自带）——raw 报告的争议 #4 指出「两条路不一致是有意还是顺手写的没找到出处」，
     本条只统一 thinking / tool_use 两条路，`otherBlocks` 保持原样。
  6. **openai 调用点确认无需改**：`buildStreamPartialBlocks` 在 `fe79b781` 上有**三个**调用点——
     anthropic `anthropic-sse-parser.ts:414`、gemini `gemini-sse-parser.ts:391`、
     openai `openai-content-mapper.ts:469`（`openAiStreamAccumulatorsToPartialBlocks:460`）。
     前两个本条要改（修法 3/4），第三个**已查、无需改**：
     在 `openai-content-mapper.ts` / `openai.adapter.ts` 内 grep `thinkingSignature`
     **零命中** ⇒ OpenAI 侧根本没有签名概念。
     ⚠ **复核改正**：raw 报告说「三个 partial 收尾函数」**是对的**；原 spec 据
     「`openai-sse-parser.ts` 内无任何 partial 路径」（**grep 目标文件就错了**）
     推出「实际只有两个」，该计数已作废。差异与「openai 侧已查、无需改」的结论
     **一起写进 PR 描述**。

- **验收**：

  | 断言 | 方式 | 期望 |
  |---|---|---|
  | I1 gemini partial 带签名（有牙） | 喂「thinking + 带 `thought_signature` 的 functionCall」后 `finishGeminiSsePartial` | `blocks` 里 thinking 块带 `thinkingSignature === "SIG"`；tool_use 块也带（修复前两者都没有 ⇒ 旧码必红） |
  | I2 **一致性断言（本条的核心口径）** | 同一份输入分别走「正常 `finishGeminiSse`」与「中断 `finishGeminiSsePartial`」，anthropic 侧同款；**输入分两档**：①thinking 有文本；②**signature-only**（thinking 文本为空、只有签名，Claude 4+ 的常态） | 两档下，两条路径产出的 `blocks` 里 `(type, thinkingSignature)` 序列**都相同**。⚠ 第 ② 档在「只补字段、不放宽 `:36` 守卫」的实现下**必红**——它就是修法 2 里放宽守卫的牙齿 |
  | I3 anthropic partial 带签名 | 同上，走 `finishAnthropicSsePartial` | thinking 块与 tool_use 块的 `thinkingSignature` 均与正常路径一致 |
  | I4 无签名时不凭空造 | 输入里没有签名 | `blocks` 里**不出现** `thinkingSignature` 键（`deepEqual` 严格比，缺字段 ≠ `undefined` 键） |
  | I5 流事件不变 | 同 I1 输入 | `onStream` 收到的 `tool-use` 事件**不含** `thinkingSignature` 键（`LlmStreamEvent` 未扩字段） |
  | I6 既有 partial 用例全绿 | `test/infra/llm-protocol/` 全目录 | 全绿——尤其 `gemini-sse-parser.test.ts` 的 `T7: abort partial keeps thinking without empty text`（`:133`）与 anthropic 对应用例 |
  | I7 命令 | `npm run test:fast -w packages/core -- test/infra/llm-protocol/` | 全绿 |

- **测试策略**：
  - **新增** `test/infra/llm-protocol/stream-partial-signature.test.ts`，用例名
    `T-SPS1 gemini partial 与正常路径的 thinkingSignature 序列一致（有文本档 + signature-only 档）`、
    `T-SPS2 anthropic partial 与正常路径一致（thinking + tool_use 两条，同样分两档）`、
    `T-SPS3 无签名输入不产生 thinkingSignature 键（严格 deepEqual）`、
    `T-SPS4 流事件 tool-use 不带签名字段`。
  - **复用**：`gemini-sse-parser.test.ts` 的 `extracts thought_signature from streamed thinking parts`（`:80`）
    与 `functionCall thought_signature stays on tool_use, not empty thinking block`（`:94`）
    ——这两条是**正常路径**的现成锁，本条只补 partial 侧的对称断言。

- **回归线**：`test/infra/llm-protocol/` 全目录、`test/chat/hydrate-tool-results.test.ts`、
  `test/prompt/`（thinking context 保留策略）。

- **依赖**：无前置。

- **风险与回滚**：
  - **R1 「服务端是否必 400」未实测**：raw 报告标 `suspected`（本轮**同样无法实测**，
    无真实 provider 可打）。本条的定级依据是**「正常路径保留、中断路径丢弃」这个确定的
    不一致**（I2 是它的牙齿），不是已实测的 400。PR 描述必须如实写明这一点。
  - **R2 签名泄漏到不该去的地方**：签名是 opaque round-trip 值，
    `thinkingSignature` 只应出现在 thinking / tool_use / redacted_thinking 三种块上。
    I4 的严格 `deepEqual` 是它的护栏。
  - **R3 放宽 `:36` 守卫后会产出「空文本 + 有签名」的 thinking 块**：
    这是**刻意**的——上游两处建块守卫本就是「文本非空 **或** 签名非空」
    （`anthropic-sse-parser.ts:112-117` / `gemini-sse-parser.ts:339`），
    不放宽才是 partial 与正常路径的不对称来源。
    ⇒ PR 描述里必须写明「这是与正常路径对称的结果，不是新引入的空文本块」；
    I6 的 `T7: abort partial keeps thinking without empty text`
    （**无文本且无签名**）必须仍绿。
  - **回滚**：两处类型 + 三处 push/map + `:36` 守卫，纯透传、无新逻辑，`git revert` 单提交。

---

## C1-11 · §6 #11 Kotlin SSE 的 `call.isCanceled()` 闸门把 callTimeout 静默吞掉

- **严重度 / 簇**：P1 / mobile-native（Kotlin 面）。**第二源复核结论：成立，
  且比台账记的更精确**（见复核表）。台账 §6 #11；证据源 `raw/w8-kt-sse.md:95-138`
  （F-w8-kt-sse-1，含 `javap -c` 字节码实测）。

- **病症**：`LlmSseModule.handleStreamFailure` 用 `call.isCanceled()` 当「用户主动 abort」的判据，
  命中就静默 `return`（不发任何事件）。但 **OkHttp 自己的 `callTimeout` 到点时，
  `AsyncTimeout.timedOut()` 会调用 `RealCall.cancel()`**（`javap` 实测确认）⇒
  `isCanceled()` 为 true。于是：
  `callTimeout 到点 → socket 关 → 读循环抛 IOException → handleStreamFailure →
  streams[requestId] 非空 → 命中 :433 → 一个事件都不发`。

  后果链（台账已逐跳核对，本轮复核成立）：JS 侧收不到 Done 也收不到 Error ⇒
  `transport.ts` 的 `routes` 条目永不删除、`post()` 的 Promise **永不 settle**
  ⇒ core `runNative` **不开 JS 侧整调用定时器**（`llm-sse-transport.ts:301-303` 注释明写
  「native 用 transport 内 callTimeout，避免双触发竞态」）⇒ **run 挂到用户手动停止**。
  且本模块配置下 `classifyError`（`:445-457`）的两个 `"timeout"` 入口都不可达
  ⇒ 即使事件发出来，`kind` 也会是 `"network"` 而非 `"timeout"`
  ⇒ `llm-sse-transport.ts:249 isTransportTimeoutError` 判不中 ⇒ **丢掉首字阶段的可自动重试**。

- **证据**（`packages/llm-sse-native/android/src/main/java/com/novelmaster/llmsse/LlmSseModule.kt`，
  本轮逐行核对；台账记的 `:433` **行号准确**）：

  ```
  417  private fun handleStreamFailure(
  ...
  423    val state = streams[requestId]
  424    if (state == null) {
  425      return // 闸门已关（abort 或正常收尾）：不再发终结事件
  426    }
  ...
  432      streams.remove(requestId)
  433      if (call.isCanceled()) {
  434        return // 主动 abort：JS 侧已自行收尾，静默
  435      }
  436      emitError(requestId, kind, message)
  ```

  **⭐ 本轮复核的关键发现（比台账更精确，务必采纳）**：
  `sseAbort`（`:174-183`）的顺序是
  ```
  176    streams.remove(requestId)      // ← 先关闸
  177    val call = calls.remove(requestId)
  179      call?.cancel()
  ```
  ⇒ **用户主动 abort 时 `streams[requestId]` 已经是 null**，`handleStreamFailure` 会在
  `:424-425` 提前 return，**根本走不到 `:433`**。
  ⇒ `:433` 这个闸门在当前代码里**只可能由 OkHttp 内部的 cancel（callTimeout）触发**——
  它的注释「主动 abort：JS 侧已自行收尾」与实际语义**完全相反**：
  **它拦掉的恰恰是唯一不该拦的那一类（超时），而它声称要拦的那一类（用户 abort）
  早在三行之前就被拦掉了。**

  另两条相关事实：
  - `:167-169` 的 `finally { calls.remove(requestId) }`（读循环退出后清理登记）。
  - `:445-457` `classifyError`：`SocketTimeoutException` 分支（client 级 `readTimeout(0)`
    恒禁用，`:78`）与 `InterruptedIOException`+message 含 "timeout" 分支
    （`timeoutExit()` 只在 `messageDone` 路径被调，流式读卡死走不到）**在本模块配置下都不可达**。

- **修法**（文件 · 函数级）：

  1. **删掉 `:433-435` 的 `isCanceled()` 闸门**，改为**显式的用户 abort 标记**：
     新增 `private val userAborted = ConcurrentHashMap<String, Boolean>()`；
     `sseAbort` 里在 `streams.remove` **之前** `userAborted[requestId] = true`；
     `handleStreamFailure` 的判定改为（⚠ **必须把一次性消费提到函数最开头**，
     见下方「为什么不能留在原位」）：
     ```kotlin
     private fun handleStreamFailure(
       requestId: String,
       call: Call,
       t: Throwable,
     ) {
       // 一次性消费必须早于 streams 闸门，否则 abort 路径泄漏：
       // 用户主动 abort 时 sseAbort 已先 streams.remove，这里读到的 state 会是 null，
       // 若把 remove 放在 state == null 的 return 之后，标记就永远不会被消费掉。
       val userAbortedHit = userAborted.remove(requestId) == true
       val state = streams[requestId]
       if (state == null || userAbortedHit) {
         return // 闸门已关（abort 或正常收尾）/ 用户主动中止：不再发终结事件
       }
       ...
       streams.remove(requestId)
       emitError(requestId, kind, message)   // ← 旧的 isCanceled() 闸门已删
     }
     ```
     **为什么不能把 `userAborted.remove` 留在原位（`:433` 那一层）**：用户主动 abort 时
     `sseAbort` 已经先 `streams.remove`，读循环抛错进 `handleStreamFailure` 时
     `:423` 拿到的 `streams[requestId]` **就是 null** ⇒ `:424-425` 提前 return
     ⇒ 永远走不到 `userAborted.remove` ⇒ **每点一次「停止」就往 map 里永久留一条**。
     连带的验收后果：本条 I4（「三次之后 `userAborted` 为空」）在按原写法实现后**必然失败**。
     **一次性消费的写法是 `remove` 而不是 `containsKey`**，保证同一 requestId 只被消费一次。

     **为什么要显式标记而不是直接删**：① 防未来有人调整 `sseAbort` 的顺序
     （streams/calls/userAborted 三处的先后一旦倒过来，闸门就会重新变成「拦超时」）；
     ② 语义自解释——`isCanceled()` 是 OkHttp 的状态，「谁取消的」只有本模块知道。
     ⚠ **标记必须清理**：`handleStreamFailure` 开头的 `userAborted.remove` 是一次性消费；
     正常收尾路径（`finishStream`）也要 `userAborted.remove(requestId)`，
     `shutdown()`（`:245-256`）里 `userAborted.clear()`。
  2. **callTimeout 归类为 `kind: "timeout"`**（否则超时错误发出来也判不成超时）：
     在 `sseConnect` 里给每个请求记下 `callStartedAtNanos` 与生效的 `callTimeoutMs`
     （放进已有的 `StreamState`，`:99-102` 加两个字段即可）；
     `classifyError` 增一个判定：`call.isCanceled() && !userAborted.containsKey(requestId)
     && elapsed >= effectiveCallTimeoutMs` ⇒ `("timeout", "call timeout after ${…}ms")`。
     签名要跟着改（多传两个参数），调用点只有两处（**`:427`**（在 `handleStreamFailure` 内）
     与 `:223`（在 `request` 内））——`:166` 是 `handleStreamFailure(...)` 自身的调用点，
     不是 `classifyError` 的。

     **生效预算的解析式（必须与 `clientWithCallTimeout` 口径一致）**：
     `clientWithCallTimeout`（`:267-274`）在 `callTimeoutMs <= 0` 时返回 `baseClient`，
     而 `baseClient` 的 callTimeout 是 `DEFAULT_CALL_TIMEOUT_MS = 600_000`（`:55`、`:79`）。
     ⇒ 实现时**不得**直接存 `callTimeoutMs` 本身（它可能是 `-1`），否则
     `elapsed >= effectiveCallTimeoutMs` 会**恒真**、保险条件失效。照写：
     ```kotlin
     val effectiveCallTimeoutMs =
       if (callTimeoutMs > 0) callTimeoutMs.toLong() else DEFAULT_CALL_TIMEOUT_MS
     ```
     代码注释必须写死：「与 `clientWithCallTimeout`（`:267-274`）的分支口径必须一致，
     **改一处要改两处**」。

     ⚠ **锁口径（二选一，本文件选 ①）**：`classifyError` 的调用点在 `:427`、
     **在 `synchronized(state)`（`:428`）之外**，而它要读的 `userAborted` 标志
     与修法 1 那次消费**是同一个标志** ⇒ 同一标志被两处读、且两处**都不在** `state` 锁内。
     ⇒ **把 `classifyError` 调用整体移进 `synchronized(state)`（`:428` 之后）**，
     使「读标记 + 关闸 + 发事件」三步同锁。
     残余窗口（**不宣称已完全闭合**，见风险 R2）：修法 1 的一次性消费按 M1 的口径必须发生在
     `:423` 读 state **之前**、因而在锁外，而 `sseAbort` 也不持 `state` 锁 ⇒
     「abort 刚要写标记、handleStreamFailure 刚消费完 null」的窗口在**两种写法下都存在**，
     本条只是把「分类 + 发事件」这段移进锁里缩小它，不是消除它。
     ⇒ 验收 I3 必须按 R2 的降级口径做（真机抽 10 次以上观察），不得写成「已按 R2 全部修正」。

     **口径注释必须写清**：`isCanceled() && 非用户 abort` 在本模块里**唯一**的可能来源就是
     callTimeout（`shutdown()` 走 `streams.clear()`，`state == null` 已在 `:424` 拦掉），
     所以不需要额外信号；elapsed 判定只是把「万一是别的原因」排除掉的保险。

     **本条不改预算（与 RULE:100 显式挂钩）**：600s 仍是 connect + 首字 + 流体
     **全周期**的整调用兜底，RULE:100 拍板的「LLM 流式请求不设固定空闲超时」**不变**；
     本条只把「到点形态」从**静默**（一个事件都不发）改成**发 `kind:"timeout"` 事件**。
     ——「新增 timeout 分类」**不是**在偷偷加空闲界，PR 描述里照此措辞写一句。
  3. **`request()`（非流式）路径不用改判定逻辑**，但它的 `classifyError` 走同款；
     非流式的 callTimeout 会正常抛 `InterruptedIOException("timeout")`（`messageDone` 路径可达）
     ⇒ 已能归 timeout。**只把新参数补上即可**。
  4. **不引入第二个 Executor**（`executor` 已是 cached pool，`:83-85`），
     也**不碰 `flushScheduler`**。

- **验收**：

  | 断言 | 方式 | 期望（**全部为行为断言，不卡耗时**） |
  |---|---|---|
  | I1 callTimeout 必须发 Error | 真机/模拟器：临时把 `SSE_WHOLE_CALL_TIMEOUT_MS`（`llm-sse-transport.ts:129`）改小（如 8_000），对一个**必定不发首字**的 URL 发消息——⚠ **注入目标必须是「本地 accept 后永不响应的 TCP 监听端口」**（如 `nc -l 127.0.0.1 9xxx` 只 accept 不 write），**不要用** `http://10.255.255.1/...` 这类黑洞地址 | JS 侧 `onError` 收到 `kind === "timeout"`；run 以 `LlmStreamTimeoutError` 结束；**不得**挂起（观测：run 状态离开 `running`） |
  | I2 首字阶段可自动重试 | 同 I1，观察重试策略 | `processedLength === 0` 时走**可重试**分支（至少尝试 2 次，最终错误文案指向 timeout 而非 network） |
  | I3 用户 abort 仍静默 | 发消息 → 收到首字后点「停止」，**抽 10 次以上**（R2 的残余窗口靠这条兜，见风险 R2） | **不产生** `LlmSseError` 事件（现状行为必须保持）；run 以 `cancelled` 收尾 |
  | I4 userAborted 标记不泄漏 | 连续 ①正常收尾 ②用户 abort ③callTimeout 三种各一次 | 三次之后 `userAborted` 为空（**用一条 debug 计数日志或单测断言**，见测试策略）；下一次新请求不受上次影响。⚠ 这条断言**只有在修法 1 把消费提到 `handleStreamFailure` 最开头之后才成立**——若把 `userAborted.remove` 留在 `:433` 原位，第 ② ③ 两次（`state == null` 提前 return）都会留残留，本断言必红 |
  | I5 事件闸门不变 | 用户 abort 后，已在 flush 队列里的合批数据 | 仍被丢弃（`flushPending:386-388` 的闸门不动） |
  | I6 编译 | `cd apps/mobile/android && gradlew :llm-sse-native:assembleDebug` | 编译通过。⚠ 该 Gradle 模块名来自 autolinking（由包名 `@novel-master/llm-sse-native` 推导），**若 autolinking 未把库注册为 `:llm-sse-native`，退化为整包 `gradlew assembleDebug`** |
  | I7 既有 JS 侧契约测试 | `npm run test:fast -w packages/core -- test/infra/llm-protocol/llm-sse-transport.test.ts test/infra/llm-protocol/llm-sse-transport-port.test.ts` | 全绿（本条不改 TS，但契约 `kind:"timeout"` 的映射在 TS 侧，回归线要覆盖） |

> ⚠ **I1 的临时改动纪律**：I1 要改 `llm-sse-transport.ts:129` 的
> `SSE_WHOLE_CALL_TIMEOUT_MS`——这**是生产常量**。属**临时本地改动**，
> 验收完毕**立即 revert**，**不得进 PR**；PR 描述里记录改前 / 改后两个值。
> 注入目标之所以换成「本地 accept 后永不响应的 TCP 监听端口」：`http://10.255.255.1/...`
> 在多数网络下 `connect()` 立即返回 `ENETUNREACH`，会拿到 `kind:"network"` 而非 `"timeout"`，
> 测试会**随机红**。（方向本身对：OkHttp `Builder` 默认 `connectTimeout = 10s`，
> 预算改成 8_000 确实能让 callTimeout **先于** connectTimeout 命中。）

- **测试策略**：
  - **Kotlin 侧**：本包**当前无 `src/test`**（`llm-sse-native` 是仓内唯一没有 JVM 测试的
    Kotlin 包，`tokenizer-driver-rn` 有 `android/src/test/`）。
    ⇒ **建议本轮不新建 Kotlin 测试基建**（成本高于收益），改为：
    ① 在 `handleStreamFailure` / `sseAbort` / `finishStream` 三处加
    **仅 `BuildConfig.DEBUG` 下输出的一行计数日志**（abort 次数 / timeout 次数 / 标记残留数），
    供 I4 在真机 logcat 上核对；
    ② I1/I2/I3 走**真机/模拟器 e2e**（遵守 AGENTS.md 硬规则：Metro 走真实路径、
    `adb install -r -d`、**永不卸载**）。
  - **TS 侧**：新增一条 core 测试锁住契约——喂一个 `kind:"timeout"` 的 native 错误，
    断言 `postSse` 把它映射成 `LlmStreamTimeoutError`（若既有 `llm-sse-transport.test.ts`
    已覆盖则不新增，只登记为回归线）。

- **回归线**：`test/infra/llm-protocol/llm-sse-transport*.test.ts`、
  mobile 全量 `npx jest --maxWorkers=2`（RULE「满负载假信号纪律」）。

- **依赖**：无前置。

- **风险与回滚**：
  - **R1 改坏 abort 语义**（最高风险）：把「用户 abort 静默」改成「发 Error」会让每次正常停止
    都弹一条错误。I3 是它的牙齿，**必须真机验证**，不能只跑 TS 测试。
  - **R2 `userAborted` 竞态**（**已知残余窗口，不得宣称已闭合**）：
    `sseAbort` 先写 `userAborted`、再 `streams.remove`、再 `cancel`（本修法就是这个顺序），
    但**不持** `state` 锁；`handleStreamFailure` 的一次性消费在 `:423` 读 state **之前**、
    **同样在锁外**。⇒ 「abort 刚要写标记、handleStreamFailure 刚消费完 null」的窗口
    在**任何一种写法下都存在**。
    本条**已做的**是把「`classifyError` 读标记 + 发事件」整体移进 `synchronized(state)`
    （`:428` 之后），使这一段三步同锁（修法 2 已写死口径）；
    本条**没消除**的是上面那个「消费 vs 写入」的错位窗口。
    ⇒ 后果仍是「多发一条 Error」，I3 会在真机上偶发抓到。
    **验收口径因此降级为「已知竞态 + I3 真机抽 10 次以上观察」**，
    不得在任何文档/PR 描述里写成「已按 R2 完全修正」。
  - **R3 无 Kotlin 测试**：回归全靠真机 e2e ⇒ **必须把 I1/I3 写进 PR 描述的验收清单**，
    并在 `docs/Iterations/` 的验收记录里留 logcat 片段（由主代理/用户执行，代理按纪律
    只在用户在场窗口装包）。
  - **回滚**：Kotlin 单文件 + 三处日志；`git revert` 单提交 + 重新出包
    （⚠ 移动端包一旦装到用户真机，回滚也必须 `adb install -r -d` 覆盖，**不得卸载**）。

---

## C1-12 · §6 #12 `SkspModule` 无 Executor，内联阻塞原生队列

- **严重度 / 簇**：P1 / mobile-native。**第二源复核结论：成立**。
  台账 §6 #12；证据源 `raw/w10-kt-sksp.md`（F-w10-kt-sksp-1，与 `raw/w8-kt-infra.md`
  F-w8-kt-2 同族）。

- **病症**：`@ReactMethod` 默认在 RN 的 NativeModules 队列上**内联**执行，
  而 `SkspModule` 的两个方法在这条队列上做**阻塞式系统调用**：
  `KeyStore.getInstance("AndroidKeyStore").load(null)`（每次都重新 load 上下文，
  `:30`、`:70`）、`encrypt` 还要过一次 `getOrCreateKey`（`:52`）与一次 `Cipher.init`，
  冷路径的 `KeyGenerator.generateKey()`（`:45`，要跨 keystore2 守护进程、硬件支持时走 TEE/StrongBox，
  实测普遍在**百毫秒到秒级**）。
  ⇒ 与 RULE 记载的 2026-09-30 事故**同构**：`TokenizerModule.countPrompt` 内联跑冷词表计数，
  把同一条队列上的其它原生调用一起堵住。

  ⚠ **受害面必须写窄（本轮逐跳核对后的修正，勿照抄旧表述）**：
  主路径时序是 `model-request.service.ts:182` `await resolveProviderApiKey(...)`
  （内含 sksp `decrypt`，经 `resolve-provider-api-key.ts:26` → `base-sqlite-secret-store.ts:55`
  → `android-secret-store.ts:69`）**先于** `:214` `adapter.chat(...)`（sseConnect）执行。
  ⇒ **sksp 与本流的 sseConnect 是「串行前置」，不是队列争用**——
  「把本流的 sseConnect 派发一起堵住」这种表述**会被逐跳核对直接推翻**，不得再写。
  真正的受害面是**同队列上的并发原生调用**：
  ① 另一次 `sseAbort`（用户点「停止」）；② 另一条并发的 `sseConnect`；③ tokenizer 计数。
  其中 ① 对应 RULE:129「native 队列阻塞会让停止失灵」——**这才是本条的可观测后果**，
  验收 I1 因此锚在它身上（见验收）。

- **证据**（本轮逐行核对；台账记的 `SkspModule.kt:48-82` **行号准确**；
  `TokenizerModule.kt:18-24` 的注释在 `:18-24`，executor 在 **`:30-32`**）：

  ```
  SkspModule.kt:48-64    @ReactMethod fun encrypt(ref, plain, promise) { try { … 全同步 … } }
  SkspModule.kt:66-82    @ReactMethod fun decrypt(ref, ciphertextB64, ivB64, promise) { try { … } }
  ```
  全文（`:1-83`）**零 `Executor` 导入、零线程字段**（本轮逐行确认：`import` 只有
  KeyStore / Cipher / KeyGenerator / MessageDigest / RN bridge 那几个）。

  对照范式（`packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerModule.kt`）：
  ```
  30    private val executor = Executors.newSingleThreadExecutor { runnable ->
  31      Thread(runnable, "nm-tokenizer").apply { isDaemon = true }
  32    }
  ...
  43      executor.execute {
  44        try {
  50          promise.resolve(map)
  53          promise.reject("TOKENIZER_COUNT_FAILED", e.message ?: "原生分词计数失败", e)
  ```
  以及 `:18-24` 的事故注释（本轮逐字确认在位）：
  > **计数跑在模块自己的单线程 executor 上（2026-09-30）**：`@ReactMethod` 默认在 RN 的
  > NativeModules 队列上**内联**执行，而 WEB/SP 家族的整串计数在冷词表时可达数秒…

- **修法**（文件 · 函数级）：

  1. `SkspModule.kt` 新增（**逐字照 `TokenizerModule.kt:30-32` 的形状**，只改线程名）：
     ```kotlin
     import java.util.concurrent.Executors

     /**
      * 加解密跑在模块自己的单线程 executor 上（2026-10-01，与 TokenizerModule 同款事故修法）：
      * `@ReactMethod` 默认在 RN 原生模块队列内联执行，而 `KeyStore.load(null)` /
      * 冷路径 `KeyGenerator.generateKey()` 是阻塞式系统调用，会把同队列上的其它原生调用
      * （`sseAbort` / 另一条 `sseConnect` / tokenizer 计数）一起堵住。单线程而非线程池：
      * KeyStore 句柄按串行使用最稳。
      */
     private val executor = Executors.newSingleThreadExecutor { runnable ->
       Thread(runnable, "nm-sksp").apply { isDaemon = true }
     }
     ```
  2. `encrypt` / `decrypt` 两个方法体**整体包进 `executor.execute { … }`**，
     `promise.resolve` / `promise.reject` 保持在 executor 线程上调用
     （JS 侧本就 await Promise，换线程对调用方透明——同 `TokenizerModule` 的注释口径）。
     **reject 的 code 与 message 一字不改**（`ENCRYPT_FAILED` / `DECRYPT_FAILED`）——
     raw 报告另有两条 P3（`e.message` 可为 null、`:25` 的 `String.format` 未带 `Locale.ROOT`）
     **不在本条范围**，见注记 N-6。
  3. **顺手把 KeyStore 实例提为字段**（可选但建议同 PR）：
     `private val keyStore: KeyStore by lazy { KeyStore.getInstance("AndroidKeyStore").apply { load(null) } }`
     ——避免每次 `load(null)`。
     ⚠ **`getOrCreateKey`(`:30`) 与 `decrypt`(`:70`) 两处 `KeyStore.getInstance` 一并改用该字段**，
     全模块**只此一个** KeyStore 实例——只改字段声明而漏掉 `getOrCreateKey` 内部那一处，
     等于同一模块里存在两个 KeyStore 实例、每次 `encrypt` 仍然重新 `load(null)`，
     优化落空，且下面「单线程 executor 下安全」的论证也只覆盖了一半。
     **注意**：AndroidKeyStore 的 `KeyStore` 实例**非线程安全**，
     单线程 executor 下安全；若将来有人加第二个线程，此项必须回退。
     代码注释里写死这条依赖。
  4. **生命周期（选项 B：本条不做显式 shutdown）**：
     **不**新增 `invalidate()` 覆写、**不**调 `executor.shutdownNow()`——
     与 `TokenizerModule` **完全同款**：依赖 daemon 线程随进程回收。
     代码注释里写明「与 `TokenizerModule` 同款：依赖 daemon 线程随进程回收，
     不做显式 shutdown」，避免 reviewer 当成漏项。
     （⚠ `SkspModule` 当前**没有** `invalidate()` 覆写——全文 83 行已核——
     加它就是新代码，而收益在 daemon 线程前提下为零。**备选案 A**：若 judge 认为
     生命周期要对齐得更彻底，可改为「保留 `invalidate()` + `shutdownNow()`」，
     此时 R2 必须改写成「本条比 `TokenizerModule` 多一步生命周期，理由是…」；
     **A / B 必须二选一，本文件按 B 撰写**。）

- **验收**：

  | 断言 | 方式 | 期望（**计数/时序断言，不卡绝对耗时**） |
  |---|---|---|
  | I1 sksp 在途时同队列其它原生调用不被排队（**核心，且必须有牙**） | 模拟器/真机：run 进行中触发一次 sksp 读（搜索工具的 `resolveEngineChain` → `search-config.ts:209` `secretStore.get`，或设置页保存 API Key），**同时**点「停止」 | 量的是 **`sseAbort` 从点击到 `LlmSseError`/`AbortError` settle 的延迟**，要求与「**无 sksp 在途**」对照组**同量级**（取 5× 余量）。旧实现下 sksp 内联占住 NativeModules 队列 ⇒ `sseAbort` 排在它后面 ⇒ 延迟被抬到百毫秒~秒级 ⇒ **旧实现下必红** |
  | I2 加解密功能不变 | 单测（**已有基建**）：`packages/sksp-android/test/android-secret-store.test.ts` 用 `__RN_NATIVE_MODULES__.SkspModule` 桩跑纯 JS base64 直通 | 全绿（该测试**不碰 Kotlin**，故它证明的是「JS 契约没变」，不是「Kotlin 加了 executor」） |
  | I3 真机加解密 | 模拟器/真机 UI 路径：添加服务商 → 保存 API Key（走 `set()` = `encrypt`）→ 重新打开设置（走 `get()` = `decrypt`） | 明文回显正确；**不得**出现 `DECRYPT_FAILED` |
  | I4 线程名（与 C1-11 的 I4 合并同一次 logcat 核对） | logcat | ① `nm-sksp` 线程名在位；② **RN NativeModules 队列线程上看不到 sksp 的栈帧**（后者才是「不再内联」的牙齿，①单独看只是「起了个线程」） |
  | I5 编译 | gradle assembleDebug | 通过（⚠ 按 RULE「Android 出包」条：新 worktree 先 `npm run build:webview:native`，路径长时用 junction/subst） |
  | I6 回归线 | `npm test -w packages/sksp-android`（**该包确有 test script**：`"test": "tsx --test test/**/*.test.ts"`）+ mobile `npx jest --maxWorkers=2` | 全绿 |

> ⚠ **I1 为什么不用原来的「与『未调 sksp』对照组」写法**：主路径上 api key **必须**解密
> （`model-request.service.ts:182` 在 `:214` `adapter.chat(...)` 之前 `await` 了它），
> 「整条消息路径上不调 sksp」这个对照组**在本路径上不可构造**；
> 而 executor 只是把 T(keystore) 挪到 `nm-sksp` 线程，**总时长并不变短**
> （改前 T + 正常，改后仍是 T + 正常）⇒ 原写法在修复前后**同样通过，没有牙齿**。
> ⇒ I1 改为量**并发形状**（队列争用），不是量总时长。

- **测试策略**：
  - **Kotlin 侧**：**不新建测试基建**（同 C1-11 的理由：本仓只有 `tokenizer-driver-rn` 有
    `android/src/test`，为两个方法新建 JVM+Robolectric 基建不划算）。
    但「不建基建」**不等于「不加日志」**——I1/I4 依赖可观测面，**这是本条的产出之一**：
    在 `encrypt` / `decrypt` 两个入口各加一行 **`BuildConfig.DEBUG` 门控**的
    线程名日志（形如 `[nm-sksp] thread=<name> op=encrypt|decrypt`），
    供本条 I4 与 C1-11 的 I4 **共用同一次 logcat 核对**。
  - **JS 侧**：复用 `packages/sksp-android/test/android-secret-store.test.ts`
    （登记为回归线，不改）；必要时补一条「桩 `native.encrypt` 在**非 JS 线程**回调 resolve
    时 promise 仍正确 settle」的用例——桩本身就在 tick 之外 resolve，等价覆盖了跨线程语义。
  - **I1/I3 走真机 e2e**（AGENTS.md 硬规则）。

- **回归线**：`packages/sksp-android/test/android-secret-store.test.ts`、
  mobile 全量 `npx jest --maxWorkers=2`、`gradlew assembleDebug`。

- **依赖**：无前置。**建议与 C1-11 同 PR**（同一个 Kotlin 主题、同一轮真机验收窗口，
  省一次出包）。⚠ **两者不要合并成一次「顺手重构」**——C1-11 改的是错误分类语义、
  C1-12 改的是线程模型，回滚粒度必须独立（见各自风险栏）。

- **风险与回滚**：
  - **R1 KeyStore 实例提取引入线程假设**：见修法 3 的警告。本条**默认做**，
    若 judge 认为风险大，**默认退回「只加 executor、不提实例」**（收益小一点，零新假设）。
  - **R2 daemon 线程无显式 shutdown**：**与 `TokenizerModule` 同款：daemon 线程随进程回收**。
    修法 4 已定为选项 B（不新增 `invalidate()`、不调 `shutdownNow()`），
    所以模块销毁后 executor 仍在这件事**不作为缺陷处理**。
    **实现时按范式照抄并在注释说明**，不要单独发明 lifecycle 处理。
    （若 judge 改选备选案 A「加 `invalidate()` + `shutdownNow()`」，
    本条必须同时把修法 4 与本段改成 A 口径，并写明「比 `TokenizerModule` 多一步生命周期」的理由。）
  - **R3 真机验证窗口**：荣耀真机对 PC 工具来源的安装一律弹锁屏门（AGENTS.md），
    ⇒ I1/I3 需预留**用户在场**窗口，或改用模拟器（Google APIs 镜像）。
  - **回滚**：Kotlin 单文件；回滚同样需要重出包 + `adb install -r -d` 覆盖。

---

## 分片级注记

### N-1 · RT-01 的依赖链（本分片不含 RT-01 本体）

**RT-01 本体归 `wave-b-core1.md`**（`SPEC.md` §2 分片分配表）。本分片只在 C1-1/C1-2/C1-3
的「验收」里引用它的读数基线。三条硬依赖，按序：

1. **RT-02[wave-a] 必须先落**：台账 §10 Wave C 明写「**RT-02 必须先落**」。
   RT-02 = `agent-runner.ts` 每 step 两次独立全会话读（`:413` 的 `session.list()` 与
   `:519` 的 `shouldRequestCompaction` → `visible-floor.trigger.ts:21` 再读一次），
   修法是把 `:519` 换成复用 `:413` 已拿到的 `visible.length`。
   **为什么它是读数基线**：C1-1/C1-2/C1-3 的验收断言都是「全量读调用数 == 0」，
   而 RT-02 不落时**每 step 仍会有一次 `listBySession(includeHidden:false)`**
   （它在 `ChatAgentSession.list()` 这条**已收窄**的路径上，不是全量读，
   所以不与本分片的断言冲突）——但它会让「每 step 会话读总次数」的口径对不上。
   ⇒ 本分片的断言一律**限定在具体读口方法上**（`listBySession` 全列 / `listBySessionUpToSeq`
   / `listReadRefTargetsBySession` / `listBySessionTailOfRole`），
   **不写「每 step 会话读 == 0」这种跨条断言**，正是为了与 RT-02 解耦。
2. **RT-01 落地后本分片不受益也不受损**：RT-01 收窄的是 gemini 的
   `listVisibleSessionMessages`（`agent-runner.ts:604-607`，走
   `runtime.messages.listBySession(id, { includeHidden: false })`）——
   它**仍是 21 列全投影**。若 RT-01 选了「memo 范式」而没做窄读口，
   则 C1-2 新增的 `listReadRefTargetsBySession` 对 RT-01 **不可复用**（语义不同：
   RT-01 要 tool_use 的 id/name，本条只要 id + contentRef）。
   ⇒ **两条不合并实现，但共用「新增一个窄投影读口」这个模式**；
   若 RT-01 最终也选了窄读口，建议在 `message.port.ts` 里把三个窄读口
   （`listReadRefTargetsBySession` / RT-01 的 tool_use 读口 / `listMessageHeadersBySession`）
   **相邻排布并各写一句「谁在用、为什么不能用别的」**，避免下一轮又长出一个全列读口。
3. **不要在 C1-1 的读口上顺带做 RT-01**：fork 确实需要完整正文，
   RT-01 的 tool_use 读口对它没有覆盖能力。

### N-2 · §6 五条的第二源复核结论表

复核方式：**对照 `fe79b781` 现行代码独立重推导**（不读 raw 报告正文作为依据，
只在写完结论后与 raw 对照一致性）。判定口径同台账 §6：
「成立」= 病灶在位且机理闭合；「不成立」= 病灶不在位或已被修。

| # | 条目 | 复核结论 | 本轮实读到的关键事实 | 与台账/raw 的差异 |
|---|---|---|---|---|
| **#8** | gemini 同名并行调用塌陷 | **成立** | `gemini-sse-parser.ts:122` 逐字为 `const key = typeof fc.id === "string" && fc.id !== "" ? fc.id : fc.name;`；`:133-136` 是 `acc.argsJson = newJson`（赋值非累加）；非流式侧 `gemini-content-mapper.ts:262-265` 用 `${name}-${blocks.length}` | **行号全部准确**。本轮补充：`ordinal` 必须取「同一 chunk 内同名出现序」而非「全局计数器」——raw 建议的 `state.functionCallOrdinal` 全局计数器在 args 跨 chunk 增长时会把同一调用拆成多条（本条已改口径，见 C1-8 修法 3 与风险 R1） |
| **#9** | anthropic `max_tokens: 4096` | **成立，且后果比台账更明确** | `anthropic.adapter.ts:134` 确为 `max_tokens: 4096`；`apply-thinking-to-body.ts:22-25` 只是把算好的 budget 写进 body（病灶不在它）；`resolve-thinking-wire.ts:18` 的 `ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = 4096` 与 `protocol-sampling-defaults.ts:25` 的 `ANTHROPIC_SAMPLING_DEFAULTS.max_tokens = 16_000` **是两个互不知情的常量**；`thinking-level-presets.ts:59-62` 钳出 4095 | 台账把病灶归到 `apply-thinking-to-body.ts:22`，**实为旁观者**（它不参与计算）。本条把根因改写为「①两个 max_tokens 常量各写一份（4096 vs 16000）②钳制公式用 `effectiveMax - 1` 而非比例」——**只改公式或只改默认值都不够**，必须同改（见 C1-9 修法 1+2+3） |
| **#10** | `stream-partial-blocks` 丢 `thinkingSignature` | **成立** | `stream-partial-blocks.ts:13-17` 的 `StreamPartialToolUse` 确无该字段；`:36-37` 的 thinking push 确无签名；`domain/chat/model/content-block.ts:40/:197/:204` 三种块**都已有** `thinkingSignature` ⇒ 纯贯通缺失 | raw 说「三个 partial 收尾函数」**是对的**：`buildStreamPartialBlocks` 在 `fe79b781` 上确有**三个**调用点（anthropic `:414` / gemini `:391` / openai-content-mapper `:469`），openai 侧已查、无 `thinkingSignature` 概念故**无需改**。⚠ 本文件初稿据 `openai-sse-parser.ts`（**grep 错文件**）写成「实际只有两个」，已按复核改正（见 C1-10 修法 6） |
| **#11** | Kotlin SSE `callTimeout` 静默挂起 | **成立，且机理比台账更精确** | `LlmSseModule.kt:433` 的 `if (call.isCanceled()) return` 逐字在位；但 `sseAbort:176-178` 是**先 `streams.remove` 再 `cancel`** ⇒ 用户 abort 早在 `:424-425` 的 `state == null` 提前 return，**根本到不了 `:433`** ⇒ 该闸门实际只拦 callTimeout | **这是本轮的新发现，台账未记**。它把修法从「加标记」升级为「删闸门 + 加显式标记 + 补 timeout 归类」三件事（见 C1-11 修法 1/2）。另确认 `classifyError:445-457` 的两个 timeout 入口在本模块配置下都不可达（`readTimeout(0)` 恒禁用 + `timeoutExit()` 只在 `messageDone` 路径可达） |
| **#12** | SKSP 阻塞原生队列 | **成立** | `SkspModule.kt:1-83` 全文零 Executor；`TokenizerModule.kt:30-32` 的 `newSingleThreadExecutor { … "nm-tokenizer" … }` 范式与 `:18-24` 的 2026-09-30 事故注释逐字在位 | 行号准确。台账把 `TokenizerModule.kt:18-24` 记为「executor 位置」，实为**注释位置**（executor 在 `:30-32`）——本条按 `:30-32` 引用 |

**复核方法说明**：五条全部**只读代码**得出结论，未调用任何 provider、未上真机、
未依赖 raw 报告的数字（#9 的 4095 与 #8 的 args 覆盖是**本轮从代码重算**的，
不是抄 raw）。与 raw 的一致性只用于事后比对。

### N-3 · 与 `wave-c2.md` 的边界（`session.copy` / CD-01）

1. **`session.copy` 的事务内全量读不在本分片**：`session.service.ts:388`
   （raw 记的 `:374` 已漂移）由 **`wave-c2.md` C2-3（CS-11）** 覆盖。
   本分片 C1-5 只动 `session.service.ts:227`（`deleteSessionTree` 的那条），
   **两个条目改同一个文件的不同函数**，必须：
   - 合并成一个 PR（C2-3 与 C1-5 同文件、同读口族、同验收口径），或
   - 至少在同一文件上**串行**执行（`wave-c2.md` 的注记 N-3 已写死判据：
     「产出写集合的读必须留在事务内」；C2-3 把 copy 的读**移出**事务是因为它产出的是
     「待复制的快照」——**判定与 CD-01 的 `resolveReconcilePathSets` 相反，理由已由
     wave-c2 写明，本分片不重述、也不外推**）。
2. **CD-01（回滚 plan 与事务内状态不同源）不在本分片 —— 已移交 `wave-c2.md` §C2-10**
   （judge-r1 A.2 已裁定，2026-10-01；本注记由「不认领」改为「已移交」）。
   - 裁定落点：`wave-c2.md` **C2-10 · CD-01 回滚 plan 与事务内状态不同源（四步重排）**，量 L。
     理由三条：①它是**回滚正确性**（静默丢文件 / 无主残留）不是性能结构，与 wave-c2 的事务边界族同源；
     ②`wave-c2.md` N-3 已把「产出写集合的扫描必须留在事务内」写成通用判据，CD-01 正是该判据的原型范例；
     ③与 C2-1 / C2-2 共享 `conn.transaction` 与 AsyncMutex 不可重入的纪律。
   - **编号正名**：台账 `ledger-v2.md:463`（§10 Wave C「全量读收窄系列」格）里的
     「**CD-01** fork 缺上界读口」指的是 **CD-13**（`synth/core-data.md:96` 的原始编号），
     **不是**本条移交出去的回滚那条 —— CD-13 就是本分片的 **C1-1**，由本分片认领。
     ⇒ 两个 CD-01 是台账编号碰撞，**本分片认领 CD-13（C1-1），不认领 CD-01（C2-10）**，
     两个条目互不重复、不互抢。台账那一行的改名由负责 SPEC 分配表的机位执行。
   - **两片对 `resolveReconcilePathSets` 的口径现已同向**（原先这里是「互指甩锅」的死循环）：
     C2-10 的第 3 步只把 `resolveReconcilePathSets` 的**删集合那一半**搬进事务、
     复用 `reconcileVfsPaths` 已取的事务内 `liveHeadRows`，**不整体移进事务**（W6 明确否掉），
     与本分片 C1-5/C2-3 的「移出事务」判定方向相反但**不冲突**——理由写在 C2-10 的修法里。
   - 本分片 C1-1（CD-13）改的是 `message.service.ts` 的 `fork` 读口，
     C2-10 改的是 `message-rollback.service.ts` 一族：**文件不相交、零耦合**，可并行施工。
3. **CD-02（tail 截断/删除两条平行实现）也不在本分片**：本分片只改了
   `truncateAfter` 的**空锚分支**（C1-2），tail 分支与
   `truncateTailInTransaction` 的分叉、composer kkv 域清理差异属 CD-02，已登记为债务（见 N-5）。

### N-4 · 与 Wave D 批次 3 的交叠（`listSessionMessages` 死字段）

`wave-d.md` 批次 3（需先过拍板项 ★1/★3）里大概率也有一条「删死字段」，
而 C1-4 删的 `BuiltinToolContext.listSessionMessages` 是**死字段**。
**建议留在本分片**（它属于性能族、且不依赖任何拍板项），并在 SPEC.md §2 的
分配表里显式登记「C1-4 已由 wave-c1 认领，wave-d 批次 3 不要再列」。
若 judge 决定统一归 Wave D，则本条整体移出，**wave-d 的批次 3 需要先解除 ★1/★3 阻塞**。

### N-5 · 本分片登记但**不修**的债务（留给台账 §3 债务池 / Wave D）

1. **CD-02 的另一半**：`truncateAfter` 的 **tail 分支**（`message.service.ts:512-541`）
   与 `truncateTailInTransaction` 是两条平行实现——①前者不扫 revision（台账原文
   「`truncateAfter` 完全不 sweep revisions」）、②前者不清 composer kkv 域、
   ③前者的读在事务外（TOCTOU）。本分片只改了空锚分支；tail 分支需与回滚链统一，
   属 C2 族的活。
2. **CLI 的 4 处 `listBySession` + JS 侧 `filter(!hidden)`**
   （`apps/cli/src/{agent,model,prompt}/commands.ts` 与 `mobile/chat-prompt-tokens.service.ts:458`）：
   冷路径（CLI 一次性 / chip 兜底），量级 S，**不进本波**。
   ⚠ 但 `chat-prompt-tokens.service.ts:458` 那处本轮**复核仍在位**
   （`const all = await runtime.messages.listBySession(scope.sessionId);` 逐字命中），
   且它的姊妹实现 `session-prompt-input.service.ts` 已经改对 ⇒
   **同一段知识 5 处重复、改一次忘一次已发生过一次**，建议 Wave E 的防再犯钩子
   在 `message.port.ts` 的 `includeHidden` JSDoc 上加一句
   「JS 侧 filter hidden 是反模式」（raw F-11 的建议，本分片采纳为注记不落条目）。
3. **`create-session` 侧的 `listBySession` 消费**：`session.service.ts:227` 已由 C1-5 修；
   `message.service.ts:133-137` 的转发层保留（UI 与 CLI 需要全量语义）。
4. **desktop `MESSAGES_LIST` 无分页通道**（raw F-12，P2）：与本分片无关，属 apps 面。
5. **债务池重复立项（台账 hygiene，非修法项）**：`synth/core-runtime.md` 的 P2/P3 表里
   有两条**已被本分片认领、却仍留在表内并计入 ledger §3 的 155/174**：
   - **RT-24**（`builtin-tool-context.ts:174` + 三处装配死字段）→ **已由 wave-c1 C1-4 覆盖**
     （本文件「C1-4」节，逐字覆盖同一条），**不得在 backlog 里重复立项**；
   - **RT-39**（`subagent-tool.ts:219` 全表解压）→ **已由 wave-c1 C1-3 覆盖**
     （本文件「C1-3」节）。
   ⇒ **judge 轮请在 `synth/core-runtime.md` 的 P2/P3 表与 `ledger-v2.md` §3 各加一行销账标记**，
   否则后续波次会把这 2 条再排一次（本分片不代改那两个文件）。
6. **core-runtime 簇 P2/P3 的 `file:line` 是撰写期快照（盲区注记）**：
   `agent-runner.ts` / `run-agent-turn.ts` 在 synth 里的行号**系统性漂移 +8~+75**
   （疑为撰写于 `150eec3b` 之前），涉及 **RT-14 / RT-16 / RT-20 / RT-33 / RT-34 / RT-52** 六条；
   而 `doom-loop.ts` / `sqlite-session-run-state.repository.ts` /
   `generate-agent-run-id.ts` / `subagent-tool.ts` 等**未改动文件行号精确**。
   ⇒ **若后续把上述六条派进执行批次，必须按 PLAN §8 第 8 条重新开 `fe79b781` 核行号**，
   不得直接照抄 synth 的 `file:line`。

### N-6 · 明确**不在**本分片范围、但实现时会「撞见」的相邻条目

实现 C1-6/C1-7 时会同时看到下列问题，**本分片一律不改**（避免范围蔓延），
但在 PR 描述里点名，避免 reviewer 当成漏项：

| 相邻条目 | 位置（实读） | 为什么不在本条 |
|---|---|---|
| `bundleRulesToEntities` 的条数无上限 → 长事务风险 | `domain/smart-sort-rule/model/smart-sort-rule-io.ts` | 替换式语义要求原子；N 上界属产品/性能取舍，另开条目 |
| `normalizeYamlError` 把 DB 故障贴成「YAML 无效」 | `common/normalize-yaml-error.ts:7-12` | 本条已覆盖**判据**部分（只让 `TdbcError` / 事务类绕过的反转判据）；函数本身不动 |
| `String.format` 未带 `Locale.ROOT`（alias 派生不稳定） | `SkspModule.kt:25`（raw w10 F-2，P2） | 密钥派生缺陷属安全面，须单独评审 |
| `SkspModule` 缺 `deleteKey`（删服务商后 keystore 留孤儿 key） | raw w10 F-3，P2 | 同上 |
| `classifyError` 的 `SocketTimeoutException` 分支不可达 | `LlmSseModule.kt:445-457` | C1-11 已把 callTimeout 归 timeout；该分支是**防御性保留**，保留即可 |
| `llm-sse-transport.ts:285` URL 明文 api key 进 console（**安全 P1**） | `llm-sse-transport.ts:285` | 台账 §5 llmproto 区两造双签的**安全面 P1**，不在 Wave C 性能分片；建议 Wave B 或独立条目 |

### N-7 · 本分片执行时的通用纪律（逐条抄自 RULE，实现时对照）

1. **验收断言取数量级/计数式回归线，不卡实测毫秒**（RULE「性能护栏取数量级回归线」）：
   C1-1/C1-2/C1-3/C1-4/C1-5/C1-7 的验收**全部是「调用次数 == 0 / == 1」或
   「集合逐条 deepEqual」**，没有一条是耗时。唯一的耗时类断言是 C1-12 的 I1，
   它取的是「与『**无 sksp 在途**』对照组同量级 + 5× 余量」（⚠ **不是**「与『未调 sksp』对照组」——
   主路径上 api key 必须解密，该对照组不可构造，见 C1-12 I1 下方注记），
   并在 PR 里记录**基线读数与余量倍数**。
2. **给读路径换实现后，观测面必须同步换**（RULE「全量读收窄」条 + 「进程内缓存」条）：
   本分片新增了 `listReadRefTargetsBySession` / `listBySessionTailOfRole`，两者都**不是**
   `listBySession` ⇒ `backfill-cursor.test.ts` 里 `spyFullSessionReads()` 的
   `contentCallCount()` 观测面**不覆盖它们**。⇒ C1-2 的 I1 断言必须**直接 spy 新方法名**
   （已在验收里写死），并在 `spyFullSessionReads` 的 JSDoc 里补一句「新窄读口不在本 spy 覆盖内」。
3. **「单事务 = 隐式事务」**：C1-6/C1-7 包的事务内部**不得**经 `this.rules()`
   拿根连接写（这是 C1-7 修法 7 点名的最高风险）。验收 I4 用连接标识断言。
 4. **「事务内唯一同步执行」（2026-10-02 口径订正, cr-fix-spec L1-3/OQ8）**: C1-2 实现的行解析走**裸 for 循环、不经 `mapRows`**——本条原文与 C1-2 R3 在此打架, 以实现为准: `listReadRefTargetsBySession` **有意不进 `mapRows`**（写事务内调用, 分片让步对锁持有期无帮助、只会插中间 await, JSDoc 已写明）。若 C1-5 的可选 `yieldFn` 透传将来做了, 让步仍只应在片与片之间, 不得在事务回调里另加 `await sleep`；
   若 C1-5 的可选 `yieldFn` 透传也做了，**让步只能发生在片与片之间**
   （`mapRows` 已保证，`:250-259`）——不得在事务回调里另加 `await sleep`。
5. **core 定向测试必须带 flag**：所有「命令」栏统一写
   `npm run test:fast -w packages/core -- <path>`（该 script 已含
   `--experimental-test-module-mocks --tsconfig tsconfig.test.json`），
   **禁止**裸 `npx tsx --test <file>`。
6. **满负载假信号**：mobile 全量用 `npx jest --maxWorkers=2`；
   desktop 全量在 N-P0-02 落地前**不得**用 `npm test -w apps/desktop` 判绿。
7. **移动端 e2e 纪律**：C1-11/C1-12 的真机验收遵守 AGENTS.md 硬规则——
   Metro 从**真实路径**起、`adb install -r -d` 覆盖装、**任何设备永不 uninstall**、
   荣耀真机需用户在场确认门。
8. **编码纪律**：本分片要改的 Kotlin 文件 `SkspModule.kt` /
   `LlmSseModule.kt` 均为 UTF-8，但 `apps/mobile/android/app/build.gradle` 是**混合编码**
   ——本分片**不碰** build.gradle（RULE「bump 版本号」条的字节级替换纪律在此不触发，
   仅作提醒）。
9. **行号纪律**：本文所有 `file:line` 于 `fe79b781` 实读；台账/raw 漂移处已在各条目
   「证据」小节标出。**judge 轮请以本文为准**，并把 §N-3 的两处正名
   （台账 §10「CD-01」→ CD-13；真正 CD-01 的归属）回写到 SPEC.md 与台账。

### N-8 · 「跨 N 次 repo 调用必须包事务」的评审约定（台账 §10 Wave C 明确要求，初稿未承接）

台账 `ledger-v2.md` §10 Wave C 行明确要求本组「在 service 层加一条
『跨 N 次 repo 调用必须包事务』的评审约定」，而本文初稿全文 grep
「评审约定 / 跨 N 次 / 必须包事务」**零命中** ⇒ 本条在此补上（本文件只落文本，不落盘）。

- **约定文本（建议照抄）**：
  「service 方法里只要在**一个逻辑动作中发起 ≥2 次 repo 写调用**，就必须把它们放进
  **同一条事务**（`conn.transaction`）；且事务回调内一律用**回调传入的 `tx` 句柄**造仓储
  ——经根连接写会撞上 `AsyncMutex` 不可重入，表现为**永久挂起而不是变红**
  （RULE「事务内同步执行」条）。**单条写入口不开事务。**」
- **本分片的自证**：C1-6 修法 1（deps 只留 `conn` + `createRules` 工厂，仓储一律经
  `this.rules(conn)` 取）就是这条约定的落地形态；C1-7 修法 3/4/5/6/7 是它在五个
  多语句入口上的逐条应用。
- **落点**：🔗 **已裁（judge-r1 B10）：转用户拍板**；默认案 ①（`docs/apm/RULE.md`），
  **代理禁写 `docs/apm/`**，落盘动作由主代理/用户在 execute-ready 时完成。
  ①`docs/apm/RULE.md` 增一条持久规则（跨包纪律的既有落点，默认案）；②或写进
  `smart-sort-rule.service.ts` 的模块级 JSDoc（只对本 service 生效）。**二选一**，
  本文件按 ① 撰写。
