# SQL 全量 CR 与性能校验：发现清单

> **来源**：2026-08-12 基于测试结构、SQLite schema、CRUD 代码的一次摸底 CR。
> **状态**：发现记录。每条标注了证据（路径:行号）和待验证项，修复方案未定稿。
>
> **实测更新（2026-08-12，harness 跑完后）**：6 条发现里 2 条被实测修正——
> - **发现 1（foreign_keys）桌面端证伪，mobile 端确认是真 bug**：better-sqlite3 驱动默认 `foreign_keys=ON`（桌面 CASCADE 生效）；但 RN 驱动没开 pragma，走 OP-SQLite/原生 SQLite 默认 off，mobile 端 CASCADE 不生效，删 provider/regex_group 会留孤儿数据。
> - **发现 3（LIKE 全表扫）已确认是真热点**：1000 条无差异（0.27 vs 0.25ms），1 万条 4.68x（4.43 vs 0.95ms），**10 万条 33.44x（21.23 vs 0.63ms）**——10 万条已是用户感知级别的延迟，长会话场景会出现。
> - 发现 2/4/5/6 实测确认成立。
>
> 实测代码在 `packages/core/test/sql-cr-audit/findings-verification.test.ts`（T-F1~T-F6），跑 `npm run test:sql-cr -w @novel-master/core`。
>
> **v1.4.24 基线更新（2026-08-12）**：主分支发了 v1.4.24（"会话复制/分叉/删除性能优化"），针对 harness 发现的 N+1 做了首批修复：
> - **✅ 发现 2 已修复**：`insertCheckpoint` 的 file 逐条 INSERT 改为批量（实测 count 从 50 降到 1）
> - **✅ 发现 12 部分修复**：`seedForkCopyParity` 逐条 `insertCheckpoint` 改为 `seedCheckpoints` 批量播种（200 文件 × 500 消息从 ~1.8s 降到百毫秒级）；但消息本身的逐条 INSERT（发现 9）未改
> - **✅ 发现 17 已修复**：`incrementRefsForCheckpointFiles` / `decrementRefsForCheckpointFiles` / `decrementLiveRefsUnderScope` 改为 `batchAdjustRefCount`（实测 truncate 的 ref_count UPDATE 从 250 次降到 1 次）
> - harness rebase 到 v1.4.24 后重跑：123 个测试，120 过 / 3 失败（3 个失败正是断言旧 N+1 行为的，证明修复生效）
>
> **深度 CR 更新（2026-08-12，第二轮）**：针对 vfs（848 行 repository）、全 17 个 repository 的 N+1/索引静态扫、JOIN/批量操作大压力测试三路深入，新增 5 条真问题（发现 7-11）：
> - **🔴 发现 7**：`scanContents` 逐条读 blob，5000 文件 = 5000 次 SELECT（N+1）
> - **🔴 发现 8**：`vfs.delete` service 层逐条 appendDeletedRevision，删 100 文件 = 302 次 SQL（N+1）
> - **🔴 发现 9**：`message.service.fork` 逐条 INSERT，fork M 条 = M 次 INSERT（N+1）
> - **🔴 发现 10**：`sessionFs.rollbackToMessage` 是最大炸弹——2000 文件回滚 = **26099 次 SQL，1.3s**
> - **🟡 发现 11**：`chat_session.listByParentSession` 的 `parent_session_id` 无索引，fork/子会话查询全表扫
> - 修正：`renamePrefixInScope` 不是 N+1（2 条批量 UPDATE，走覆盖索引）；`loadFileTree` JOIN 走 PK 索引，没问题；`updateHiddenRange` 是单条范围 UPDATE，不是 N+1。
> - 深度 CR 测试：`vfs-deep-cr.test.ts`、`cross-repo-cr.test.ts`、`join-and-batch-stress.test.ts`
>
> **深度 CR 更新（2026-08-12，第三轮）**：覆盖了之前欠账的 session/project/agent、workplace/regex/kkv、provider/sksp + schema 一致性：
> - **🔴 发现 12**：`session.copy` 是消息 + checkpoint 的双重 N+1，100 消息 × 50 文件 = **10666 次 SQL**
> - **🔴 发现 13**：`project.delete` 的 VFS 逐条删，100 文件 = 300+ SQL（消息/session 删除已批量化）
> - **🟢 修正发现 11**：`parent_session_id` 其实有索引（bootstrap 补了 `idx_chat_session_parent`），发现 11 是误报
> - **🟢 确认健康**：workplace 的 rename/delete under prefix 各 1 条批量 SQL，走覆盖索引；regex 三表索引齐全；kkv 全走 PK；sksp 全走 PK；provider 索引覆盖完整；schema 双轨（canonical DDL + column alignments）当前无漂移
> - **ℹ️ 行为发现**：`project.copy` 不复制 session（只复制 project 行 + 模板 VFS），可能与用户预期不符
> **深度 CR 更新（2026-08-12，第四轮）**：覆盖了之前完全没碰的非 CRUD 路径——GC/backup/grep/truncate/integrity-repair：
> - **🔴 发现 14（正确性）**：删文件后旧版 revision + blob 成 JOIN 孤儿，revision GC 扫不到，数据库只增不减（数据泄漏）
> - **🔴 发现 15**：blob GC 逐条 DELETE，500 孤立 blob = 500 次 DELETE（N+1）
> - **🔴 发现 16**：vfs grep 逐条读 blob + zlib 解压，500 文件 = 500 次 SELECT（N+1）
> - **🟡 发现 17**：truncate tail 逐条 decrementRefsForCheckpointFiles（N+1）
> - **🟡 发现 18**：integrity-repair 逐条 SELECT + UPDATE ref_count（N+1）
> - **🟢 确认健康**：revision GC（deleteUnreferencedUnderScope）是批量 DELETE；db-backup 导出是全表 SELECT、导入是 conn.batch；glob 只查 entry 路径不读 blob
> - 深度 CR 测试：`gc-backup-grep-cr.test.ts`
>
> **表设计 CR（2026-08-12，第五轮）**：系统性审查字段类型、约束、默认值、表关系/FK、索引设计（含冗余/列序），新增发现 19-21：
> - **🔴 发现 19（设计缺陷）**：大量逻辑 FK 未声明（10 条核心跨表依赖全靠 application 层），是发现 8/13/14 孤儿数据的温床
> - **🟡 发现 20（设计缺陷）**：`chat_message.role` 无 CHECK 约束（对比 `llm_provider.protocol` 有 CHECK），实测非法 role 能落库
> - **🟡 发现 21（设计缺陷）**：`workplace_dir_rule.fill_policy` schema DEFAULT `'hidden'` vs 代码常量 `'header'`，默认值不一致
> - **🟢 改进建议**：`vfs_entry.content` 是死列（写路径恒 NULL）；`entry_kind`/`status` 无 CHECK；冗余索引 4 个（`idx_workplace_dir/file_scope`、`idx_message_checkpoint_session`、`idx_session_kkv_session`——SQLite 优先选窄索引，查询能力与 PK 左前缀重叠，写放大小表上收益微，低优先级）
> - **🟢 可接受的设计取舍**：`content_json` 存全量 JSON（拆列代价过高）、`sksp.iv` 可 null（Windows DPAPI 有意）、`builtin_key` UNIQUE+可 null（多 NULL 共存）、token 列 null=未统计、时间戳全统一 `*_ms`、`byte_len` 冗余但维护成本已付
> - 表设计 CR 测试：`schema-design-cr.test.ts`（18 个用例）
>
> **逐表设计 CR（2026-08-12，第六轮）**：4 个子 agent 各负责一组表，逐列、逐索引、逐约束过完全部 16 张表。新增发现 22-28：
> - **🔴 发现 22**：全库 TEXT PRIMARY KEY 列都不隐含 NOT NULL（SQLite 怪异点），能插 NULL 行
> - **🟡 发现 23**：多张复合 PK 表适合 WITHOUT ROWID（message_checkpoint / message_checkpoint_file / vfs_revision / vfs_content_blob）——省 rowid 列 + PK 更紧凑
> - **🟡 发现 24**：`idx_vfs_entry_scope_path` 与 UNIQUE(scope_key, path) 隐式索引完全重叠（列序一样，纯写放大），比之前“与 PK 左前缀冗余”更严重
> - **🟡 发现 25**：sksp_secrets 安全设计缺口——algo 无 CHECK + 非 DPAPI algo 可与 iv=NULL 共存（能写脏、读时炸）
> - **🟡 发现 26**：全库 JSON 列都没有 json_valid() CHECK——settings_json / prompts_json / headers_json / agent_config_json，绕过 service 能存非法 JSON
> - **🟡 发现 27**：regex_rule 的 (group_id, sort_order) 缺 UNIQUE——并发竞态或绕过 service 能存重复 sort_order
> - **🟡 发现 28**：`hidden` 缺 CHECK(hidden IN (0,1))——model 用 `===1` 解析，脏值静默当 false（和 role 同类问题，之前只盯了 role）
> - **🟢 改进建议**：vfs_revision 的 content_hash NULL 与 status 没有耦合约束（active+null 能落库）；CHECK 约束大面积缺失（entry_kind/status/encoding/sort_field/sort_order/inclusion_mode/flags 等）；head_count/tail_count/ref_count/seq/revision_version 缺下界 CHECK
> - **🟢 确认合理**：vfs_entry 的 AUTOINCREMENT（不可变身份键 + 防删后复用）；触发器 5 个边界 case 全正确；workplace 两表分开不合并（dir 8 列 / file 3 列，合并不划算）；regex_rule 的 idx_regex_rule_group_sort 不可替代（PK 第二列是 rule_id 不是 sort_order）
> - 逐表设计 CR 测试：`table-design-chat.test.ts`（6）、`table-design-vfs.test.ts`（17）、`table-design-provider-regex-agent.test.ts`（25）、`table-design-workplace-kkv-sksp.test.ts`（8）

