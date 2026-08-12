---
date: 2026-08-12
---

# SQL 全量 CR 与性能校验 harness 技术规格（SPEC）

> 需求来源：`docs/Iterations/sql-cr-audit-2026-08/findings.md`（发现清单）+ 用户口述"基于测试和表做一次全量 CR 和性能校验，伪造数据、统计执行时间、找不合理的表/SQL/代码 bug"。无标准 `prd.md`，本 spec 直接从发现清单和探索报告推导。

## 设计目标

给 `packages/core` 的 18 张 SQLite 表和所有 CRUD 路径搭一个**可复用的性能与正确性校验 harness**，用来：

1. **拦截全部 SQL 并计时**——通过装饰 `TdbcConnection`，零遗漏采集每条 SQL 的执行次数和耗时分布。
2. **批量伪造数据**——给每张表写 seeder，把数据量拉到 1 万、10 万级，暴露真实热点。
3. **跑典型操作序列**——建 session → 追加消息 → capture checkpoint → search → 删除，模拟真实负载。
4. **实证 `findings.md` 的 6 条发现**——哪些是真问题、哪些在当前数据量下可接受。
5. **出报告**——按"SQL 归一化文本 × 执行次数 × P95 耗时"聚合，挑出 N+1 和慢查询。

**非目标**：本 spec 只搭 harness 和跑校验，不修 `findings.md` 里的 6 条发现（修复方案另行立迭代）。

## 总体方案

整个方案的核心杠杆是**一个装饰器 + 一组 seeder + 一个跑批入口**，分三层：

```
┌─ InstrumentedTdbcConnection（装饰层）
│   implements TdbcConnection，包 execute/query/batch/transaction
│   每条 SQL 记 {sql, durationMs, txId?}，transaction 回调里的 tx 也包一层
│
├─ Seeders（数据层）
│   每张表一个 seed 函数，用 conn.batch 批量灌数据
│   走 repository 层（绕过 service 业务逻辑噪音）
│
└─ Audit Suite（编排层）
    仿 tdbc-conformance 的注册器模式：runSqlCrAuditSuite({ createContext })
    每个 describe 覆盖一张表或一类操作序列
    断言 + 出报告（console 表格 + JSON dump）
```

### 关键架构决策

**决策 1：`InstrumentedTdbcConnection` 放 `test/helpers/`，不放生产代码。**

理由是当前目标只是校验，不是为了生产慢查询日志。放 `test/helpers/` 零侵入、零 export 风险。如果将来要做生产 SQL 可观测性，再单独迭代把装饰器提到 `src/infra/tdbc/`。

证据：`TransactionalConnection`（`tdbc-driver-better-sqlite3/src/connection.ts:180`）是仓库里唯一现成的 `TdbcConnection` 装饰器范例，可参考它的 `async` 转发模式（注释 `connection.ts:170-178` 解释了为什么用 async 而非 `Promise.resolve(syncCall())`）。

**决策 2：`transaction` 回调里的 `tx` 必须也包一层 Instrumented。**

这是整个方案的成败关键。`BetterSqlite3Connection.transaction`（`tdbc-driver-better-sqlite3/src/connection.ts:46-76`）给回调的 `tx` 是内部 `new TransactionalConnection(this)`，外层装饰器拦不到。

而 `findings.md` 发现 2（`insertCheckpoint` 的 N+1）恰恰发生在事务里——`DefaultMessageCheckpointService.capture`（`service/message-checkpoint/impl/message-checkpoint.service.ts:36`）开了 `conn.transaction`，`insertCheckpoint` 在事务内被调，N+1 的 INSERT 循环跑在事务里。不装饰 `tx` 就抓不到这个 N+1。

实现方式：

```ts
async transaction<T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
  const txId = nextTxId();
  return this.inner.transaction((tx) => {
    const instrumentedTx = new InstrumentedTdbcConnection(tx, this.recorder, txId);
    return fn(instrumentedTx);
  });
}
```

