# CR 报告 · cr1-c1（scope 模式 · 只读评审）

## ① 元信息

| 项 | 值 |
|---|---|
| 节点 | `cr-c1`（code-review-loop · scope 模式 · review_round 1 / dag_version 1） |
| 仓库 | `D:\Dev\nm-worktree\mcr`（分支 feat/repo-mega-cr） |
| base_sha / head_sha | `fe79b781` / `046f4d9c` |
| 被审 commit | `c667be0f`（Wave C 全量，本节点只判 C1 分片域）+ `759372c8`（Wave C 验收牙齿，同域部分） |
| 业务 spec | `docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-c1.md`（C1-1 ~ C1-12） |
| 本 scope 域 | CD-13 fork 上界读口（C1-1）、message truncate/copy 读取窄化（C1-2 / C1-5）、subagent 窄读（C1-3 / C1-4）、smart-sort 事务化与 `renumber` 下沉（C1-6 / C1-7）、协议三则（C1-8 gemini 归并键 / C1-9 max_tokens 16000 / C1-10 thinkingSignature） |
| 域外（不判） | 存储事务栈（CS-05/06/07/10/11、backfill、TOCTOU、ZIP 三闸、头投递 → cr-c2）、Kotlin 原生代码本体（C1-11 / C1-12 → cr-kotlin）、测试文件牙齿总体审查（→ cr-c-tests） |
| 检查维度 | A（一致性/单一真源）+ B（正确性/边界）+ C（回归与测试牙齿）+ C-orch（事务/编排边界）+ G（守卫/性能护栏） |
| 重点核对（S 阶段 doc-fix 清单） | C1-2 结构断言改写 ✔ / C1-3 补接口 mock ✔ / C1-7 换连接身份断言 ⚠ 见 P2-4 / C1-8 跨 chunk 同名无 id 塌缩钉现状 ✔（按 doc-fix 口径）/ C1-9 中转站 4096 上限 → 以「默认案同源 + 0.8 比例」落地，R1 降级备选未启用 ✔ / C1-11 userAborted 改函数开头消费 ✔（仅形态确认，判定权在 cr-kotlin）/ C1-12 换并发状态断言 → 真机 e2e，代理无窗口，仅确认 executor 落地（判定权在 cr-kotlin） |
| 写入纪律 | 禁改代码 / 禁改 spec / 禁 git 写。本报告为唯一落盘物；探针（`tmp/cr1c1/`）已删除 |
| 自跑结果 | `tsc --noEmit -p packages/core` 绿；域内定向 482/482 绿；扩面回归（chat/session-fs/message-checkpoint/tool/read-ref）仅剩 3 条已知红（usage-stats T-C2/T-C6 时区、checkpoint-seed-batch-perf T-PERF-BATCH 预算），与已知终态「2 确定性 + 1 假信号」吻合，**非本波引入** |

**编号口径说明**：本节点按 spec 分片条目表判定。任务描述里的「CD-13 fork 上界读口」= spec 的 **C1-1**（spec C1-1 里已把台账 `CD-01` 正名为 `CD-13`，并把真 CD-01 移交 wave-c2 C2-10），无出入。C1-11 / C1-12 为 Kotlin，按域外处理。

---

## ② Must-fix

> **本域未发现 P0 / P1。** 12 条 spec 条目里 9 条 PASS、2 条 DEVIATION（轻微、均不改变行为）、1 条 PASS-with-口径改写。
> 下列 8 条全部是 P2：没有一条会造成数据损坏、崩溃或静默功能回归，但每一条都该在 Wave C 收口前处理或登记。

### P2-1 ★top：窄投影读口把「逐行 JSON.parse」搬进了写事务，且不走 `mapRows` 分片让步

**位置**：`packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:350-383`（`listReadRefTargetsBySession`）、`packages/core/src/service/chat/impl/message.service.ts:505-527`（`truncateAfter` 空锚分支）

```ts
// sqlite-message.repository.ts:362-381 —— 裸 for 循环，无 mapRows / 无 yieldFn 分片
const targets: MessageReadRefTarget[] = [];
for (const row of rows) {
  try { targets.push({ id: String(row.id), refs: collectReadRefs(readRowContent(row)) }); }
  catch (err) { console.warn(...); targets.push({ id: String(row.id), refs: [] }); }
}
```

```ts
// message.service.ts:505 —— 这次「读 + 逐行 parse」现在整段发生在写事务内
await this.deps.conn.transaction(async (tx) => {
  const targets = await messages.listReadRefTargetsBySession(sessionId);  // :508
```

**机理**：`readRowContent` 内部 `parseMessageContent(String(row.content_json))`（`:130-146`）是本仓最贵的单行操作（assistant 消息正文 8KB 量级）。改之前这一步跑在 `conn.transaction` **之外**；改之后跑在里面。而 better-sqlite3 的 `transaction()` 在整个 async 回调期间持 `AsyncMutex`（非重入 promise 链）⇒ **互斥锁的持有时间从「一次 SELECT」变成「一次 SELECT + N 次 JSON.parse」**。移动端单连接下，用户在 agent run 进行中点「清空重聊」时，同连接上的 SSE flush / backfill 读会被整段 parse 顶住。`deleteSessionTree`（`session.service.ts:231`）与删项目路径（`project.service.ts:182`）本来就在事务内读，所以那两处**无回归**；新增的回归面只在 `truncateAfter`。

**与 spec 的冲突点**：
- spec C1-2 **风险 R3** 写「会持有写锁更久（但省掉了事务外的一次全量读，总持有时间**下降**）」——这个论证只算了 SQL 往返，**漏掉了占主导成本的 N 次 parse**，因此该结论在实现形态下不成立（实现照 spec 修法落地没错，是 spec 的自述失准）。
- spec 分片级 **N-7 第 4 条**写「C1-2 把读移进事务后，行解析仍走 `mapRows`」——实现**没有**走 `mapRows`（`:362` 是裸 `for`）。spec 的 C1-2 修法 2 本身只要求「直接调用本文件既有的 `readRowContent`」，没点名 `mapRows`，所以这是 spec 内部两处口径打架，实现选了其中一处。**这里必须留痕，否则下一轮有人按 N-7 的口径来判会判成 FAIL。**