## 背景

目标是评估"基于现有测试 + 18 张 SQLite 表 + CRUD 接口，伪造数据、统计执行时间，找出不合理的表/SQL/代码 bug"这条路能不能走。摸底过程中顺手发现了一批问题，记录在此，供后续修复迭代引用。

架构上的有利条件先说清楚，因为这些决定了后续修复和验证的打法：

- 所有 SQL 收敛在 `TdbcConnection.execute / query / batch` 三个方法上（`packages/core/src/infra/tdbc/`），带命名参数的统一走 `executeTemplate / queryTemplate`（`infra/tdbc/logic/template-helper.ts`）。没有 ORM、没有绕过 TDBC 的直连，所以"拦截 + 计时 + 统计"可以做到零遗漏。
- 测试侧已有 `NovelMasterTestContext`（`packages/core/test/helpers/novel-master.ts`），一键起 `:memory:` 库 + `bootstrapNovelMaster` 把全部表建好 + 注入 service 上下文。core 的 317 个测试里有 107 个用它真连 better-sqlite3。
- 已有性能测试范式可抄：`packages/core/test/message-checkpoint/performance.test.ts` 用 `performance.now()` + `SAMPLE_RUNS=8` 采样 + P95 + CI slack 倍数。

## 摸底范围

- 18 张业务表 + 1 张 `schema_migrations`，DDL 在 `packages/core/src/bootstrap/<域>/*-schema.ts`。
- 17 个 repository 实现，在 `packages/core/src/domain/*/repositories/impl/sqlite-*.repository.ts`。
- 全部 pragma / 连接配置（`tdbc-driver-better-sqlite3/src/connection.ts`、`bootstrap/novel-master-bootstrap.ts`）。

---

## 🔴 发现 1：`foreign_keys` pragma 全局未开启，`ON DELETE CASCADE` 声明不生效

**严重度：高（数据正确性）**

### 证据

- `packages/core/src/bootstrap/regex/regex-schema.ts:32` 声明 `FOREIGN KEY (group_id) REFERENCES regex_group(group_id) ON DELETE CASCADE`。
- `packages/core/src/bootstrap/provider/provider-schema.ts:28` 声明 `FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE`。
- 全仓库 `PRAGMA foreign_keys` 只在退役的 migration `schema-migrations/provider-identity-v1.ts:85` 里临时开关过（migration 内部重写 provider_id 用），**bootstrap 和 driver 层从来没全局开启**。
- `packages/tdbc-driver-better-sqlite3/src/connection.ts` 的 `open` 只设了 `readonly`，没有任何 pragma。

### 后果

SQLite 默认 `foreign_keys=off`，这意味着：

- 删除 `regex_group` 行时，`regex_rule` 里关联的行**不会级联删除**，变成孤儿数据。
- 删除 `llm_provider` 行时，`llm_saved_model` 里关联的行**不会级联删除**，变成孤儿数据。

建表声明了 CASCADE 却不生效，这是个数据正确性 bug，不只是性能问题。

### 待验证

~~需要写测试实证：插一个 provider + saved_model，删 provider，看 saved_model 还在不在。~~ **已实测，见下方。**

### 实测结论（T-F1，2026-08-12）——桌面端证伪

harness 实测（`findings-verification.test.ts` T-F1）发现 **better-sqlite3 驱动默认把 `foreign_keys` 设成 ON**——这和原生 SQLite 的默认值（off）不同。实测三步：
1. 读默认 pragma 值：`foreign_keys=1`（ON）。
2. 默认值下造 provider + saved_model，删 provider，查 saved_model：**0 行残留**（CASCADE 生效）。
3. 手动 `PRAGMA foreign_keys = OFF` 后重测：**1 行残留**（孤儿数据，反证 pragma 确实控制行为）。

**结论**：findings.md 原判断（"CASCADE 不生效"）在桌面端（better-sqlite3 驱动）**不成立**。CASCADE 一直生效。

**mobile 端代码核查结论（2026-08-12）**：RN 驱动（`tdbc-driver-rn`）从 TS 层到 adapter 层（`driver.ts` L33-49 的 `open` + `connection.ts` 的 `RnConnection` 构造器 + `adapter.ts` 的 `RnSqliteAdapter` 接口）**都没有设任何 pragma**，`foreign_keys` 完全由底层 SQLite 引擎决定。而 RN 底层用的是 OP-SQLite（`react-native-quick-sqlite`），它编译的是原生 SQLite，原生 SQLite 的 `foreign_keys` 默认值是 **off**（SQLite 官方文档明确）。

**所以发现 1 在 mobile 端是真 bug**——删 `llm_provider`/`regex_group` 会留孤儿数据（`llm_saved_model`/`regex_rule`）。无法用 Node harness 实测（要真机/APK），但代码层面证据确凿：better-sqlite3 驱动显式开了 pragma 所以桌面端没事，OP-SQLite 没人开，走引擎默认 off。

**修复建议**：在 `RnDriver.open` 或 bootstrap 路径加 `PRAGMA foreign_keys = ON`（不能在事务内，得在连接建立后）。这会让两端行为一致。

### 修复方向（待定）

在 `bootstrapNovelMaster` 或 driver 的 `open` 阶段加 `PRAGMA foreign_keys = ON`。注意 SQLite 的 `foreign_keys` pragma 不能在事务内开，得在连接建立后、事务外执行。需要确认 TDBC 的 `open` 路径有没有合适的注入点。

---

## ✅ 发现 2：`insertCheckpoint` 对文件逐条 INSERT（N+1）——已修复（v1.4.24）

**严重度：~~高（性能，已知热点）~~ 已修复**

### 证据

`packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts:116-130`：