`TransactionalConnection` 的 `transaction` 直接 reject `NESTED_TRANSACTION`，所以 instrumented 包装它的 `transaction` 也会正确 reject，语义一致。

**决策 3：归一化 SQL key 用 `?` 占位的最终 SQL，报告阶段做二次折叠。**

`executeTemplate` / `queryTemplate`（`infra/tdbc/logic/template-helper.ts:14-35`）调 `parser.parse` 后传给 `conn.execute` 的已经是 `?` 占位的归一化 SQL。instrument 层天然拿到这个，零成本。

`IN (?,?,?)` 这种动态长度的 SQL 会裂成多个 key，但这个在报告阶段用正则把 `IN (?,?,...,?)` 折叠成 `IN (?)` 即可，不污染采集层。

**决策 4：验证 `findings.md` 发现 3（LIKE 全表扫）用临时文件库，不用 `:memory:`。**

`:memory:` 没有磁盘 IO 开销，LIKE 全表扫在内存里可能快得不像热点（隐藏约束，探索报告 1 的风险点 1）。`searchMessages`（`sqlite-message.repository.ts:275-282`）的 `content_json LIKE '%kw%'` 要真实反映性能影响，得用 `tdbc:sqlite:file:<tmp>` 起文件库。

harness 提供两种 fixture：`openNovelMasterTestConnection()`（`:memory:`，默认）和 `openFileBackedNovelMasterTestConnection(tmpPath?)`（临时文件库，LIKE/磁盘相关测试用）。

**决策 5：seeder 走 repository 层，不走 service 层（除少数带复杂副作用的操作）。**

理由是 harness 要测 SQL 性能，不是业务逻辑。`message-search.test.ts:30-49` 已有先例——直接 `new SqliteMessageRepository(conn)` + 手造对象。

例外：`messageCheckpoint.capture` 和 `sessions.create` 这类带复杂副作用（VFS 扫描、agent config 注入）的操作走 service，因为它们的真实路径就是 service 层，绕过反而测不到真实负载。

证据：`NovelMasterTestContext`（`test/helpers/novel-master.ts:42-56`）暴露 `conn` 字段，可以直接 new 任意 repo；现有测试如 `message-search.test.ts` 就是这么做的。

**决策 6：新增 `test:sql-cr` 脚本，默认 `test` 排除 harness 文件。**

仿 `test:perf` 的写法（`packages/core/package.json` 的 `test` 用 `!(performance)` 排除性能测试）。harness 测试耗时大，不该拖慢日常 `npm test`。

`test` 脚本的负向 glob 从 `!(performance)` 改成 `!(performance|sql-cr-*)`（或把 harness 文件放 `test/sql-cr-audit/` 目录，用目录排除）。

## 最终项目结构

纯新增，零改动生产代码：

```
packages/core/test/
  sql-cr-audit/
    instrumented-connection.ts          # InstrumentedTdbcConnection 装饰器 + SqlRecorder
    instrumented-connection.test.ts     # 装饰器自身的单元测试
    seeders/
      seed-messages.ts                  # seedMessages(conn, sessionId, count)
      seed-vfs-tree.ts                  # seedVfsTree(vfs, {depth, breadth})
      seed-checkpoints.ts               # seedCheckpoints(ctx, sessionId, count)
      seed-providers.ts                 # seedProviders(conn, count)
      seed-regex.ts                     # seedRegex(conn, groupCount, rulesPerGroup)
      seed-workplace.ts                 # seedWorkplace(conn, scopeKey, count)
      seed-kkv.ts                       # seedKkv / seedSessionKkv
      index.ts                          # 聚合导出
    file-backed-fixture.ts              # openFileBackedNovelMasterTestConnection()
    audit-suite.ts                      # runSqlCrAuditSuite({ createContext }) 注册器
    findings-verification.test.ts       # 实证 findings.md 的 6 条发现
    performance-baseline.test.ts        # 各表大数据量性能基线
    report.ts                           # SqlReport：聚合 + console 表格 + JSON dump
    report.test.ts                      # 报告聚合的单元测试

packages/core/package.json              # 新增 test:sql-cr 脚本（改 test 的 glob）
```