**修法建议（二选一，倾向 (a)）**：
- (a) 零改动、只改文案：把 C1-2 R3 与 N-7#4 的表述订正为「本读口只省列数（21→4）+ 消除事务外往返，**不省 parse**；parse 随读一起进事务是本条已知的锁持有期代价」，并在 `listReadRefTargetsBySession` 的 JSDoc 里写明「本方法不进 `mapRows`：它在写事务内被调用，分片让步对锁持有期无帮助，只会在事务中间插入 await」。
- (b) 若要在 mobile 上真正缩短交互卡顿：把 `truncateAfter` 的「产出写集合的读」与「写」之间的窗口重新评估（与 cr-c2 的「产出写集合的读必须留在事务内」判据直接冲突，**不建议在本波做**，登记为债务）。

**补测试建议**：本条不需要新断言（性能护栏按 RULE 取数量级、不卡毫秒），但建议在 `truncate-after-readref-targets.test.ts` 的 T-TRUNC-RT1 注释里补一句「本路径不做让步：读在写事务内，`yieldFn` 不可用是有意的」，免得后人按 N-7 补 `mapRows` 反而在事务中间插 await。

---

### P2-2：`listBySessionOffset` 头投影是**本波无 spec 依据**的域内额外改动（改了 domain port 契约）

**位置**：`packages/core/src/domain/chat/repositories/message.port.ts:52-65`、`sqlite-message.repository.ts:419-445`、`packages/core/test/chat/message-visibility.test.ts:132-177`

```ts
// message.port.ts:62-65 —— 返回类型从 ChatMessage[] 变成 ChatMessageHeader[]
listBySessionOffset(sessionId: string, offset: number): Promise<ChatMessageHeader[]>;
```

**事实**：
- `git grep -rln "listBySessionOffset" -- docs` → **零命中**。本迭代 7 个 fix-spec（wave-a ~ wave-e）**没有任何条目**提到这个读口、也没有任何条目提到测试注释里自称的「G1/G2/G3」三档验收。
- 改动本身是正确且有价值的：唯一生产消费方 `backfill-baseline-checkpoints.ts:132-138` 只用 `segment.map(m => m.id)`；21 列 → 6 列、零 parse；`MessageRepository` 全仓只有一个实现类（`sqlite-message.repository.ts:208`），不是 public 导出面（`src/public/**` 与 `src/index.ts` 零引用），所以**没有破坏面**。测试 `message-visibility.test.ts:132` 的 G1（列集恰为 6 键）/ G3（SELECT 不含正文字节列）/ G2（offset 0/1/99/负数语义）都成立，我实跑绿。
- 但它改了**一个 domain port 的方法签名**，落在一个「每条改动都必须在 spec 里有条目」的波次里，且 `test/message-checkpoint/backfill-cursor.test.ts` 的桩（`:76`）也随之改了类型却没被本轮 diff 覆盖到签名层（它本来就是 `mock.fn`，编译期无感）。

**与 spec 的冲突点**：不是与某条 spec 冲突，而是**与本迭代的追溯纪律冲突**（fix-spec 是这波唯一的账本；commit message 里的「CS-11/头投影」也查无出处——CS-11 在 `wave-c1.md` 注记 N-3 里明确是「`session.copy` 事务内全量读 = wave-c2 C2-3」，与头投影无关）。

**修法建议**（不需要改代码，需要改账本）：在 `wave-c1.md` 补一条 **C1-13 · `listBySessionOffset` 头投影**（P2 · core-data，量 S：21 列 → 6 列、backfill 增量段判定只消费 `id`、验收 = G1/G2/G3 三条已落在 `message-visibility.test.ts:132`），并在 `ledger-v2.md` §10 Wave C 的「全量读收窄系列」格里加一格。或反过来把它显式标为「顺手改、无独立条目」并在 PR 描述里点名。**现状是两头不靠**，下一轮做债务清算时它会消失。

**补测试建议**：无需新增（既有三条已覆盖）。若要更稳，可给 `backfill-baseline-checkpoints.ts:132` 加一句 `@remarks` 说明「本读口已窄投影，改回全列会退回 21 列 + 逐条 parse」。

---

### P2-3：`listBySessionTailOfRole` 的**真实 SQL 从未被任何用例执行过**

**位置**：`sqlite-message.repository.ts:325-348`（新读口）、`packages/core/test/tool/subagent-tool-tail-read.test.ts:81-88`（桩）

```ts
// subagent-tool-tail-read.test.ts:81-88 —— 手写 mock 复刻语义，不是真 SQL
listBySessionTailOfRole: async (_sid, options) => {
  counts.listBySessionTailOfRole += 1;
  return childMessages.filter((m) => m.role === options.role)
                      .slice(-Math.max(1, Math.floor(options.limit)));
},
```

`git grep listBySessionTailOfRole` 全仓命中：定义 3 处 + 消费 2 处 + **测试里全是桩**（`subagent-tool-tail-read.test.ts` / `subagent-tool.test.ts` / `subagent-tool-parallel.test.ts` / `subagent-tool-vfs.test.ts`），**零个用例把它打到真 SQLite**。其余三个新读口都有真库覆盖（`listBySessionUpToSeq` ← `message-fork-upper-bound.test.ts:116/187`；`listReadRefTargetsBySession` ← `truncate-after-readref-targets.test.ts` / `delete-session-readref-targets.test.ts`；`listBySessionOffset` ← `message-visibility.test.ts:141`）——**只有它裸奔**。

**我已实测兜底**（探针已删，`tmp/cr1c1/probe-tail-role.ts` → 真 better-sqlite3）：

| 夹具（seq1 user / seq2 assistant(text) / seq3-7 user(tool_result) / seq8-10 assistant(tool_use)） | 结果 |
|---|---|
| `assistant limit 8` | `m2@2, m8-0@8, m8-1@9, m8-2@10` ✔ 升序、limit 只数 assistant |
| `assistant limit 1` | `m8-2@10` ✔ 不是 `m1` |
| `user limit 3` | `m3-2, m3-3, m3-4` ✔ 中间夹层不占配额 |
| 另一会话 | 只返本会话 ✔ session_id 谓词在子查询内 |