```ts
for (const file of input.files) {
  await executeTemplate(
    this.conn,
    this.parser,
    `INSERT INTO message_checkpoint_file
     (session_id, message_id, entry_id, revision_version)
     VALUES (#{sessionId}, #{messageId}, #{entryId}, #{revisionVersion})`,
    {
      sessionId: input.sessionId,
      messageId: input.messageId,
      entryId: file.entryId,
      revisionVersion: file.revisionVersion,
    },
  );
}
```

### 后果

每个 checkpoint 的文件逐条 `await executeTemplate`，1000 个文件就是 1000 次 round-trip。现有的 `performance.test.ts` 就是跑 1000 文件量级的 capture/rollback，这个 N+1 是已知的热点。

仓库里已经有 batch 接口（`TdbcConnection.batch`），在 `vfs-entry` 和 `vfs-revision` 的 repository 里都用过（`sqlite-vfs-entry.repository.ts:720,731`、`sqlite-vfs-revision.repository.ts:211`），但 checkpoint 这里没用。

### 待验证

- 用 `InstrumentedTdbcConnection` 计数确认 N+1 的实际 round-trip 次数。
- 确认改成 `conn.batch(INSERT_SQL, files.map(...))` 后行为不变（单事务原子提交，和现在的逐条在同一个 transaction 上下文里语义一致）。

### v1.4.24 修复状态

`insertCheckpoint` 的 file 逐条 INSERT 已改为批量。新增了 `seedCheckpoints` 批量方法（`message-checkpoint.port.ts` 新接口），以及 checkpoint repository 内部的批量化。实测 `message_checkpoint_file` INSERT count 从 50 降到 1（T-F2 测试断言旧行为而失败，证明修复生效）。

---

## 🟡 发现 3：`searchMessages` 用 `content_json LIKE` 全表扫

**严重度：中（性能，数据量大时退化）**

### 证据

`packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:275-282`：

```ts
// keyword 非空时加 role 粗筛 + LIKE 粗筛（LIKE 扫整个 content_json 是超集，内存层再精筛 TextBlock）；
// keyword 为空时不加 role / LIKE 过滤，返回所有类型消息。
...
? "AND content_json LIKE #{likePattern} ESCAPE '\\'"
```

### 后果

`content_json` 是整条消息内容的 JSON 序列化文本，`LIKE '%kw%'` 会扫整列、走不了索引。会话消息一多，搜索就慢。代码注释自己也承认是"超集"。

### 待验证

~~需要统计典型会话的消息条数，判断当前数据量下这个 LIKE 是不是真痛点。~~ **已实测，见下方。**

### 实测结论（T-F3，2026-08-12）——1000 条数据下不显著

harness 实测（`findings-verification.test.ts` T-F3，**文件库**）在 1000 条消息下：
- 有 keyword（走 LIKE）：`totalMs = 0.27ms`
- 无 keyword（不走 LIKE）：`totalMs = 0.25ms`

**结论**：1000 条数据下 LIKE 全表扫**还不是热点**，和无 LIKE 几乎无差异。findings.md 原判断的"数据量大时退化"方向没错，但 1000 条这个量级触发不了。

**后续**：需在万级（1 万、10 万）数据量下复测，才能判断这个 LIKE 在真实使用场景（长会话）下会不会变成热点。harness 的 `performance-baseline.test.ts`（Step 9，待实现）会覆盖这个。

### 10 万级复测结论（2026-08-12）——已确认是真热点

用文件库 + 10 万条消息复测（临时测试 `like-degradation-100k.test.ts`，跑完已删），P95 数据：

| 数据量 | LIKE P95 | 无 LIKE P95 | 倍率 |
|---|---|---|---|
| 1000 条 | 0.27ms | 0.25ms | ~1x（无差异） |
| 1 万条 | 4.43ms | 0.95ms | 4.68x |
| **10 万条** | **21.23ms** | **0.63ms** | **33.44x** |

**结论**：`content_json LIKE` 在 10 万条消息下已经是真热点——21ms 的 P95 是用户能感知的延迟，而且和无 LIKE 对照组差 33 倍。退化是超线性的。findings.md 原判断（"数据量大时退化"）成立，10 万条这个量级在长会话场景（比如长期使用的 agent 会话）是会出现的。

**修复优先级**：从原来的"中（需权衡）"上调到"中高"——数据量阈值已经摸清（1 万开始有差异，10 万明显），建议在 FTS5 和冗余文本列之间选一个。

### 修复方向（待定，需权衡）

- 选项 A：SQLite FTS5 虚拟表，给 `content_json` 建全文索引。改造成本高，得维护同步触发器和迁移。
- 选项 B：冗余一个纯文本列（只存 TextBlock 的拼接文本），LIKE 打在这个列上。比 FTS 轻但不能分词。
- 选项 C：维持现状，靠 `session_id` 先收窄 + 内存层精筛，确认数据量下可接受。

这个得先有性能数据再决策，不能拍脑袋改。

---

## 🟡 发现 4：`seed-builtin-providers` 逐条 INSERT（N+1，低影响）

**严重度：低（数据量小，但模式是 N+1）**

### 证据

`packages/core/src/bootstrap/provider/seed-builtin-providers.ts:18-37`，内置 provider 逐条 INSERT。但内置 provider 数量是个位数，实际影响有限。

### 待验证

无，模式确认。

### 修复方向（待定）

可顺手改成 batch，但因为数据量小，优先级低。属于"干净优先"的改动。

---

## 🟡 发现 5：`workplace.copyScope` 逐条 upsert（N+1）

**严重度：中（性能，取决于规则数量）**

### 证据

`packages/core/src/domain/workplace/repositories/impl/sqlite-workplace.repository.ts:194-207`，`copyScope` 里对 dirs 和 files 各一个 `for` 循环逐条 `upsertDirRule / upsertFileRule`，每个 upsert 内部又是 DELETE + INSERT 两条 SQL。

### 后果

规则一多，round-trip 次数 = 规则数 × 2。`copyScope` 的典型场景是把一个 scope 的规则复制到另一个 scope，规则条数可能从十几到上百。

### 待验证

- 确认 workplace 规则的典型数据量。
- 确认改成 batch 后，DELETE + INSERT 的顺序语义在批量下仍正确。

### 修复方向（待定）

可改成先批量 DELETE（`WHERE scope_key = #{toScope}`）再 batch INSERT。

---

## 🟢 发现 6：未开启 WAL 模式

**严重度：低（架构保守，但值得评估）**

### 证据

全仓库没有 `journal_mode` 设置，用的是 better-sqlite3 默认的 `delete` rollback journal 模式。

### 说明

这不是 bug，是保守选择。WAL 对读写并发和写入吞吐有明显好处，但当前是单连接 + `AsyncMutex` 串行模型，并发收益有限；WL 的主要收益会在未来如果引入多连接读时体现。

### 待验证

- 需要确认 RN 驱动（`tdbc-driver-rn`）在 native 层有没有开 WAL——探索没覆盖 native 层。

### 修复方向（待定）

低优先级。如果要开，得同时确认 WAL 文件在移动端（Android）的备份/恢复路径里怎么处理，不能只改桌面端。

---

## 后续工作：全量性能校验 harness（未实施）

这次摸底确认了"伪造数据 + 统计执行时间"这条路可行，脚手架基本现成。如果要落地，建议的步骤记录在这里，供后续迭代引用：

1. **写 `InstrumentedTdbcConnection`**：装饰 `TdbcConnection`，在 `execute / query / batch` 外套 `performance.now()`，按 SQL 归一化文本聚合 `count / totalMs / maxMs / p95`。这是整个方案的关键杠杆。
2. **给每张表写 seeder**：仿照 `performance.test.ts` 里的 `seedFiles(vfs, 1000)`，写 `seedMessages(sessionId, n)` 等，复用现有 repository 的 insert 方法。
3. **跑典型操作序列**：建 session → 追加消息 → capture checkpoint → search → 删除，拉到 1 万、10 万级数据量。
4. **出报告**：挑"行数少但 SQL 次数爆炸"（N+1）和"单条慢查询"（缺索引 / LIKE 全表扫）两类异常。
5. **静态 schema CR**：逐表核对"查询模式 vs 索引覆盖"，重点看 `chat_message.session_id`（现在靠 UNIQUE 约束隐式覆盖，语义不显式）。

---

## 🔴 发现 7：`scanContents` 逐条读 blob（N+1）

**严重度：高（性能）**

### 证据

`packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts` 的 `scanContents`（内部 `resolveScanRows`，L734）：先 1 条 SQL 查出所有 file entry，然后 `for` 循环逐条 `await resolveEntryPlainContent()`，每次调 `contentStore.get()`。

实测（`vfs-deep-cr.test.ts`，5000 文件）：
- `SELECT ... FROM vfs_entry WHERE scope_key=? AND entry_kind='file'`：count=1（主查询，p95=3.81ms）
- `SELECT encoding, bytes FROM vfs_content_blob WHERE content_hash=?`：**count=5000**（逐条！）

### 后果