## 变更点清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `packages/core/test/sql-cr-audit/instrumented-connection.ts` | 新增 | 装饰器 + recorder |
| `packages/core/test/sql-cr-audit/instrumented-connection.test.ts` | 新增 | 装饰器单元测试 |
| `packages/core/test/sql-cr-audit/seeders/*.ts` | 新增 | 7 个表组 seeder |
| `packages/core/test/sql-cr-audit/file-backed-fixture.ts` | 新增 | 文件库 fixture |
| `packages/core/test/sql-cr-audit/audit-suite.ts` | 新增 | 注册器，仿 `tdbc-conformance/src/suite.ts` |
| `packages/core/test/sql-cr-audit/findings-verification.test.ts` | 新增 | 实证 6 条发现 |
| `packages/core/test/sql-cr-audit/performance-baseline.test.ts` | 新增 | 大数据量基线 |
| `packages/core/test/sql-cr-audit/report.ts` | 新增 | 报告聚合 |
| `packages/core/test/sql-cr-audit/report.test.ts` | 新增 | 报告单元测试 |
| `packages/core/package.json` | 改 | 新增 `test:sql-cr`，改 `test` 的 glob 排除 `sql-cr-audit/` |

**不动**：`TdbcConnection` 接口、`BetterSqlite3Connection`、所有 repository、所有 service、`openNovelMasterTestConnection`、`novel-master-fixture.ts`。

## 详细实现步骤

### Step 1 — phase-instrumentation — blocking: yes — qa: auto

**写 `InstrumentedTdbcConnection` 装饰器。**

- 新增 `test/sql-cr-audit/instrumented-connection.ts`。
- `SqlRecorder` 类：内部 `Map<string, SqlStat>`，key 是归一化 SQL，value 是 `{ count, totalMs, maxMs, durations: number[], txIds: Set<number>, failures: number }`。
- `InstrumentedTdbcConnection implements TdbcConnection`：构造器吃 `inner: TdbcConnection`、`recorder: SqlRecorder`、可选 `txId?: number`。
  - `execute(sql, params?)`：`const start = performance.now(); try { return await this.inner.execute(sql, params); } finally { this.recorder.record(sql, performance.now() - start, this.txId); }`
  - `query` / `batch` 同理。`batch` 额外记 `paramsList.length`。
  - `transaction(fn)`：**关键**——`const txId = nextTxId(); return this.inner.transaction((tx) => fn(new InstrumentedTdbcConnection(tx, this.recorder, txId)));`
  - `close()`：直接转发，不记 recorder（close 不是业务 SQL）。
- 采集层不做 SQL 归一化折叠（留到报告层）。

### Step 2 — phase-instrumentation — blocking: yes — qa: auto

**写装饰器单元测试，重点验证 transaction 内的 tx 也被拦截。**

- 新增 `test/sql-cr-audit/instrumented-connection.test.ts`。
- 测试用例：
  - 装饰外层 conn，跑 `execute/query/batch`，recorder 有记录。
  - 装饰 conn，跑 `transaction(async (tx) => { await tx.execute(...); })`，recorder 记到事务内的 SQL（**这是发现 2 能被抓到的关键验证**）。
  - transaction 嵌套调 transaction，正确 reject `NESTED_TRANSACTION`（语义和 `TransactionalConnection` 一致）。
  - SQL 抛错时 recorder 也记到 duration 和 `failures++`（`try/finally` 保证）。
  - batch 的 `paramsList.length` 被正确记到 stat。

### Step 3 — phase-report — blocking: yes — qa: auto

**写 `SqlReport` 聚合 + 输出。**