⇒ **实现正确**，缺的是回归锁。

**修法建议**：在 `test/chat/message-visibility.test.ts` 里照该文件已有的 `recordingConnection` 形态（`:24-46`）加一条 `listBySessionTailOfRole：role 过滤在 SQL 子查询内、limit 只数该 role、外层升序`，断言 `Object.keys(rows[0])` 含 `content_json`（证明仍是全列）且 `rows` 的 seq 严格升序。成本约 25 行，堵住「子查询 + LIMIT + 外层 ORDER BY」这类最容易在改 SQL 时悄悄改坏的结构。

**与 spec 的冲突点**：spec C1-3 的 I1 口径 (a)（已由 judge-r1 B7 拍板）明确要求观测面打在 `MessageService` 层的桩上，**因此 spec 本身就没要求真 SQL 用例**——这是 spec 的覆盖盲区，不是实现跑偏。故判为 P2 而非 FAIL。

---

### P2-4：C1-7 I4 的连接身份断言**恒真**（比较对象选错，牙齿为零）

**位置**：`packages/core/test/smart-sort-rule/smart-sort-rule-transaction.test.ts:260-275`（T-SRTX7）

```ts
const countingConn: TdbcConnection = { ..., transaction: (fn) => { txCalls += 1; return origTx(fn); } };  // :48-57
const service = new DefaultSmartSortRuleService({ conn: countingConn, createRules, ... });               // :83-87
...
for (const c of newConns) {
  assert.notEqual(c, ctx.conn, "事务内不得经根连接造仓储（AsyncMutex 不可重入）");   // :272
}
```

**机理**：service 的**根连接是 `countingConn`（一个包装对象）**，不是 `ctx.conn`。所以「事务内经根连接造仓储」这一回归会记录到 `countingConn`，而 `countingConn !== ctx.conn` **照样成立** ⇒ 断言恒真。spec C1-7 I4 的原文要求是「与 `transaction` 回调传入的句柄**对象同一性**相等」——实现比 spec 松了一档。

**为什么仍不是 P1**：真发生该回归时，故障形态是**永久挂起**（`AsyncMutex` 不可重入），测试会超时红，不会静默绿；且 T-SRTX6 的原子性断言（注入第 2 次 update 失败后全表 `enabled` 不变）已覆盖「压根没包事务」这一支。⇒ 净覆盖够，只是 I4 这一条本身没牙。

**修法建议**（一行）：在 harness 里记录 `origTx` 回调收到的那个句柄，再断言 `newConns.every(c => c === txSeen)`。最省事的写法是让 `countingConn.transaction` 把 `fn` 包一层、把 `tx` 存进闭包变量：
```ts
transaction: (fn) => { txCalls += 1; return origTx((tx) => { seenTx = tx; return fn(tx); }); },
```
然后 `assert.equal(c, seenTx)`。

**与 spec 的冲突点**：与 I4 原文的「对象同一性相等」有偏差，属实现偏离验收条款（S 阶段 doc-fix 专门把这条从 `sql-counting-connection` 换成连接身份，为的就是让它有牙，结果换了个比较对象又没牙了）。

---

### P2-5：smart-sort 的 `createRules` 工厂**每次调用都新建仓储 + 新建 SQL AST 缓存**，抵消 parser 缓存

**位置**：`packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:83-85`、`sqlite-smart-sort-rule.repository.ts:45`

```ts
private rules(conn: TdbcConnection = this.deps.conn): SmartSortRuleRepository {
  return this.deps.createRules(conn);        // :84  —— 每次 new 一个仓储
}
// sqlite-smart-sort-rule.repository.ts:45
private readonly parser = new SqlTemplateParser();   // 每个实例一份空 AST 缓存
```

**机理**：改前 `deps.rules` 是**一个**绑根连接的长寿命仓储，parser 的 `astCache`（`infra/sql-template/parser.ts:46`）跨调用复用；改后 `this.rules()` 每次都 new，`listOrdered` / `find` / `insert` / `update` 各自重新词法扫一遍模板。热路径上 `listCompiledRules()` 被 `create-workplace-service.ts:37` 的 `smartRules: () => ...listCompiledRules()` 挂着，mobile 侧 `VfsFileManager.tsx:326` 在**每次目录展开**都调它。

**量级判断**：单条模板约 200 字符，重解析是微秒级，相对一次 SQLite 往返可忽略 ⇒ **不是性能事故**，但它是「一个以性能为主题的 commit 在自己改的路径上丢了既有缓存」，与 Wave C 的方向相反。

**修法建议**：`this.rules()` 对根连接走一个**记忆化的单例**（`private rootRules ??= this.deps.createRules(this.deps.conn)`），事务内仍用 `this.deps.createRules(tx)` 现造。零风险、零行为变化。
**或**：把 `SqlTemplateParser` 提到 `SqliteSmartSortRuleRepository` 之外共享（同 `SqliteMessageRepository` 的做法可参考——它也是每实例一个 parser，但 message repo 是长寿命实例，所以没这个问题）。

---

### P2-6：`isStorageFailure` 的「绕过前缀」三元在 desktop / mobile 各写一份，且新测试没有守住接线

**位置**：`apps/desktop/src/main/services/smart-sort-rule-yaml.service.ts:40-45`、`apps/mobile/src/services/smart-sort-rule-yaml.service.ts:73-78`、`packages/core/test/common/storage-failure-bypass.test.ts:20-23`

```ts
// storage-failure-bypass.test.ts:21-23 —— 测试里**重演**了一遍通道的三元
const surfaced = isStorageFailure(dbFailure) ? dbFailure : normalizeYamlError(dbFailure, "智能排序规则 YAML 无效");
```

**机理**：测试断言的是两个纯函数的行为，**没有断言任何一端 app 真的调了它**。谁把 `apps/mobile/.../smart-sort-rule-yaml.service.ts:74-76` 的 `if (isStorageFailure(error)) throw error;` 删掉，这条测试照样绿。而它守的恰恰是 C1-6 I5 的一半（DB 故障误报成「YAML 无效」）。