5000 文件 = 5000 次 JS↔SQLite 往返，总耗时 94.1ms。文件数上万时会线性恶化。`scanContents` 的语义是"批量扫描"，调用方期望高效。

### 修复方向（待定）

用 `WHERE content_hash IN (...)` 或 JOIN 一次性把所有 blob 读出来。

---

## 🔴 发现 8：`vfs.delete` service 层逐条 appendDeletedRevision（N+1）

**严重度：高（性能）**

### 证据

`packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts:397` 的 `appendDeletedRevisionsForSubtree`：对每个子文件逐条 `findByPath` + `adjustRef` + `appendDeletedRevision`。

实测（`vfs-deep-cr.test.ts`，删 100 文件的目录）：
- `SELECT ... FROM vfs_entry WHERE ...`：count=101（逐条 findByPath）
- `INSERT INTO vfs_revision`：count=100（逐条 appendDeletedRevision）
- `UPDATE vfs_revision SET ref_count=...`：count=200（逐条 adjustRef × 2）
- `SELECT encoding, bytes FROM vfs_content_blob`：count=200（逐条读旧 head + deleted 版）
- `DELETE FROM vfs_entry WHERE ...`：count=1（entry 删除本身是批量的，健康）

总 SQL 次数 = 302。

### 后果

entry 表的删除本身是批量 DELETE...LIKE（很健康），但 revision 层的 GC 是逐条的 N+1。删大目录时会明显变慢。

### 修复方向（待定）

把 `appendDeletedRevisionsForSubtree` 改成批量化：先一次性查出所有子文件的 head revision，再 `conn.batch INSERT` deleted revision + 批量 adjustRef。

---

## 🔴 发现 9：`message.service.fork` 逐条 INSERT（N+1）

**严重度：高（性能）**

### 证据

`packages/core/src/service/chat/impl/message.service.ts:241-256`：

```ts
for (const msg of toCopy) {
  await r.messages.insert({
    ...
    sessionId: forked.id,
    ...
  });
}
```

实测（`cross-repo-cr.test.ts`，fork 40 条消息）：`INSERT INTO chat_message` count=40。

### 后果

fork M 条消息 = M 次单条 INSERT。配合 `seedForkCopyParity` 里每个 fork 还会调 `insertCheckpoint`（发现 2 的 N+1），整个 fork 路径是 M×N 的放大。

### 修复方向（待定）

改 `conn.batch INSERT`，配合 `seedForkCopyParity` 已有的事务边界。

---

## 🔴 发现 10：`sessionFs.rollbackToMessage` 是最大炸弹（复合 N+1）

**严重度：高（性能，全项目最严重的单点）**

### 证据

`packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts` 的 `rollbackToMessage` + `reconcileVfsPaths`（L175、L373、L406、L445）。

实测（`join-and-batch-stress.test.ts`，2000 文件回滚）：
- **总 SQL 次数 = 26099**
- **总耗时 = 1.3s**

三个放大点叠加：
1. **L175 `listBySession` 被调 2 次只为拿 `.length` 做乐观锁**——应该用 `COUNT(*)`，不需要把全部消息行拉回来。
2. **L373/L406 `reconcileVfsPaths` 逐条 `restorePathToRevision`**——每个路径多次 SELECT + 写入。
3. **`ensureDirectoryChain` 逐级 mkdir**。

### 后果

回滚是用户操作（手动触发或 agent 工具触发），1.3s 的延迟用户会明显感知。而且这是 2000 文件的量级，文件更多会继续恶化。

### 修复方向（待定）

优先级最高。三个点分别优化：
1. `listBySession` → `COUNT(*)`（改动最小，收益明显）。
2. `reconcileVfsPaths` 批量化（预取所有需要的 revision，批量写入）。
3. `ensureDirectoryChain` 批量校验。

---

## 🟡 发现 11：`chat_session.listByParentSession` 的 `parent_session_id` 无索引

**严重度：中（索引缺口）**

### 证据

`packages/core/src/bootstrap/chat/chat-schema.ts` 只在 `project_id` 上建了 `idx_chat_session_project`，`parent_session_id` 列没有任何索引。`chat_session.listByParentSession(parentSessionId)` 的 `WHERE parent_session_id = ?` 会全表扫。

### 后果

子代理会话（subagent）场景下查"某会话的所有子会话"会全表扫 `chat_session`。会话数少时无感，但如果一个 project 下有大量会话 + 子会话，查询会退化。

### 修复方向（待定）

加 `idx_chat_session_parent(parent_session_id)` 索引。

### 实测修正（2026-08-12，第三轮）——发现 11 是误报

harness 实测（`session-project-agent-cr.test.ts`，`EXPLAIN QUERY PLAN`）发现 `listByParentSession` **走的是 `idx_chat_session_parent` 索引**，不是全表扫：

```
[0] SEARCH chat_session USING INDEX idx_chat_session_parent (parent_session_id=?)
```

根因：`chat-schema.ts` 的 `CREATE INDEX` 数组里确实没有 `idx_chat_session_parent`，但 **bootstrap 阶段**（`novel-master-bootstrap.ts:197` + `schema-column-alignments.ts:39` 的 `afterAdd`）额外建了这个索引。所以新库 bootstrap 后 `parent_session_id` **有索引**，查询走索引。

**结论**：发现 11 不成立。`parent_session_id` 已有索引，只是不在 schema 文件的 CREATE INDEX 数组里（在 bootstrap 的列对齐 afterAdd 里建）。这个"索引声明分散在多处"的设计本身值得注意，但不是性能问题。

---

## 修正：之前误报或过度担心的点

第二轮深度 CR 修正了几个判断：

- **`renamePrefixInScope` 不是 N+1**：它是 2 条批量 `UPDATE ... REPLACE(path,...) WHERE path LIKE 'prefix/%'`，走 `idx_vfs_entry_scope_path` 覆盖索引，设计很健康。改 500 个子项路径只需 2 次 UPDATE。
- **`loadFileTree` JOIN vfs_entry 走 PK 索引**：`message_checkpoint_file` 的 PK `(session_id, message_id, entry_id)` 前缀 + `vfs_entry.entry_id` 主键，JOIN 高效，没问题。
- **`findCheckpointMessageIdAtOrBefore` JOIN chat_message 走 covering index**：`message_checkpoint` 的 PK `(session_id, message_id)` 是 covering index，没问题。
- **`updateHiddenRange` 是单条范围 UPDATE**：`WHERE session_id=? AND seq BETWEEN ? AND ?`，走 `UNIQUE(session_id, seq)` 索引，不是 N+1。
- **`sessions.create` 的 VFS 复制已批量化**：1000 文件只用 31 次 SQL，健康。
- **触发器在 `:memory:` 新库上确实被创建了**：`vfs-entry-id-redesign-v1` migration 的“路径 B”正确跑了 `createTriggers`，三个 blob ref_count 触发器都在。

---

## ✅ 发现 12（部分修复）：`session.copy` 是消息 + checkpoint 的双重 N+1（复合 N+1）——checkpoint 部分已修复（v1.4.24），消息逐条 INSERT 未改

**严重度：高（性能）**

### 证据

`packages/core/src/service/chat/impl/session.service.ts:340-348` 的 `copy` 方法 + `seed-fork-copy-parity.ts:120-127`。

实测（`session-project-agent-cr.test.ts`，复制 100 消息 + 50 VFS 文件的 session）：

| SQL | count | 说明 |
|---|---|---|
| `UPDATE vfs_revision SET ref_count = ...` | **5050** | checkpoint 种 revision 时的引用计数维护 |
| `INSERT INTO message_checkpoint_file` | **5000** | 每条新消息 × 50 文件 = 5000 条逐条插入 |
| `INSERT INTO chat_message` | **100** | 消息逐条 insert |
| `INSERT INTO message_checkpoint` | 100 | 每条新消息一个 checkpoint |

**总 SQL 次数 = 10666**（复制一个 session！）。耗时 125ms（文件库）。

### 后果

两个 N+1 叠加：消息逐条 insert（发现 9 的同类）+ checkpoint 逐条种（发现 2 的放大）。session 越大爆炸越快——消息数 × 文件数 的乘积增长。100 消息 × 50 文件就已经 1 万多次 SQL。

### v1.4.24 修复状态