- 新增 `test/sql-cr-audit/report.ts`。
- `SqlReport` 类：
  - `fromRecorder(recorder): SqlReport`。
  - `normalizeKey(sql)`：把 `IN (?,?,...,?)` 折叠成 `IN (?)`，`VALUES(?,?,...)` 折叠成 `VALUES(?)`，用正则。
  - `toConsoleTable()`：按 `count` 降序输出 top-N，列含 `normalizedSql / count / totalMs / maxMs / p95 / txCount`。
  - `toJson()`：dump 全量 stat 到 JSON（供 CI 消费或对比基线）。
  - `findAnomal(thresholds)`：挑出"count > 阈值"（N+1 嫌疑）和"p95 > 阈值"（慢查询嫌疑）两类。

### Step 4 — phase-report — blocking: yes — qa: auto

**写报告单元测试。**

- 新增 `test/sql-cr-audit/report.test.ts`。
- 造几个 mock stat，验证归一化折叠正确、top-N 排序正确、anomaly 挑选正确。

### Step 5 — phase-seeders — blocking: yes — qa: auto

**写 7 组 seeder，全部用 `conn.batch` 批量灌数据。**

- `seeders/seed-messages.ts`：`seedMessages(conn, sessionId, count, opts?)`。造 `count` 条 `ChatMessage`，seq 从 1 递增，content 用 `textBlocks("msg-N")`。用 `conn.batch(INSERT_SQL, messages.map(toParams))` 一次灌完。
- `seeders/seed-vfs-tree.ts`：`seedVfsTree(vfs, { depth, breadth })`。走 service 的 `vfs.write`（VFS 三表联动，直接捅 repo 要手动维护 blob ref_count 太复杂）。
- `seeders/seed-checkpoints.ts`：`seedCheckpoints(ctx, sessionId, count)`。先 seed VFS 文件，再循环 `ctx.messageCheckpoint.capture`（每个 capture 一次事务，测真实路径）。
- `seeders/seed-providers.ts`：`seedProviders(conn, count)`。直接 `new SqliteProviderRepository(conn).insert(...)` 批量造 provider + saved_model。
- `seeders/seed-regex.ts`：`seedRegex(conn, groupCount, rulesPerGroup)`。
- `seeders/seed-workplace.ts`：`seedWorkplace(conn, scopeKey, count)`。
- `seeders/seed-kkv.ts`：`seedKkv` / `seedSessionKkv`。
- 每个文件带简单自检（造完查 count 对不对）。

### Step 6 — phase-fixture — blocking: yes — qa: auto

**写 `openInstrumentedNovelMasterTestConnection` + 文件库 fixture。**

- 在 `test/sql-cr-audit/` 下新增辅助函数（不修改 `test/helpers/novel-master.ts`）：
  - `openInstrumentedNovelMasterTestConnection(): Promise<{ ctx: NovelMasterTestContext; recorder: SqlRecorder; report: () => SqlReport }>`——调原 `openNovelMasterTestConnection` 的内部步骤，但在 `open` 返回后包一层 `InstrumentedTdbcConnection`，再 `bootstrapNovelMaster`。**注意**：bootstrap 的 DDL 也会被记，report 层要能过滤掉 DDL（`CREATE TABLE/INDEX`）。
  - `openFileBackedNovelMasterTestConnection(tmpPath?: string): Promise<...>`——用 `tdbc:sqlite:file:<os.tmpdir()>/nm-cr-${Date.now()}.db`，其余同上。`after` 钩子删临时文件。

### Step 7 — phase-suite — blocking: yes — qa: auto

**写 `runSqlCrAuditSuite` 注册器。**

- 新增 `test/sql-cr-audit/audit-suite.ts`，仿 `tdbc-conformance/src/suite.ts:31` 的 `runConformanceTests(options)` 模式。
- `runSqlCrAuditSuite({ createInstrumented })`：内部用 `describe("SQL CR audit", { timeout: 300_000 }, () => { ... })` 注册多组用例。
- 每组用例：seed 数据 → 跑操作序列 → `report()` → 断言 anomaly 为空（或断言已知热点在预期内）。

### Step 8 — phase-findings — blocking: yes — qa: auto

**写 `findings-verification.test.ts`，实证 `findings.md` 的 6 条发现。**