**修法建议**（二选一）：
- 把这段 catch 抽成 core 的一个共享纯函数（例如 `normalizeSmartSortImportError(error)`，把 desktop + mobile 两份字面量收敛成一处，顺带解决单一真源），测试直接测它 —— 一次改动同时解决「重复」与「无接线牙」两个问题；
- 或在 `apps/mobile/__tests__/` / `apps/desktop/test/` 各加一条，注入一个 `isStorageFailure → true` 的错误，断言最终 message 不含「YAML 无效」。

**与 spec 的冲突点**：spec C1-6 I5/测试策略把用例落在 `apps/desktop/test/smart-sort-rule-import-error.test.ts`（app 侧），实现落到了 `packages/core/test/common/` 且测的是重演而非接线 —— **落点偏离 + 覆盖降级**。spec 自己也写了「纯函数级，不起 Electron」，所以偏离是半有意的，但「重演而非调用」这一步 spec 没授权。

---

### P2-7：`DefaultMessageService.listBySessionTailOfRole` 的缩进掉到类体第 0 列

**位置**：`packages/core/src/service/chat/impl/message.service.ts:161`

```ts
  listBySessionTail(            // :154  ← 正常 2 空格
    ...
  ): Promise<ChatMessage[]> {
    ...
  }

listBySessionTailOfRole(        // :161  ← 顶格
    sessionId: string,
    options: { role: string; limit: number }
  ): Promise<ChatMessage[]> {
```

`packages/core` **没有** `format:check` script（`package.json` 的 scripts 里只有 lint/build/typecheck/test），eslint 也不管缩进 ⇒ 绿灯通过、无门禁拦截。纯可读性 nit，但在一个 600+ 行的 service 里顶格一个方法会让人第一眼以为它在类外。

**修法建议**：加两个空格。顺带建议 Wave E 的 pre-commit `check-encoding` 钩子旁边加一条 core 的 prettier 门（当前 core 无 format 门是全仓最大的格式盲区）。

---

### P2-8：三处测试的用例名/注释与实际夹具或内容不符（会误导后续维护）

| 位置 | 写的 | 实际 |
|---|---|---|
| `packages/core/test/tool/subagent-tool-tail-read.test.ts:141` | 注释「50 条子会话夹具」 | 循环 20 次 × 2 条 + 1 条 = **41 条** |
| `packages/core/test/session-fs/delete-session-readref-targets.test.ts:209` | 用例名「T-DEL-RT5 **500 条会话下让步点 ≥1**」 | 造 120 条、断言的是**列数收窄**（让步点断言不存在，因为 C1-5 修法 3「可选」未做 ⇒ spec I6「仅当修法 3 做了才立」不适用） |
| `packages/core/test/smart-sort-rule/smart-sort-rule-transaction.test.ts:207` | 注释「重灌 seed 的**第 3 条** insert 抛错」 | `failOn("insert", 3)` 计的是**全局**第 3 次 insert，前面已被 `createRule` 吃掉 1 次 ⇒ 实际是 seed 的**第 2** 条（seed 共 7 条，够用，不影响结果） |

另外 `smart-sort-rule-transaction.test.ts:215` 的 `assert.ok(before.length > 0)` 是恒真断言（`before` 来自 `listRules()`，bootstrap seed 后必然非空），可删。

**修法建议**：改注释/用例名；`T-DEL-RT5` 建议改名成「窄投影查询只取 4 列」，另在 `session.service.ts` 的 JSDoc 里补一句「修法 3（yieldFn 透传）本波未做 ⇒ deleteSessionTree 仍是同步 parse」。

---

## ③ Spec deviations（实现 vs `wave-c1.md`）