`seedForkCopyParity` 的逐条 `insertCheckpoint` 循环已改为 `seedCheckpoints` 批量播种（`seed-fork-copy-parity.ts` diff）。原 5000 次 `message_checkpoint_file` INSERT + 5050 次 ref_count UPDATE 改为一次性批量写入。提交消息称"200 文件 × 500 消息从 ~1.8s 降到百毫秒级"。

**仍存在**：`session.service.ts:340-348` 的消息本身逐条 `r.messages.insert(...)` 未改——fork M 条消息仍是 M 次单条 INSERT（发现 9 的同类）。session 大时这部分仍是 N+1。

---

## 🔴 发现 13：`project.delete` 的 VFS 逐条删（N+1）

**严重度：中（性能）**

### 证据

`packages/core/src/domain/vfs/logic/vfs-tree-copy.ts:308` 的 `deleteVfsPrefix`：`listEntriesUnderPrefix` 后 `for` 循环逐条 `repo.delete`。

实测（`session-project-agent-cr.test.ts`，删下挂 5 session、每个 20 文件的 project）：

| SQL | count | 说明 |
|---|---|---|
| `UPDATE vfs_revision SET ref_count = ...` | 100 | 逐条 ref_count 维护 |
| `DELETE FROM vfs_entry WHERE scope_key=? AND path=?` | **100** | ⚠️ 逐条删（5 session × 20 文件）|
| `SELECT 1 FROM vfs_entry WHERE ... LIKE ...` | 100 | 每次删前的子节点检查 |
| `DELETE FROM chat_message WHERE session_id=?` | **5** | ✓ 批量删（每 session 1 条）|
| `DELETE FROM chat_session`（via deleteByProject）| 1 | ✓ 批量删 |

总 SQL 次数 = 358。耗时 8ms（文件库）。

### 后果

VFS 删除是 N+1，但消息和 session 的删除已经批量化了。文件数多时 VFS 部分会成热点。

### 修复方向（待定）

把 `deleteVfsPrefix` 的逐条删改成批量 DELETE...LIKE（和 entry 表的 `delete` 方法一致——后者已经是批量 DELETE...LIKE，但 service 层的 `deleteVfsPrefix` 没用它）。

---

## ℹ️ 行为发现：`project.copy` 不复制 session

**这不是性能问题，是行为语义问题。**

### 证据

`packages/core/src/service/chat/impl/project.service.ts:222` 的 `copy` 只做：
1. insert 新 project 行
2. 复制 `agent_config_json`
3. `copyVfsTree` 复制 **project scope** 的模板 VFS
4. `seedLiveHeadRevisionsUnderPrefix`

**完全不调 `listByProject`，不循环 session，不复制任何消息/会话 VFS/checkpoint。**

实测：复制一个下挂 10 个 session（每个 20 消息 + 10 文件）的 project，新 project 下 session 数 = 0，消息数 = 0。

### 说明

用户期望“复制项目”可能包含会话，实际只有项目模板。这可能是设计如此（project 模板 + 独立会话），也可能是漏实现。需要产品确认。

---

## 确认健康的部分（第三轮）

以下经过实测（instrumented + EXPLAIN QUERY PLAN）确认无问题：

- **workplace `renameRulesUnderLogicalPrefix`**：1 条批量 `UPDATE ... LIKE`（dir + file 各 1 条），走覆盖索引 `SEARCH ... USING COVERING INDEX ... (scope_key=?)`。不是 N+1。
- **workplace `deleteRulesUnderLogicalPrefix`**：同上，1 条批量 `DELETE ... LIKE`。
- **workplace 前缀 LIKE 的索引行为**：OR+LIKE 组合走 `scope_key` 前缀索引收窄，不是全表扫。
- **regex 三表**：PK + `idx_regex_rule_group_sort` 索引齐全；FK CASCADE 生效（desktop）；repo 层无 N+1。上层若要 list 所有 group 的 rule 需注意循环调 `listByGroupOrdered` 会变 N+1（service 调用方问题）。
- **kkv / session_kkv**：全走 PK，无遗漏的无索引查询。set 是真 upsert（`INSERT ... ON CONFLICT ... DO UPDATE`），不是 N+1。
- **sksp_secrets**：全走 PK(`ref`)，无冗余索引，无缺失索引。设计干净。
- **llm_provider / llm_saved_model**：索引覆盖完整（PK + `idx_llm_saved_model_provider`）。`list()` 走 PK covering index，无问题。
- **schema 双轨（canonical DDL + SCHEMA_COLUMN_ALIGNMENTS）**：当前无漂移，列类型一致。但是靠纪律维持的脆弱平衡——任何加列改动必须同时改两处。
- **`agent_definition.list`**：全表扫但走 PK covering index，SQL 层不贵。应用层要反序列化全量 `prompts_json`（500 个 9.68ms），无分页——大数据量时建议用 `listIds`（28x 更快）或加分页。
- **`createSubSession`**：只 insert 1 行 session，不复制 VFS（符合 SPEC，子会话共享父 scope）。

---

## 🔴 发现 14：删文件后旧版 revision + blob 成 JOIN 孤儿（数据泄漏）

**严重度：高（正确性 — 数据库只增不减）**

### 证据

`packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:352-367` 的 `deleteUnreferencedUnderScope` 和 `:240-255` 的 `listKeysUnderScope`，都用 `JOIN vfs_entry e ON e.entry_id = r.entry_id` 圈定扫描范围。

而 `vfs.delete`（service 层 `appendDeletedRevisionsForSubtree`）删文件时：
1. `entry` 行被删（`DELETE FROM vfs_entry`）
2. 旧版 `active` revision 的 `ref_count` 被减，但 **revision 行还在**（`appendDeletedRevision` 追加 deleted 版，旧 active 版不删）
3. revision GC 用 `JOIN vfs_entry` 查找要打扫的 revision——**entry 已删的 revision JOIN 不到**，成为扫不到的孤儿

实测（`gc-backup-grep-cr.test.ts`，10 文件 × 2 版）：
```
删文件后：
  revision GC 清掉 0 条 revision，blob GC 清掉 0 个 blob
  残留：active+有hash 的 revision 20 条，blob 20 个
  ⚠️ 逻辑泄漏：20 条旧版 active revision 成为 JOIN 孤儿，其 blob 也无法回收
```

### 后果

**这是正确性问题，不是性能问题。** 每次删文件都会留下旧版 revision + blob 行，revision GC 和 blob GC 都扫不到它们，数据库只增不减。长期使用后，VFS 操作密集的会话（尤其是 agent 反复写/删文件）会积累大量无法回收的 revision 和 blob，导致数据库膨胀。

### 修复方向（待定）

- revision GC 应该用 `LEFT JOIN vfs_entry ... WHERE e.entry_id IS NULL OR r.ref_count <= 0`，把 entry 已删的 revision 也纳入打扫范围。
- 或者在 `vfs.delete` 时直接清理旧版 revision（不只是 append deleted 版）。
- blob GC 的 `collectAllReferencedHashes` 也扫不到这些孤儿 revision 的 content_hash，所以即使 revision 能清，blob 的引用集也要同步调整。

---

## 🔴 发现 15：blob GC 逐条 DELETE（N+1）

**严重度：高（性能）**

### 证据

`packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts:259-281` 的 `gc()`：