- **发现 1（foreign_keys CASCADE 不生效）**：插 provider + saved_model，`PRAGMA foreign_keys` 查默认值，删 provider，查 saved_model 还在 → 证实 CASCADE 不生效。再开 `PRAGMA foreign_keys = ON` 重跑，验证 CASCADE 生效。
- **发现 2（insertCheckpoint N+1）**：seed 1000 VFS 文件，`capture`，检查 report 里 `INSERT INTO message_checkpoint_file` 的 count 是不是 ≈ 1000（N+1 确认）。
- **发现 3（searchMessages LIKE 全表扫）**：**用文件库 fixture**，seed 10000 消息，跑 `searchMessages`，对比"有 keyword"vs"无 keyword"的 query 耗时，断言 LIKE 版显著慢。
- **发现 4（seed-builtin-providers N+1）**：bootstrap 后检查 report，`INSERT INTO llm_provider` 的 count 等于内置 provider 数（个位数，确认模式但低影响）。
- **发现 5（workplace.copyScope N+1）**：seed workplace 规则，`copyScope`，检查 report 里 upsert 的 count 是不是 = 规则数 × 2。
- **发现 6（WAL 未开）**：`PRAGMA journal_mode` 查默认值，记录为 `delete`。

### Step 9 — phase-baseline — blocking: no — qa: auto

**写 `performance-baseline.test.ts`，建立各表大数据量基线。**

- 各表 seed 到 1 万 / 10 万，跑典型 CRUD（list/page/search/insert/update/delete），记录 P95。
- 暂不设硬阈值（先跑出基线数据，后续迭代再定）；用 `console.log` 输出 + JSON dump 供对比。
- `describe({ timeout: 600_000 })` 放宽超时。

### Step 10 — phase-wiring — blocking: yes — qa: auto

**挂脚本。**

- `packages/core/package.json`：
  - `"test:sql-cr": "npm run test:fast -- test/sql-cr-audit/**/*.test.ts"`
  - `test` 脚本的 glob 从 `test/**/!(performance).test.ts` 改成排除 `sql-cr-audit/`（具体写法视 glob 支持，可能要 `--test "test/**/*.test.ts" --test-ignore "test/**/performance.test.ts" --test-ignore "test/sql-cr-audit/**/*.test.ts"`，需实测 node:test 的 ignore 机制；或简单做法：harness 文件命名带 `sql-cr-` 前缀，glob 用 `!(performance|sql-cr-*)`）。

## 测试策略

### 测试用例

- **T-I1** — blocking: yes — 装饰器拦截外层 execute/query/batch，recorder 有记录（→ Step 1, 2）
- **T-I2** — blocking: yes — 装饰器拦截 transaction 内的 tx.execute，事务内 SQL 被记到（→ Step 2，**发现 2 的前置**）
- **T-I3** — blocking: yes — SQL 抛错时 recorder 记到 duration 和 failures（→ Step 2）
- **T-I4** — blocking: yes — 嵌套 transaction 正确 reject NESTED_TRANSACTION（→ Step 2）
- **T-R1** — blocking: yes — report 归一化折叠 `IN (?,?,?)` → `IN (?)`（→ Step 3, 4）
- **T-R2** — blocking: yes — report top-N 排序 + anomaly 挑选（→ Step 3, 4）
- **T-S1** — blocking: yes — 每个 seeder 造完数据后 count 正确（→ Step 5）
- **T-F1** — blocking: yes — findings 发现 1：CASCADE 默认不生效，开 pragma 后生效（→ Step 8）
- **T-F2** — blocking: yes — findings 发现 2：insertCheckpoint 的 N+1，report 里 count ≈ 文件数（→ Step 8）
- **T-F3** — blocking: yes — findings 发现 3：LIKE 全表扫在文件库下显著慢（→ Step 8，**需文件库**）
- **T-F4** — blocking: yes — findings 发现 4：seed-builtin-providers 的逐条 INSERT（→ Step 8）
- **T-F5** — blocking: yes — findings 发现 5：workplace.copyScope 的逐条 upsert（→ Step 8）
- **T-F6** — blocking: yes — findings 发现 6：journal_mode 默认 delete（→ Step 8）
- **T-B1** — blocking: no — 各表 1 万 / 10 万级性能基线数据采集（→ Step 9）