| # | 条目 | spec 原文 | 实现 | 判定 |
|---|---|---|---|---|
| D1 | C1-1 修法 2 | 「**必须复用 `mapRows`**，否则丢掉 `yieldFn` 分片让步」 | `sqlite-message.repository.ts:322` `return this.mapRows(rows)` | ✔ 合规 |
| D2 | C1-1 修法 1 | 「SQL 里**只**允许出现 `AND seq <= #{maxSeq}` 一个新条件」+ JSDoc 写明「含 hidden、不得加 `AND hidden = 0`」 | `:318` 只有 `AND seq <= #{maxSeq}`；JSDoc 逐字写死 hidden 纪律 | ✔ 合规 |
| D3 | C1-1 修法 3 | 「空集合守卫**在事务外**抛」 | `message.service.ts:339-343`，在 `conn.transaction`（`:351`）之前 | ✔ 合规（I3 有牙：T-FORK-UB3 桩掉读口返回 `[]` 并 spy `transaction` 计数 == 0） |
| D4 | C1-1 I6 | 「让步点 ≥1（照 T-R2a 计数法）」 | T-FORK-UB5 断言 `yieldCount === 2`（120 行 / `ROW_PARSE_CHUNK=50` ⇒ 3 片 2 让步），**精确值**而非 ≥1 | ✔ 合规且更严 |
| D5 | C1-2 修法 2 | 「逐行直接调用本文件既有的模块私有 `readRowContent(row)`，**不得新写一份解码分支**」 | `:369` `collectReadRefs(readRowContent(row))`，复用既有函数 | ✔ 合规 |
| D6 | C1-2 修法 2 | 「坏行按『空 refs』处理并 `console.warn`」+「⚠ 本文件已钉死为 warn + 跳过」 | `:371-380` try/catch + `console.warn` + `refs: []`，**且仍把坏行 id 推进 targets**（⇒ checkpoint 指针照样删干净，只有 read 引用泄漏） | ✔ 合规且比 spec 更周全 |
| D7 | C1-2 修法 3 | 「事务块结束后原样保留 `:500-501` 的三句（`invalidatePromptTokens` / `invalidateToolUseCount` / `return`），一句都不许丢」 | `message.service.ts:528-530` 三句原样在位 | ✔ 合规 |
| D8 | C1-2 分片 N-7#4 | 「C1-2 把读移进事务后，行解析**仍走 `mapRows`**」 | `sqlite-message.repository.ts:362` 裸 `for`，不走 `mapRows` | ⚠ **spec 自相矛盾**（C1-2 修法 2 未要求 `mapRows`；N-7#4 要求了）。实现选了前者。⇒ 记 P2-1，**须由 spec 机位统一口径** |
| D9 | C1-2 I5 | 「该读发出的 SELECT 出现在 BEGIN 之后、DELETE 之前」 | T-TRUNC-RT3 换成**连接身份 + 调用顺序**（`readConns[0] === deleteConns[0]`、`!== ctx.conn`、`order == ["read","delete"]`）——正是 S 阶段 doc-fix 定的口径（better-sqlite3 的 BEGIN/COMMIT 不经 `conn.execute`，记不到） | ✔ 合规（doc-fix 口径已落地） |
| D10 | C1-3 修法 3① | 「`service/chat/message.port.ts:18` 的 `MessageService` 接口新增 `listBySessionTailOfRole(sessionId, role, limit)`」（三个位置参数） | 实现用 `options: { role; limit }`（`message.port.ts:44-47`） | ⚠ 轻微偏离。与同文件既有的 `listBySessionTail(sessionId, options:{limit})` 形状一致，**更符合本仓风格**，不改行为 |
| D11 | C1-3 修法 4 | 「`:219` 改为 `listBySessionTailOfRole(childSessionId, "assistant", 8)`；`extractLastAssistantText` 签名与逻辑一字不改」 | `subagent-tool.ts:230-233` 传 `{ role: "assistant", limit: 8 }`；`extractLastAssistantText` 未动 | ✔ 合规 |
| D12 | C1-3 修法 5 | 「limit 取 8 的依据**必须写进代码注释**」+「已知差异必须钉一条用例」 | `subagent-tool.ts:224-229` 注释逐条写全；T-SUB-TAIL3 钉成 `undefined` + 兜底文案 | ✔ 合规 |
| D13 | C1-3 修法 6 | 三个既有测试文件的 `messages` 桩必须补 `listBySessionTailOfRole`（`subagent-tool.test.ts:71` / `-parallel.test.ts:49` / `-vfs.test.ts:55`） | 三处均已补，且**都按 role 过滤后取 tail**（与实现同口径），不是 `return []` 占位 | ✔ 合规 |
| D14 | C1-4 修法 1-4 | 删字段 + 三处装配 + 33 个测试文件桩 | `git grep listSessionMessages -- packages apps` → **零命中**；`npx tsc --noEmit -p packages/core` 绿 | ✔ 合规（I1/I2/I3 三条编译级 + grep 级断言全过） |
| D15 | C1-5 修法 1 | 「**同一次改动把 `project.service.ts:176-182` 一并改掉**」（并入案，judge-r1 B8 已闭合） | `session.service.ts:231` + `project.service.ts:182` 两处都改了，且**读都仍在事务内**（修法 2） | ✔ 合规 |
| D16 | C1-5 修法 3 | 「**可选**（建议同 PR）：`SessionServiceDeps` 增 `messageRowYieldFn` + `reposFor(tx, yieldFn)` 透传」 | **未做** | ✔ 合规（spec 自标「可选」，I6 亦写明「仅当修法 3 做了才立」）⇒ 记 P2-8 的用例名问题 |
| D17 | C1-6 修法 1 | deps 改为 `{ conn, createRules, builtinSeed }`，「**推荐只留工厂**」，「`this.deps.rules` 全量替换为 `this.rules()`」 | `smart-sort-rule.service.ts:58-71`（deps）+ `:83-85`（`rules()`）；`git grep "deps.rules"` 零命中 | ✔ 合规（且 JSDoc 把「AsyncMutex 不可重入 ⇒ 永久挂起不是变红」写成了硬约束） |
| D18 | C1-6 修法 3 | 「校验段（`:234-245`）**保持在事务外**」 | `:308-320` 校验在事务外，`transaction` 从 `:328` 起 | ✔ 合规（T-SRTX4 断言 `txCalls - before == 0` 有牙） |
| D19 | C1-6 修法 4 | 「catch 只对**存储/事务类**错误绕过 `normalizeYamlError`，其余照旧套前缀」；「判据必须按**反转**写」 | desktop `:40-45` + mobile `:73-78` 都用 `isStorageFailure(error)`（= `error instanceof TdbcError`）做**反转**绕过 | ✔ 合规（两侧都改了；⚠ 落点与覆盖见 P2-6） |
| D20 | C1-7 修法 1 | 「分片：pairs 按 **200** 一片」+「空数组 no-op（不发 SQL）」+「JSDoc 注明**不刷 `updated_at_ms`**」 | `sqlite-smart-sort-rule.repository.ts:129` `SORT_ORDER_CHUNK = 200`；`:140-142` 空数组早退；`smart-sort-rule.port.ts:20-27` JSDoc 写死不刷时间戳；SQL 确实只 `SET sort_order` | ✔ 合规 |
| D21 | C1-7 修法 1（SQL 形态） | 「`CASE rule_id #{c0} THEN #{o0} … ELSE sort_order END WHERE rule_id IN (…)`」 | 形态逐字一致，`:159-161` 注释专门解释了「同名占位符出现两次就绑两次」 | ✔ 合规且**我已独立核实该前提**：`infra/sql-template/evaluator.ts:59-68` 每个 `#{path}` 节点独立 `renderBind` 并 push 一个参数（`placeholder.ts:22-25`），确实按出现顺序逐个绑定、不去重 ⇒ CASE 先绑 (rid0,ord0,rid1,ord1,…)、IN 再绑 (rid0,rid1,…)，顺序正确。T-SRTX10（607 对 ⇒ 4 片）实跑绿，最终 `sort_order` 严格 1..N |
| D22 | C1-7 修法 2 | `renumber(rules, current, orderedIds)` 三参签名；「本方法**不再 `listOrdered()`**」；三处调用方各自传入事务外读到的快照 | `smart-sort-rule.service.ts:463-484`；调用方 `moveRule:280`(snapshot) / `reorderRules:305`(snapshot) / `resetDefaults:406`(snapshot) | ✔ 合规（`git grep "listOrdered" ` 确认 `renumber` 内零读） |
| D23 | C1-7 修法 7 | 「`setEnabledBatch` 在事务内**内联** find+update，**不再经 `this.setEnabled`**」+「必须把『事务内只用 tx 句柄』写成硬约束」 | `:204-222` 内联，`this.rules(tx)`，注释 `:199-203` 逐字写死 | ✔ 合规（内联的 `enabled === enabled → continue` 与单条 `setEnabled:180-182` 的既有早返回**同款**，不是新语义） |
| D24 | C1-7 I4 | 「事务回调内建出的每一个仓储拿到的都是 tx 句柄（与回调传入的句柄**对象同一性**相等），零个拿到根连接」 | T-SRTX7 比的是 `!== ctx.conn`，而 service 根连接是 `countingConn` | ❌ **偏离**（断言恒真），见 P2-4 |
| D25 | C1-7 I7 | 「撞号决胜不变：手工造两条同 `sortOrder` 的行 → `listOrdered`」 | **无用例**（`smart-sort-rule.service.test.ts` 只有「连续 1..N」类断言） | ⚠ 覆盖缺失但零风险（`:55` 的 `ORDER BY sort_order ASC, rule_id ASC` 本 commit 一字未动） |
| D26 | C1-8 修法 2/3 | 归并键 `fc.id ?? \`${name}#${ordinal}\``；ordinal = **同一 chunk 内**同名 0 基序号 | `gemini-sse-parser.ts:129-131` `functionCallMergeKey`；`:190` `perChunkNameSeq` 建在 `processGeminiResponseChunk` 内（逐 chunk 重置）；`:219-221` 计数 | ✔ 合规。且我核实该 Map 的作用域正确：`:180-187` 只处理 `candidates[0]`，一个 chunk 只跑一遍 parts 循环 |
| D27 | C1-8 修法 4 | 「默认案＝只改流式侧，非流式侧不动」+「R1 边界必须写进代码注释与 PR 描述」 | `gemini-content-mapper.ts` 零改动；`functionCallMergeKey` 注释 `:96-99` 写死增量形态仍会塌缩的边界；T-GPSN4 断言非流式 id 仍是 `read_file-0/1` | ✔ 合规 |
| D28 | C1-8 I7 / 测试策略 T-GPSN5 | spec 原文期望「2 条 tool_use」并自陈「若供应商真按增量 part 发，此断言会红——那正是本口径的已知边界」 | 实现改为**断言塌缩存在**（`gemini-parallel-same-name.test.ts:102-120`，1 条、args = 最后一次） | ✔ **合规**（S 阶段 doc-fix 明确指示「生产不触发、钉现状用例」；代码注释与用例注释都标了口径前提。副作用：将来真修好这条用例会红，属**有意的反向提醒**，建议在用例名里再加 `(勿修)` 之类标记） |
| D29 | C1-9 修法 1/2/3 | 常量同源 + adapter 直引值域那一侧（不经 `resolve-thinking-wire`）+ 钳制改 `floor(max * 0.8)` | `resolve-thinking-wire.ts:26-27` `= ANTHROPIC_SAMPLING_DEFAULTS.max_tokens`；`anthropic.adapter.ts:9,138` 直引 `ANTHROPIC_SAMPLING_DEFAULTS`（注释写明「刻意不经中转」的理由）；`thinking-level-presets.ts:28,71` `Math.max(1, Math.floor(effectiveMax * 0.8))` | ✔ 合规 |
| D30 | C1-9 I7（两条必红项） | ①`thinking-level-presets.test.ts:60` 的 `4095` ②`resolve-thinking-wire.test.ts:10` 的 `4096` | ①改成三档参数化 4096/8192/12800（`thinking-level-presets.test.ts:51-73`）②改成 `16000`（`resolve-thinking-wire.test.ts:11-12`） | ✔ 合规（I7 是本条最容易漏的一条，两条都改了） |
| D31 | C1-9 I4 | 「adapter body 实际取值：`body.max_tokens === 16000`、`body.thinking.budget_tokens === 12800`（high 档）」 | `anthropic-max-tokens-budget.test.ts:45-60` 捕获 body 断言 16000 + 12800 + 余额 ≥3200 | ✔ 合规（该用例把 budget 硬编码在 request 里，属**透传**验证；真正的三档推导由 ①覆盖，合起来满足 I1+I2+I4） |
| D32 | C1-10 修法 2 | 「⚠ **同时**必须把 `:36` 的 push 守卫从 `thinking.trim() !== ""` 放宽为 `… || input.thinkingSignature != null`」 | `stream-partial-blocks.ts:52` 条件已含 `|| input.thinkingSignature != null` | ✔ 合规 |
| D33 | C1-10 修法 3/4 | gemini 补传 `state.thinkingSignature`；anthropic 取**最后一个非空** thinking 签名 + toolUse 逐条透传 | `gemini-sse-parser.ts:427`；`anthropic-sse-parser.ts:405-420`（`reduce` 取最后一个非空）+ `:423-431`（逐条 `...(b.thinkingSignature != null ? … : {})`） | ✔ 合规 |
| D34 | C1-10 修法 2 的「I4 无签名时不凭空造」 | 缺字段 ≠ `undefined` 键 | `stream-partial-blocks.ts:56-60,70-74` 用条件展开；T-SPS3 用 `hasOwnProperty` 严格断 | ✔ 合规 |
| D35 | C1-10 修法 6 | openai 调用点已查、无需改 | `openai-content-mapper.ts` 零改动 | ✔ 合规 |
| D36 | C1-10 I2 | 「两档下（thinking 有文本 / signature-only）两条路径的 `(type, thinkingSignature)` 序列**都相同**」 | T-SPS1（gemini 两档）+ T-SPS2（anthropic 两档）都做 `deepEqual(signatureShape(partial), signatureShape(normal))` | ✔ 合规（这是本条的核心口径，实现到位） |
| D37 | C1-11 / C1-12 | Kotlin 原生代码 | **域外（cr-kotlin）**。仅做只读形态确认：`LlmSseModule.kt:494` 的 `userAborted.remove(requestId)` 确实**提到 `state == null` 判定（:496）之前**（S 阶段 doc-fix 的「函数开头消费」已落地），`:475`（finishStream）与 `:307`（shutdown）也各有清理 | 不判定，转 cr-kotlin |
| — | **C1-13（不存在）** | — | `listBySessionOffset` 头投影（`message.port.ts:62-65` + `sqlite-message.repository.ts:419-445`）在**全部 7 个 fix-spec 里查无条目** | ❌ **无 spec 依据的额外改动**，见 P2-2 |