```ts
async gc(referencedHashes: ReadonlySet<string>): Promise<number> {
  const rows = await queryTemplate(`SELECT content_hash FROM vfs_content_blob`, {});  // 全表扫拉回内存
  for (const row of rows) {                       // ← for 循环
    if (referencedHashes.has(hash)) continue;
    await executeTemplate(                        // ← 逐条 DELETE
      `DELETE FROM vfs_content_blob WHERE content_hash = #{contentHash}`, ...);
  }
}
```

配合 `collectAllReferencedHashes`（L195-216）——全表扫 `vfs_entry` + `vfs_revision` 拉所有 content_hash 回内存做 Set。

实测：500 个孤立 blob → 500 次 `DELETE FROM vfs_content_blob`，总耗时 510ms。

### 后果

延期 GC 的目标是兌底「触发器遗漏的孤立 blob」。孤立 blob 多时（迁移残留、崩溃恢复），逐条 DELETE 慢且不在事务里，可能中间失败留半清理状态。

### 修复方向（待定）

改成 `DELETE FROM vfs_content_blob WHERE content_hash NOT IN (SELECT content_hash FROM vfs_entry WHERE ... UNION SELECT content_hash FROM vfs_revision WHERE ...)` 一条 SQL，让 SQLite 自己处理集合运算。或分块 `DELETE ... WHERE content_hash IN (...)`。

---

## 🔴 发现 16：vfs grep 逐条读 blob + zlib 解压（N+1）

**严重度：高（性能，用户感知）**

### 证据

调用链：`vfs.grep()` → `repo.scanContents()` → `resolveScanRows()`（`sqlite-vfs-entry.repository.ts:734`）逐条 `contentStore.get()`。

`resolveScanRows` 在 `for` 循环里逐条调 `resolveEntryPlainContent()` → `contentStore.get()`（`SELECT encoding, bytes FROM vfs_content_blob WHERE content_hash = ?`）+ zlib 解压。

实测：500 文件 → 500 次 blob SELECT + 500 次 zlib 解压，总耗时 57ms。

### 后果

grep 是用户感知操作（搜索文件内容），文件数多时延迟线性增长。

### 修复方向（待定）

用 `SELECT content_hash, bytes FROM vfs_content_blob WHERE content_hash IN (?, ?, ...)` 分块批量读出所有 blob，再在内存里解压，把 N 次 SQL 降到 ceil(N/500) 次。注意：这是和发现 7（`scanContents` N+1）同一个根因，修一个同时修两个。

---

## ✅ 发现 17：truncate tail 逐条 decrementRefsForCheckpointFiles（N+1）——已修复（v1.4.24）

**严重度：中（性能）**

### 证据

`packages/core/src/domain/vfs/logic/revision-ref-count.ts:63-71`：

```ts
export async function decrementRefsForCheckpointFiles(...): Promise<void> {
  for (const file of files) {                     // ← for 循环
    await adjustRef(revisionRepo, file.entryId, file.revisionVersion, -1);
  }
}
```

实测：截断 51 条尾部消息（每条 5 个 file 指针）→ 250 次 `UPDATE vfs_revision SET ref_count = ...`。

### 后果

truncate 在 agent turn abort / rollback 时触发。通常 tail 不长，但如果 session 文件指针特别多会放大。

### v1.4.24 修复状态

`incrementRefsForCheckpointFiles` / `decrementRefsForCheckpointFiles` / `decrementLiveRefsUnderScope` 都已改为 `batchAdjustRefCount`（`revision-ref-count.ts` diff）。实测 truncate 的 ref_count UPDATE 从 250 次降到 1 次（`WHERE (entry_id, version) IN (...)` 批量）。

---

## 🟡 发现 18：integrity-repair 逐条 SELECT + UPDATE ref_count（N+1）

**严重度：中（性能）**

### 证据

`packages/core/src/domain/vfs/logic/revision-ref-count.ts:113-122` 的 `repairRefCounts`：

```ts
const keys = await revisionRepo.listKeysUnderScope(scopeKey, pathPrefix);
for (const { entryId, version } of keys) {       // ← for 循环
  const want = expected.get(key) ?? 0;
  const adjusted = await revisionRepo.repairRefCountFloor(entryId, version, want);
  // repairRefCountFloor 内部：SELECT ref_count + 可能 UPDATE
}
```

实测：200 revision → 200 次 `SELECT ref_count` + 200 次 `UPDATE ref_count`，总耗时 204ms。

### 后果

integrity-repair 在 bootstrap / migration 时触发，revision 多时会很慢。

### 修复方向（待定）

先用一条 JOIN 查出所有 `ref_count < expected` 的行，再批量 UPDATE。

---

## 🔴 发现 19：大量逻辑 FK 未声明，跨表引用完整性全靠 application 层

**严重度：高（设计缺陷——孤儿数据温床）**

### 证据

全库 16 张表，只有 2 条声明的 FK（`llm_saved_model→llm_provider`、`regex_rule→regex_group`）。以下 10 条核心跨表逻辑依赖全靠 application 层兜底：

| 子表 | 父表 | 逻辑 FK 列 | 级联删除靠谁 |
|---|---|---|---|
| `chat_session` | `chat_project` | `project_id` | application（`sessions.deleteByProject`）|
| `chat_session` | `chat_session` | `parent_session_id` | application（BFS 展开）|
| `chat_message` | `chat_session` | `session_id` | application（`messages.deleteBySession`）|
| `message_checkpoint` | `chat_message` | `(session_id, message_id)` | application |
| `message_checkpoint_file` | `message_checkpoint` | `(session_id, message_id)` | application |
| `message_checkpoint_file` | `vfs_entry` | `entry_id` | 无（逻辑 FK，GC 靠 JOIN）|
| `session_kkv_entry` | `chat_session` | `session_id` | application（`clearSession`）|
| `vfs_entry` | `vfs_content_blob` | `content_hash` | 触发器（ref_count）|
| `vfs_revision` | `vfs_entry` | `entry_id` | 无（逻辑 FK，GC 靠 JOIN）|
| `vfs_revision` | `vfs_content_blob` | `content_hash` | 触发器（ref_count）|

### 后果

这不仅仅是“不够严谨”——它直接是已发现问题的根源：
- **发现 14**（revision + blob 孤儿泄漏）：`vfs_revision→vfs_entry` 的逻辑 FK 没有 DB 约束，GC 的 JOIN 在 entry 删除后扫不到 revision。
- **发现 8/13**（vfs.delete / project.delete 的 N+1）：因为没有 DB CASCADE，每次删 session/project 都要在 application 层逐个表手动级联，这些级联代码写成了逐条循环就是 N+1。
- **发现 1**（mobile 端 CASCADE 不生效）：即使声明了 FK 的两张表（llm_saved_model/regex_rule），mobile 端因为 `foreign_keys=off` 也不生效——说明 FK 声明本身在当前架构下两端不一致。

### 为什么没声明 FK？

推测原因：SQLite 的 `foreign_keys` pragma 在两端默认值不同（better-sqlite3=ON，OP-SQLite=OFF），声明了 FK 也不能保证两端行为一致；而且 SQLite 的 FK 不支持 CASCADE 以外的策略（比如 SET NULL），限制了灵活性。加上跨表操作本身就需要 application 层做额外工作（VFS revision GC、blob 引用计数），索性全靠 application 层管。这是可以理解的历史取舍，但代价是孤儿数据风险全靠人工代码守护。

### 修复方向（待定）

- **短期**：保持 application 层级联，但补全 GC 路径（修复发现 14），确保所有逻辑 FK 对应的子表行在父表行删除时被清理。
- **长期**：考虑声明 FK 并在两端统一开 `foreign_keys=ON`。但这是大改动，要评估迁移成本和 mobile 端的 OP-SQLite 兼容性。

---

## 🟡 发现 20：`chat_message.role` 无 CHECK 约束

**严重度：中（设计缺陷）**

### 证据

`chat_message.role TEXT NOT NULL`——值域有限（`user`/`assistant`/`system`/`tool`），但没有 DB 级 CHECK 约束。实测 `INSERT` 一个 `'definitely-not-a-role'` 能原样落库。

对比：`llm_provider.protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic', 'gemini'))`——同一个项目里，provider 表有 CHECK，message 表没有，设计不一致。

同理：`vfs_entry.entry_kind TEXT NOT NULL DEFAULT 'file'`（值域 `file`/`dir`）和 `vfs_revision.status TEXT NOT NULL`（值域 `active`/`deleted`）也没有 CHECK，实测非法值能落库。

### 后果

没有 DB 级约束时，如果 application 层有 bug 传了错误的 role 值，会静默落库，不会报错。排查时只能靠查数据发现。

### 修复方向（待定）

加 CHECK 约束：`role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool'))`。`entry_kind` 和 `status` 同理。成本极低（一条 migration），收益是把脏数据挡在落库前。但要注意老库里有没有历史脏值（如果有，加 CHECK 会失败，得先清洗）。

---

## 🟡 发现 21：`workplace_dir_rule.fill_policy` 默认值不一致

**严重度：中（设计缺陷）**

### 证据