### 验收矩阵

| Step | 测试用例 |
|---|---|
| 1, 2 | T-I1, T-I2, T-I3, T-I4 |
| 3, 4 | T-R1, T-R2 |
| 5 | T-S1 |
| 8 | T-F1 ~ T-F6 |
| 9 | T-B1 |

## 风险与回滚方案

### 风险

1. **transaction 装饰漏洞**（最高风险）：如果 `InstrumentedTdbcConnection.transaction` 没把 `tx` 也包一层，发现 2 的 N+1 抓不到。**已确认 `capture` 开事务**（`message-checkpoint.service.ts:36`），N+1 在事务内。Step 2 的 T-I2 是这个的硬门禁。

2. **`:memory:` 测不出磁盘 IO**：LIKE 全表扫在内存里可能很快。决策 4 用文件库 fixture 解决，Step 6 实现。但文件库的临时文件清理（`after` 钩子）要注意，别留垃圾。

3. **10 万条 seeder 耗时**：即使 `conn.batch`，10 万级数据 + 多组测试可能跑几分钟。`describe({ timeout: 600_000 })` 放宽超时；如果还是太慢，`performance-baseline.test.ts`（Step 9）标 `blocking: no`，不挡主线。

4. **node:test 并发噪声**：node:test 按文件并发，性能测试和别的文件并行跑会抢 CPU，测量噪声大。如果数据不稳定，考虑给 `test:sql-cr` 加 `--test-concurrency=1`（需实测 node:test 是否支持）。

5. **glob 排除机制不确定**：node:test 的 `--test` + glob + ignore 的确切行为需实测。如果 `!(performance|sql-cr-*)` 不生效，退路是把 harness 文件放独立目录，靠目录路径排除。

### 回滚

- 全部新增文件在 `test/sql-cr-audit/`，删目录即回滚。
- `package.json` 改动只有两行脚本，git revert 即回滚。
- **零改动生产代码**，无生产回归风险。

## 仍未弄清（从探索报告继承）

- node:test 的并发/串行控制（`--test-concurrency`、`concurrency` 选项）——影响性能测量稳定性，Step 9 落地时实测。
- glob 排除的确切写法——Step 10 实测。
- `vfs-entry-id-redesign-v1` migration 在 `:memory:` 新库上是否建了 blob ref_count 触发器——影响 seeder 走 repo 批量接口时 blob 计数一致性。Step 5 的 VFS seeder 走 service（`vfs.write`）规避了这个问题，但如果发现 service 路径太慢要改 repo，得先确认触发器。

## Context Bundle

```yaml
iteration_name: sql-cr-audit-2026-08
requirement_path: docs/Iterations/sql-cr-audit-2026-08/findings.md
spec_path: docs/Iterations/sql-cr-audit-2026-08/spec.md
explore_summary: >
  TdbcConnection 5 方法全部拦截面，transaction 回调里的 tx 必须也包一层（capture 开事务，N+1 在事务内）。
  归一化 SQL 用 ? 占位最终 SQL，报告阶段二次折叠。:memory: 测不出磁盘 IO，LIKE 测试用文件库。
  seeder 走 repo 层用 conn.batch，无 batch 先例（现有最大 4000 条逐条）。ctx 缺 provider/regex/workplace/kkv service。
impact_files:
  - packages/core/test/sql-cr-audit/ (新增整目录)
  - packages/core/package.json (脚本)
constraints:
  - 零改动生产代码（装饰器放 test/helpers）
  - transaction 的 tx 必须也 instrument
  - LIKE/磁盘测试用文件库
  - harness 文件排除出默认 test
blocking_steps: [1, 2, 3, 4, 5, 6, 7, 8, 10]
```