---

## ④ 核对通过的重点项（避免下游重复劳动）

以下属于本节点重点清单、已逐条实读或实跑确认**通过**的，不需要再查：

1. **`updateSortOrders` 的「同名占位符出现两次就绑两次」前提成立**（D21）。这是本域风险最高的一处 SQL 写法（错了会静默写错 `sort_order` 而不是报错）。已实读 `infra/sql-template/evaluator.ts:59-68` + `placeholder.ts:22-25`：每个 `#{path}` 节点独立求值并 push 一个参数，不做去重 ⇒ 绑定顺序正确。T-SRTX8（20 条全量倒序）断言最终 `sort_order` 严格 1..N 且顺序等于 `reversed`，T-SRTX10（607 对 ⇒ 4 片）不抛 `too many SQL variables`，两条都实跑绿。
2. **C1-1 的「上界读口结果与 `filter(seq<=N)` 逐条等价」是真等价**（D2）。`T-FORK-UB2` 拿 40 条夹具（hidden 两侧分布，两侧各断言 ≥2 条）做 `assert.deepEqual(actual, expected)`，全字段逐条比；`hidden === true` 逐条保留。旧实现若被加上 `AND hidden = 0` 必红。
3. **`fork` 的空集合守卫确实在开事务之前**（D3）。`message.service.ts:339` 早于 `:351` 的 `conn.transaction`；T-FORK-UB3 用 prototype 桩把读口打成 `[]`，再 spy `ctx.conn.transaction` 计数 == 0 —— 这条断言对「把守卫挪回事务内」的实现**有牙**。
4. **`truncateAfter` 事务后的三句失效挂点没被吞**（D7）。`message.service.ts:528-530` 逐字在位；T-TRUNC-RT4 用 `usage_stats.toolUseCount` 哨兵 + `message_checkpoint` 计数双侧对账。
5. **坏行隔离的语义是「跳过 refs 但不跳过 id」**（D6）。`sqlite-message.repository.ts:379` 在 catch 里仍 `targets.push({ id, refs: [] })` ⇒ 坏行的 checkpoint 指针照样被 `deleteCheckpointsForMessages` 清掉，只有 read 引用泄漏。比 spec 原文更周全。
6. **C1-3 的 `limit=8` 在真 SQL 上语义正确**（P2-3 已给实测表）。`role` 过滤在子查询内、`limit` 只数该 role、外层 `ORDER BY seq ASC` 升序，三项都对。
7. **C1-3 的三个既有测试桩是「同款实现」不是占位**（D13）。四处桩（`subagent-tool.test.ts:74`、`-parallel.test.ts:51`、`-vfs.test.ts:59`、`-tail-read.test.ts:81`）全都是 `filter(role).slice(-limit)`，与 `SqliteMessageRepository` 同口径 ⇒ 不会把「实现写错」藏在桩后面。
8. **C1-4 删得干净**（D14）。`listSessionMessages` 在 `packages/` + `apps/` 全仓零命中；`tsc --noEmit -p packages/core` 绿。
9. **C1-6/C1-7 的 deps 改造没有留下后门**（D17）。`git grep "deps.rules"` 在 smart-sort service 内零命中；`SmartSortRuleServiceDeps` 只剩 `conn` / `createRules` / `builtinSeed`，「单语句入口不开事务」的纪律在 `rules()` 的 JSDoc 里写死。T-SRTX3 断言 5 个单语句入口 `txCalls - before == 0`。
10. **C1-6 的 R1「无调用方已在事务里」成立**（`git grep importRules(/resetDefaults(` 全仓核实：desktop IPC / desktop yaml / mobile yaml / CLI 四处，全在顶层，无事务包裹）⇒ 不需要 `runInTransactionOrConn` 兜底。
11. **C1-7 的「校验在事务外」三处都成立**（D18/D22）。`importRules` 校验段、moveRule/reorderRules 的 id 序校验与快照读、deleteBatch 的全量校验，全部在 `conn.transaction` 之前；`renumber` 内部零 `listOrdered`。对应 T-SRTX4 / T-SRTX9（`txCalls == 0`）与 T-SRTX6 的原子性断言都有牙。
12. **C1-9 的两条必红项都改了**（D30）。`4095 → 三档参数化`、`4096 → 16000`；I3 同源断言 `ANTHROPIC_BODY_DEFAULT_MAX_TOKENS === ANTHROPIC_SAMPLING_DEFAULTS.max_tokens` 且 `=== 16_000`（`anthropic-max-tokens-budget.test.ts:95-101`）。
13. **C1-10 的 I2 双档一致性是本条的核心口径，实现到位**（D36）。gemini / anthropic 两侧都做了「正常收尾 vs 中断收尾」的 `(type, thinkingSignature)` 序列 `deepEqual`，且 anthropic 侧 `withText ∈ {true, false}` 两档都跑。
14. **C1-8 的 ordinal 作用域正确**（D26）。`processGeminiResponseChunk:180-187` 只取 `candidates[0]`、只跑一遍 parts 循环 ⇒ `perChunkNameSeq` 的「逐 chunk 重置」语义与 spec 修法 3 一致，不会因多 candidate 而错位。
15. **C1-11 的「一次性消费提到函数开头」已落地**（D37，形态确认）。`LlmSseModule.kt:494` 的 `userAborted.remove(requestId)` 早于 `:496` 的 `state == null` 判定 ⇒ S 阶段 doc-fix 点名的「每点一次停止就往 map 里永久留一条」已闭合。判定权在 cr-kotlin。