- schema DDL：`fill_policy TEXT NOT NULL DEFAULT 'hidden'`（`workplace-schema.ts`）
- 代码常量：`DEFAULT_WORKPLACE_DIR_RULE` 的 `fillPolicy` 值是 `'header'`（`domain/workplace/model/workplace-types.ts`）

实测确认：直接 SQL INSERT 不指定 `fill_policy`，落库值是 `'hidden'`（走 schema DEFAULT）。但通过 service 层创建规则时，落库值是 `'header'`（走代码常量）。

### 后果

同一个语义（“无规则时的默认填充策略”）在 DB 和代码两端取值不同。直接捅 SQL 造数据的测试 / seeder / 手工修复会拿到和 application 层不同的值。虽然不影响功能正常运行（service 层总是走代码常量），但会导致“直接看数据”时的困惑。

### 修复方向（待定）

统一默认值——决定是 `'hidden'` 还是 `'header'`，然后让 schema DEFAULT 和代码常量一致。推荐以代码常量为准（`'header'`），因为那是 application 层的实际行为。

---

## 🟢 表设计 CR：改进建议（非 bug，但值得关注）

以下不是 bug，是设计层面值得关注的点：

### 死列：`vfs_entry.content TEXT NULL`

schema 注释说“§A 暂不删该列”，但 entry_id 化后生产写路径恒写 NULL（内容全在 `vfs_content_blob` 里）。grep 确认：读写路径都已不走 `content` 列。保留它只占空间（每行一个 NULL，SQLite 里几乎不占空间）且增加认知负担。建议在后续 schema migration 中退役。

### 冗余索引：4 个

- `idx_workplace_dir_scope(scope_key)`——PK `(scope_key, logical_path)` 左前缀已覆盖。
- `idx_workplace_file_scope(scope_key)`——同上。
- `idx_message_checkpoint_session(session_id)`——PK `(session_id, message_id)` 左前缀已覆盖。
- `idx_session_kkv_session(session_id)`——PK `(session_id, domain, key)` 左前缀已覆盖。

实测 EXPLAIN QUERY PLAN 发现 SQLite **优先选这些窄索引**（因为物理更小，只需扫描 `scope_key`/`session_id` 单列 + rowid），而不是用 PK。所以它们不是完全死代码——SQLite 主动选择。但查询能力和 PK 左前缀重叠，写放大代价在小表上收益甚微。**结论：可在写放大成为热点时 DROP，当前优先级低。**

### `vfs_entry` 索引不含 `entry_kind`

`listAllPaths`、`scanContents`、`listFileMetaUnderPrefix` 等查询用 `WHERE scope_key=? AND entry_kind='file'`，但 `idx_vfs_entry_scope_path(scope_key, path)` 不含 `entry_kind`，过滤靠回表。混有大量 `dir` 行时回表比例变差。是否加 `(scope_key, entry_kind, path)` 复合索引取决于真实数据分布——如果 dir/file 比例低，收益有限。

---

## 🟢 表设计 CR：确认合理的设计取舍

以下经过审查确认是**有意的取舍或可接受的设计**，不需要改：

| 项 | 结论 | 理由 |
|---|---|---|
| `content_json` 存全量 JSON | 可接受 | 拆 TextBlock 独立列的代价（维护同步 + 多块拼接策略敏感）高于收益（仅搜索场景受益），当前把搜索当低频功能。|
| `sksp_secrets.iv` 可 null | 可接受 | Windows DPAPI 方案的 iv 返回 null，是有意的平台兼容设计。|
| `builtin_key UNIQUE` 可 null | 可接受 | 非内置 provider 的 builtin_key 为 null，SQLite 允许多个 NULL 共存，内置的 UNIQUE 去重正常生效。|
| token 三列可 null | 可接受 | null = “未统计”，parseUsage 把全 null 映射为 undefined，语义一致。|
| `start_depth`/`end_depth` 可 null | 可接受 | null = 该端不设限，matchDepth/validateDepthSlice 语义清晰。|
| 全库时间戳统一 `*_ms` | 可接受 | 16 个时间戳列全用毫秒 INTEGER NOT NULL，无秒级混用。|
| `vfs_content_blob.byte_len` 冗余 | 可接受 | 和 `length(bytes)` 严格相等，但保留无大碍（维护成本已付）。|

---

## 🔴 发现 22：全库 TEXT PRIMARY KEY 列都不隐含 NOT NULL（SQLite 怪异点）

**严重度：高（设计缺陷——跨全库 16 张表）**

### 证据

SQLite 的著名行为：`TEXT PRIMARY KEY` **不隐含 NOT NULL**（只有 `INTEGER PRIMARY KEY` 才隐含）。`PRAGMA table_info` 显示所有 TEXT PK 列的 `notnull=0`。实测 `INSERT INTO regex_group (group_id, ...) VALUES (NULL, ...)` **成功**。

全库受影响的 TEXT PK 列：
- `chat_project.id`、`chat_session.id`、`chat_message.id`
- `message_checkpoint(session_id, message_id)`
- `message_checkpoint_file(session_id, message_id)`
- `llm_provider.id`、`llm_saved_model.id`
- `regex_group.group_id`、`regex_rule(group_id, rule_id)`
- `kkv_entry(module, key)`、`session_kkv_entry(session_id, domain, key)`
- `agent_definition.agent_id`
- `sksp_secrets.ref`
- `vfs_content_blob.content_hash`

生产代码的 service 层都会校验非空，但绕过 service 的路径（迁移、手工修库、外部工具）能造出 NULL PK 行。

### 修复方向

所有 PK 列显式写 `NOT NULL`：`id TEXT NOT NULL PRIMARY KEY`。这是一行 DDL 改动，收益最大。需要 migration（对老库 ALTER TABLE 可能需要 rebuild，SQLite 不支持直接给已有列加 NOT NULL）。

---

## 🟡 发现 23：复合 PK 表适合 WITHOUT ROWID（4 张）

**严重度：中（性能 + 空间优化）**

### 证据

以下 4 张表用复合 TEXT PK，但当前是 rowid 表（实测 `SELECT rowid FROM ... LIMIT 1` 成功）——意味着每行多一个 rowid 列 + rowid 索引，而所有查询都走复合 PK，从不按 rowid 寻址：

| 表 | 复合 PK | 收益 |
|---|---|---|
| `message_checkpoint` | `(session_id, message_id)` | 省 rowid 列 + PK 直接聚簇 |
| `message_checkpoint_file` | `(session_id, message_id, entry_id)` | 同上 |
| `vfs_revision` | `(entry_id, version)` | 同上 |
| `vfs_content_blob` | `(content_hash)` | content_hash 作聚簇键，点查少一次回表 |

### 后果

rowid 表的复合 PK 是二级索引——查询时先查 PK 索引拿 rowid，再回表拿行数据。`WITHOUT ROWID` 让 PK 直接作聚簇键，省一次回表。对点查密集的 revision / content_blob 有明显收益。

### 修复方向

需要 `CREATE TABLE ... WITHOUT ROWID` 的 rebuild migration（SQLite 不支持 ALTER 改 rowid 属性）。建议在下一次 vfs 大改（如 content 列退役）时顺带切。

---

## 🟡 发现 24：`idx_vfs_entry_scope_path` 与 UNIQUE 隐式索引完全重叠

**严重度：中（冗余索引——写放大）**

### 证据

`vfs_entry` 有两个列序完全相同的索引：
- 隐式：`sqlite_autoindex_vfs_entry_1`（来自 `UNIQUE(scope_key, path)` 约束）
- 显式：`idx_vfs_entry_scope_path(scope_key, path)`（来自 migration）

实测 EXPLAIN：点查走隐式 UNIQUE 索引，前缀 LIKE 走显式索引——但两者的查询能力完全重叠，SQLite 只选其一，另一个纯写放大（每次 INSERT/UPDATE path 维护两份 B-tree）。

之前（发现“冗余索引 4 个”）只说“和 PK 左前缀冗余”，没发现这两个索引列序完全一样——比左前缀冗余更严重。

### 修复方向

DROP `idx_vfs_entry_scope_path`，靠 UNIQUE 隐式索引兜底。如果将来要加 `entry_kind` 覆盖，改建成 `(scope_key, entry_kind, path)`。

---