---

## ⑤ 结论 verdict

| spec 条目 | 一句话 | 判定 |
|---|---|---|
| **C1-1** CD-13 fork 上界读口 | 修法 1-4 全落地，I1-I7 全有牙（含 I6 让步点精确值 2） | **PASS** |
| **C1-2** truncateAfter 窄投影 + 移进事务 | 修法 1-3 全落地、I1-I7 全覆盖；偏离点只在 `mapRows`（spec 自相矛盾，见 D8） | **DEVIATION**（轻微，无行为影响；须由 spec 机位统一 D8 口径） |
| **C1-3** subagent tail+role 窄读 | 修法 1-6 全落地（含三处既有桩同款补齐）、I1-I6 有牙；偏离只在 port 签名用 options 对象（D10） | **PASS**（含 D10 轻微偏离） |
| **C1-4** 删 `listSessionMessages` 死字段 | 生产与测试侧全仓零命中 + 编译绿 | **PASS** |
| **C1-5** deleteSessionTree / 删项目窄读 | 两处都改、读都留在事务内；修法 3（可选）未做 ⇒ I6 不适用 | **PASS** |
| **C1-6** importRules 事务 + 错误标签 | 修法 1-4 全落地、I1-I4 有牙；I5 用例落点从 app 侧挪到 core 且「重演而非守接线」 | **PASS**（I5 覆盖降级，见 P2-6） |
| **C1-7** 五入口事务 + renumber 下沉 | 修法 1-8 全落地（含 200 分片、空数组 no-op、不刷时间戳、三参签名、内联 find+update）；I4 断言恒真（D24） | **DEVIATION**（I4 恒真，见 P2-4） |
| **C1-8** gemini 归并键 | 修法 1-6 全落地、默认案（只改流式侧）合规、I7 按 doc-fix 改为钉现状 | **PASS** |
| **C1-9** max_tokens 16000 + 0.8 比例 | 修法 1-3 全落地、I1-I7 全覆盖（含两条必红项） | **PASS** |
| **C1-10** thinkingSignature 贯通 | 修法 1-6 全落地（含 `:36` 守卫放宽）、I1-I7 全覆盖 | **PASS** |
| **C1-11** Kotlin SSE 闸门 | 域外（cr-kotlin）；仅形态确认已按 doc-fix 落地 | **N/A（转 cr-kotlin）** |
| **C1-12** SKSP executor | 域外（cr-kotlin） | **N/A（转 cr-kotlin）** |
| **（无条目）** `listBySessionOffset` 头投影 | 正确、有测试、零破坏面，但**全 spec 查无依据** | **DEVIATION（无 spec 条目）**，见 P2-2 |

**计数**：PASS **9** · DEVIATION **3**（C1-2 / C1-7 / 无条目的 `listBySessionOffset`）· FAIL **0** · N/A **2**（C1-11 / C1-12，域外）。

**Must-fix 计数**：**P0 0 / P1 0 / P2 8**。

**综合判断**：Wave C 的 C1 分片**没有发现功能性缺陷**。三条窄读口 + `renumber` 批量下沉 + 协议三则的实现都与 spec 修法逐条对得上，验收断言大多有真牙（尤以 T-FORK-UB2 的逐条 `deepEqual`、T-TRUNC-RT3 的连接身份、T-SRTX1/5/6 的全表 `deepEqual` 原子性、T-SPS1/2 的双档序列一致为佳）。**唯一需要在收口前处理的是 P2-2**（域内多了一条无 spec 依据的 port 契约改动，会在下一轮债务清算里蒸发），其余 7 条 P2 是质量债，可登记为 Wave E 清理项或 K 节建议。

---

## ⑥ K 节建议（下游执行时闭合）

- **K1**（P2-1）：订正 `wave-c1.md` 的 C1-2 R3（「总持有时间下降」不成立）与 N-7#4（「行解析仍走 `mapRows`」与 C1-2 修法 2 打架），并在 `listReadRefTargetsBySession` JSDoc 写明「写事务内不Yield 是有意的」。
- **K2**（P2-2）：在 `wave-c1.md` 补 **C1-13 · `listBySessionOffset` 头投影**条目（含 `message-visibility.test.ts:132` 已落地的 G1/G2/G3 三条验收），并在 `ledger-v2.md` §10 Wave C「全量读收窄系列」加一格。代码不动。
- **K3**（P2-3）：给 `listBySessionTailOfRole` 补一条真 SQLite 用例（照 `message-visibility.test.ts:24` 的 `recordingConnection` 形态），断言 role 过滤在子查询内、limit 只数该 role、外层升序。约 25 行。
- **K4**（P2-4）：T-SRTX7 的 harness 里记录 `origTx` 回调收到的 tx 句柄，断言 `newConns.every(c => c === seenTx)`，替掉现在恒真的 `!== ctx.conn`。
- **K5**（P2-5）：`smart-sort-rule.service.ts` 的 `rules()` 对根连接做记忆化单例，事务内仍现造。零风险。
- **K6**（P2-6）：把 desktop / mobile 两份 `isStorageFailure(error) ? error : normalizeYamlError(...)` 抽成 core 的一个共享函数并直接测它；或各补一条 app 侧接线用例。
- **K7**（P2-7）：`message.service.ts:161` 补两空格；建议 Wave E 给 `packages/core` 加 format 门（当前 core 无 `format:check`，是全仓最大格式盲区）。
- **K8**（P2-8）：修三处用例名/注释（T-SUB-TAIL1 的「50 条」→41；T-DEL-RT5 改名为「窄投影只取 4 列」；T-SRTX5 的「第 3 条 seed insert」→「全局第 3 次 insert」），删掉 `assert.ok(before.length > 0)`。
- **K9**（D25，低优先）：补 C1-7 I7 的撞号决胜用例（造两条同 `sortOrder` 的行 → `listOrdered`）。当前 SQL 未动，零风险，但 spec 列了这条验收。
- **K10**（跨波，勿在本节点做）：`listSessionMessages` 已删，`message.port.ts` 现在并排着 `listBySessionUpToSeq` / `listBySessionTailOfRole` / `listReadRefTargetsBySession` / `listBySessionOffset`（头投影）四个窄读口。建议按 N-1#3 的建议在 `message.port.ts` 里把这四个**相邻排布**并各写一句「谁在用、为什么不能用别的」，同时把 C1-4 删字段后空出来的位置利用起来——这是防止下一轮又长出一个全列读口的最低成本护栏。