## 🟡 发现 25：sksp_secrets 安全设计缺口

**严重度：中（安全）**

### 证据

两个问题叠加：

1. **`algo` 无 CHECK**——实测 `algo='totally-fake-algo'` 能落库。合法值只有 4 种（`linux-secret-service-aes-gcm-v1`/`macos-keychain-aes-gcm-v1`/`android-keystore-aes-gcm-v1`/`dpapi-v1`）。
2. **非 DPAPI algo 可与 `iv=NULL` 共存**——`iv` 可 null 是为 Windows DPAPI 设计的（DPAPI 无 iv 概念）。但实测能写入 `algo='macos-keychain-aes-gcm-v1'` + `iv=NULL`。读取时 mac strategy 才抛 `DECRYPT_FAILED`——“能写脏、读时炸”反模式。

### 修复方向

- 加 `CHECK(algo IN ('linux-secret-service-aes-gcm-v1', 'macos-keychain-aes-gcm-v1', 'android-keystore-aes-gcm-v1', 'dpapi-v1'))`。
- 加表级 `CHECK((algo = 'dpapi-v1') OR (iv IS NOT NULL))`——非 DPAPI 必须有 iv。

---

## 🟡 发现 26：JSON 列都没有 json_valid() CHECK

**严重度：中（数据质量）**

### 证据

全库 4 个 JSON 列都没有 `json_valid()` CHECK：
- `chat_message.content_json`——读路径有 try/catch 容错。
- `llm_provider.headers_json`——读路径 `parseHeaders` 有 try/catch → `{}`。
- `llm_saved_model.settings_json`——读路径 `JSON.parse` **无 try/catch**，非法 JSON 会让整行读不出来。
- `agent_definition.prompts_json`——读路径 `JSON.parse` + `decode` **无 try/catch**，非法 JSON 整行抛错。

实测 `INSERT ... settings_json = '{ this is not json'` 能落库。

better-sqlite3 自带 JSON1 扩展，支持 `CHECK(json_valid(col))`。

### 修复方向

至少对 `settings_json` 和 `prompts_json`（读路径无容错的两个）加 `CHECK(json_valid(col))`。`content_json` 和 `headers_json` 可选（读路径有容错）。

---

## 🟡 发现 27：regex_rule 的 (group_id, sort_order) 缺 UNIQUE

**严重度：中（数据一致性）**

### 证据

`regex_rule` 的 `sort_order INTEGER NOT NULL`——service 层用 `nextSortOrder(MAX+1)` 保证不重复，但 DB 层没有 `UNIQUE(group_id, sort_order)`。实测同 group 同 sort_order 能插两条。

并发竞态（两个请求同时 `nextSortOrder` 拿到相同值）或绕过 service 的路径都能造出重复 sort_order。排序时有 `rule_id` 兜底不会崩，但语义上 sort_order 应唯一。

### 修复方向

加 `UNIQUE(group_id, sort_order)`。但要先确认老库没有历史重复值（如果有，加 UNIQUE 会失败，得先清洗）。

---

## 🟡 发现 28：`chat_message.hidden` 缺 CHECK(hidden IN (0,1))

**严重度：中（设计缺陷——和 role 同类但更隐蔽）**

### 证据

`chat_message.hidden INTEGER NOT NULL DEFAULT 0`——值域 0/1，但没有 CHECK。实测 `hidden=2` 能落库。

model 层用 `Number(row.hidden) === 1` 解析——意味着 `hidden=2` 会被静默当 `false`。这比 `role` 的问题更隐蔽：role 的非法值至少读出来还是原字符串，hidden 的 `2` 会变成 `false` 不留痕迹。

### 修复方向

加 `CHECK(hidden IN (0,1))`。同类问题还影响：`regex_rule.enabled`、`regex_rule.scope_user`、`regex_rule.scope_assistant`、`llm_provider.is_builtin`、`workplace_dir_rule.rule_enabled`——全库所有用 INTEGER 存 boolean 的列都没有 CHECK。

---

## 🟢 逐表设计 CR：改进建议汇总（非 bug，但值得关注）

以下是逐表审查后发现的设计改进点（不是 bug，是值得优化的地方）：

### vfs_revision 的 content_hash NULL 与 status 没有耦合约束

`status='active'` 应该有 `content_hash NOT NULL`，`status='deleted'` 的 content_hash 应该是 NULL。但 DDL 不强制这个约束——实测 `active + null content_hash` 能落库，读路径 `resolveRevisionPlainContent` 会抛「正文损坏」。全靠应用层 `append()` 在 status≠active 时强制 content_hash=null 兜。建议加 `CHECK((status='active' AND content_hash IS NOT NULL) OR (status!='active' AND content_hash IS NULL))`。

### CHECK 约束大面积缺失（汇总）

逐表审查发现以下列都缺 CHECK（值域有限但不约束）：
- `vfs_entry.entry_kind`（file/dir）
- `vfs_revision.status`（active/deleted）
- `vfs_content_blob.encoding`（zlib/zlib-b64）
- `workplace_dir_rule.sort_field`（name/created/updated）
- `workplace_dir_rule.sort_order`（asc/desc）
- `workplace_dir_rule.fill_policy`（hidden/filename/header/full）
- `workplace_file_rule.inclusion_mode`（auto/show/hide）
- `regex_rule.flags`（正则 flags 字符集）
- `sksp_secrets.algo`（4 种合法值）

### 下界 CHECK 缺失

`head_count`/`tail_count`（应为 >=0）、`ref_count`（应为 >=0）、`seq`（应为 >=1）、`revision_version`（应为 >=1）——都能塞负数。

### message_checkpoint.created_at_ms 疑似只写不读

repository 所有 SELECT 都不取这列，port 也没有方法返回 `createdAtMs`。仅 `capture`/`seed` 写入。可能是有意预留（诊断/GC 排序），但建议补注释写明语义。

## 🟢 逐表设计 CR：确认合理的设计取舍（补充）

以下在逐表审查后确认合理：

| 项 | 结论 | 理由 |
|---|---|---|
| `vfs_entry` 用 AUTOINCREMENT | 合理 | 不可变身份键 + 防删后 id 复用（孤儿 revision/checkpoint 不会指向“复活”的 entry）|
| 触发器 5 个边界 case | 全正确 | null→有值、有值→null、null→null、同值、异值——全部实测验证 |
| UPDATE 触发器生产不可达 | 合理 | 生产代码只 UPDATE ref_count 不 UPDATE content_hash，触发器是防御性安全网 |
| workplace 两表分开 | 合理 | dir 8 列 / file 3 列，合并后 file 行要填 6 个 NULL，schema 膨胀 + 语义模糊 |
| `idx_regex_rule_group_sort` 不可替代 | 合理 | PK 第二列是 rule_id 不是 sort_order，ORDER BY sort_order 必须 idx |
| `vfs_entry` 的 `content` 死列 | 已知（保留） | §A 决策暂不删，待迁移完成后退役 |
| kkv 的 PK 设计 | 合理 | 点查走 PK，无冗余无缺失 |
| session_kkv 的 PK 列序 | 合理 | 所有查询都 `(session_id, domain, ...)`，列序最优 |

## 仍未弄清

- ~~`vfs-entry-id-redesign-v1` migration 的 ensure 分支是否确实建了触发器~~ **已确认（第二轮）：触发器和索引在 `:memory:` 新库上都存在。**
- mobile 端 RN 驱动在 native 层（Java/ObjC）有没有开 WAL / pragma，未探。
- **触发器性能开销对 instrumented connection 不可见**（第二轮发现）：`vfs_revision` 的 INSERT/DELETE/UPDATE 会 fire 引擎内部的 blob ref_count 维护 SQL，但这些不经过 `TdbcConnection`，所以 harness 的 recorder 统计不到。分析 revision 密集型操作（rollback、批量 delete）的真实 SQL 开销时，这个盲区会让结论偏乐观。
- 深层目录树（如 `/a/b/c/d/...`）下，`list` 非递归模式会在 JS 层过滤掉深层路径——SQL 用 `LIKE 'prefix/%'` 返回所有子树再在 JS 丢弃，深层结构时会有多余 IO。这是设计权衡（SQLite LIKE 表达不了"恰好一层"），低优先级。
