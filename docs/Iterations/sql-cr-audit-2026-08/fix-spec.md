---
date: 2026-08-12
---

# SQL CR 发现修复技术规格（SPEC）

> 需求来源：`docs/Iterations/sql-cr-audit-2026-08/findings.md`（六轮 CR 发现的 28 条问题）。无标准 `prd.md`，本 spec 直接从 findings + 三轮探索报告推导。

## 设计目标

修复六轮全量 SQL/表设计 CR 发现的 28 条问题。按"正确性止血 → 性能 N+1 → 表设计约束 → LIKE 搜索"四个波次推进，每个波次可独立验收、独立合并。

**三条决策主线**：
- **正确性优先**：数据泄漏（发现 14）和 mobile FK（发现 1）排最前，性能和设计约束在后。
- **batch 模式对齐 v1.4.24**：v1.4.24 已用 `batchAdjustRefCount` / `seedCheckpoints` / `conn.batch` 建立了批量修复模式，后续 N+1 修复保持同一风格（分块 500、`IN (...)` 子句、存在性前置校验）。
- **DDL rebuild 走 migration + 预扫描**：所有约束补全（NOT NULL / CHECK / WITHOUT ROWID）都要 rebuild 表，rebuild 前必须扫描老库脏值，否则 `INSERT INTO _new` 会卡死。

**硬约束**：
- v1.4.08 最低支持版本不变（所有 migration 要兼容 v1.4.08 升级路径）。
- migration 幂等（`PRAGMA table_info` 探测 + 已登记跳过）。
- 每步可独立验证（测试映射到 Step）。

**不含范围**：
- 发现 3（LIKE 全表扫 / FTS5）独立为大项，本 spec 只做方案选型和前置验证，不落地 FTS5 migration（中文分词需 RN 端真机确认）。
- 发现 4（`seed-builtin-providers` 逐条 INSERT）排除——内置 provider 个位数，N+1 影响极低，优先级不足，留后续。
- 发现 19（全量声明逻辑 FK）留长期——短期只修 GC 路径（发现 14），VFS 表声明 CASCADE FK 会破坏 append-only revision + 延期 GC 的删除契约。
- 发现 6（WAL）保守选择不改。

**纳入发现 5 的判断**：`workplace.copyScope` 的规则条数从十几到上百，比发现 4 的内置 provider 影响大得多，且同样是 batch 模式可顺手对齐 v1.4.24 风格，所以纳入 Phase 1（新增 Step 10）。

## 总体方案

### 波次编排：P0 止血 → P1 N+1 → P2 约束 → P3 LIKE

| Phase | 主题 | 含发现 | 前置 Phase |
|---|---|---|---|
| phase-correctness | 正确性止血（孤儿 GC + mobile FK） | 14、1 | 无 |
| phase-n-plus-1 | N+1 性能修复 | 7+16、8、9+12、10a、13、15、18、5 | 无 |
| phase-constraints | 表设计约束（NOT NULL / CHECK / WITHOUT ROWID / UNIQUE / json_valid） | 22、23、24、20+28、25、26、27、21 | phase-correctness |
| phase-like-search | LIKE 全表扫（FTS5 方案选型 + 前置验证） | 3 | 无（独立评估） |

已修复的不纳入：发现 2（v1.4.24）、发现 12 checkpoint 部分（v1.4.24）、发现 17（v1.4.24）。误报不纳入：发现 11。

### 关键架构决策

**决策 1：发现 14 的修复不是改 LEFT JOIN，而是加全局孤儿清扫。**

探索报告确认：findings 原建议的 `LEFT JOIN ... WHERE e.entry_id IS NULL` 不可行——revision GC 的扫描范围靠 `e.scope_key` + `e.path` 圈定，孤儿 revision 对应的 entry 已删，`e.scope_key = ...` 对 NULL 行恒假，孤儿被 WHERE 滤掉。正确修复是在现有 path-scoped `deleteUnreferencedUnderScope` 之外，**新增一条脱离 path 作用域的全局孤儿清扫**：

```sql
DELETE FROM vfs_revision
WHERE ref_count <= 0
  AND entry_id NOT IN (SELECT entry_id FROM vfs_entry)
```

blob 回收跟着解决：revision DELETE 触发器（`trg_revision_delete_dec_blob_ref`）自动把 blob ref_count -1 归零删除。

**决策 2：发现 10（rollback）只修 (a) listBySession→countBySession，(b) reconcileVfsPaths 批量化单独评估。**

探索报告确认 (b) 批量化难度极高——每条 path 的 restore outcome 不同（skip/delete/restore），且 restore 路径内部有 `contentStore.put` + `setHeadContentHash` + `transferLiveRef` 等副作用。(a) 改 `countBySession` 收益最直接（消除两次全量拉取），(b) 留后续迭代。

**决策 3：DDL 约束修复统一走一条 rebuild migration + 脏值预扫描。**

所有约束补全（NOT NULL / CHECK / WITHOUT ROWID / UNIQUE / json_valid）都要 rebuild 表。一条 migration 按表逐个 rebuild（参照 `vfs-entry-id-redesign-v1` 模式），每个表 rebuild 前先跑对应的脏值扫描查询。如果扫描到脏值，migration 打 warning 并清洗（设为合法默认值）再 rebuild。

同时改 canonical DDL 让新库直接建成带约束形态 + `SCHEMA_BOOT_VERSION` +1（5→6）。

**决策 4：vfs_revision 切 WITHOUT ROWID 必须同步改 `deleteUnreferencedUnderScope` 的 rowid 查询。**

探索报告发现：生产代码里 `deleteUnreferencedUnderScope`（`sqlite-vfs-revision.repository.ts`，方法体在 L405、`WHERE rowid IN (...)` 在 L432-438）用 `DELETE FROM vfs_revision WHERE rowid IN (...)`，直接依赖 rowid。切 WITHOUT ROWID 前必须改写成 `(entry_id, version) IN (...)`。

**决策 5：发现 3（FTS5）只做方案选型和前置验证，不落地 migration。**

FTS5 的最大障碍是中文分词：默认 `unicode61` 按字切不按词切；`trigram` 分词器需 SQLite ≥ 3.34，RN 端版本未确认。本 spec 只做：(a) 验证 RN 端 SQLite 版本 + FTS5 支持情况（需真机/APK）；(b) 如果版本达标，在 Node 端做 FTS5 + trigram 的 POC 测试。实际 migration 留独立迭代。

## 最终项目结构

```
packages/core/src/
  bootstrap/
    novel-master-bootstrap.ts                    # SCHEMA_BOOT_VERSION 5→6（phase-constraints）
    schema-migrations/
      index.ts                                    # 注册新 migration
      orphan-revision-gc-v1.ts                   # P0：全局孤儿清扫 migration（发现 14）
      table-constraints-v1.ts                    # P2：NOT NULL / CHECK / WITHOUT ROWID rebuild migration
  domain/
    vfs/
      content-store/
        vfs-content-store.port.ts                # 加 getMany 批量读（发现 7+16）
        impl/sqlite-vfs-content-store.ts         # 实现 getMany + gc 批量化（发现 7+16、15）
      repositories/
        vfs-entry.port.ts                        # 加 deleteRecursiveIfAny 声明（发现 13，P1-1；deleteVfsPrefix 的 repo 参数是接口，端口必须声明否则类型/mock 不过）
        impl/sqlite-vfs-entry.repository.ts      # resolveScanRows 批量化（发现 7+16）；实现 deleteRecursiveIfAny（发现 13，P1-1）
        impl/sqlite-vfs-revision.repository.ts   # deleteUnreferencedUnderScope rowid→PK（决策 4）；加 deleteGlobalOrphans（发现 14，P1-2）
        vfs-revision.port.ts                     # 加 deleteGlobalOrphans(): Promise<number>（发现 14，P1-2）
      logic/
        revision-ref-count.ts                    # repairRefCounts 批量化（发现 18）
    chat/
      repositories/
        message.port.ts                          # 加 batchInsert + countBySession（发现 9+12、10a）
        impl/sqlite-message.repository.ts        # 实现 batchInsert + countBySession
    message-checkpoint/
      logic/
        revision-gc.ts                           # 加全局孤儿清扫调用（发现 14）
    vfs/logic/
      vfs-tree-copy.ts                           # deleteVfsPrefix 改 recursive:true（发现 13）
    workplace/
      repositories/
        workplace.port.ts                        # 加 batchUpsertDirRules / batchUpsertFileRules（发现 5）
        impl/sqlite-workplace.repository.ts       # copyScope 改批量 upsert（发现 5）
  service/
    vfs/impl/revision-aware-vfs.service.ts       # appendDeletedRevisionsForSubtree 批量化（发现 8）
    chat/impl/
      message.service.ts                         # fork 消息 batchInsert（发现 9）
      session.service.ts                         # copy 消息 batchInsert（发现 12）
    message-checkpoint/impl/
      message-rollback.service.ts                # listBySession→countBySession（发现 10a）

packages/tdbc-driver-rn/src/
  driver.ts                                       # open 后加 PRAGMA foreign_keys=ON（发现 1）

packages/tdbc-driver-better-sqlite3/src/
  driver.ts                                       # open 后显式 PRAGMA foreign_keys=ON（发现 1 对称）

packages/core/test/                              # 各修复的回归测试（放 test/vfs/ 等默认 glob 内进 CI）
```

## 变更点清单

| 文件 | 动作 | 发现 |
|---|---|---|
| `bootstrap/schema-migrations/orphan-revision-gc-v1.ts` | 新增 | 14 |
| `bootstrap/schema-migrations/table-constraints-v1.ts` | 新增 | 22、23、24、20+28、25、26、27、21、P2-3 |
| `bootstrap/schema-migrations/index.ts` | 改（注册 2 条 migration，顺序约束见 Step 1） | 14、22-28 |
| `bootstrap/novel-master-bootstrap.ts` | 改（BOOT_VERSION 5→6、canonical DDL 约束） | 22-28 |
| `domain/vfs/content-store/vfs-content-store.port.ts` | 改（加 getMany） | 7+16 |
| `domain/vfs/content-store/impl/sqlite-vfs-content-store.ts` | 改（getMany + gc 签名改成无参 `gc(): Promise<number>`） | 7+16、15、P1-3 |
| `domain/vfs/content-store/deferred-blob-gc.ts` | 改（`runDeferredBlobGc` 不再调 `collectAllReferencedHashes`） | 15、P1-3 |
| `domain/vfs/repositories/vfs-revision.port.ts` | 改（加 `deleteGlobalOrphans(): Promise<number>`） | 14、P1-2 |
| `domain/vfs/repositories/vfs-entry.port.ts` | 改（加 `deleteRecursiveIfAny` 声明；`deleteVfsPrefix` 的 repo 参数是接口 `VfsEntryRepository`，端口必须声明，否则类型/mock 不过） | 13、P1-1 |
| `domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts` | 改（resolveScanRows 批量化；实现 `deleteRecursiveIfAny`） | 7+16、13、P1-1 |
| `domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts` | 改（rowid→PK；实现 deleteGlobalOrphans） | 决策 4、14、P1-2 |
| `domain/vfs/logic/revision-ref-count.ts` | 改（repairRefCounts 批量化） | 18 |
| `domain/vfs/logic/vfs-tree-copy.ts` | 改（deleteVfsPrefix 用 `deleteRecursiveIfAny`） | 13 |
| `domain/chat/repositories/message.port.ts` | 改（加 batchInsert + countBySession） | 9+12、10a |
| `domain/chat/repositories/impl/sqlite-message.repository.ts` | 改（实现） | 9+12、10a |
| `domain/message-checkpoint/logic/revision-gc.ts` | 改（加全局孤儿清扫调用） | 14 |
| `domain/workplace/repositories/workplace.port.ts` | 改（加 batchUpsertDirRules / batchUpsertFileRules） | 5 |
| `domain/workplace/repositories/impl/sqlite-workplace.repository.ts` | 改（copyScope 改批量 upsert） | 5 |
| `service/vfs/impl/revision-aware-vfs.service.ts` | 改（appendDeletedRevisionsForSubtree 批量化） | 8 |
| `service/chat/impl/message.service.ts` | 改（fork batchInsert） | 9 |
| `service/chat/impl/session.service.ts` | 改（copy batchInsert） | 12 |
| `service/message-checkpoint/impl/message-rollback.service.ts` | 改（countBySession） | 10a |
| `tdbc-driver-rn/src/driver.ts` | 改（PRAGMA foreign_keys=ON） | 1 |
| `tdbc-driver-better-sqlite3/src/driver.ts` | 改（显式 PRAGMA foreign_keys=ON） | 1 |

## 详细实现步骤

### Phase 0：正确性止血

- Step 1 — phase-correctness — blocking: yes — qa: auto：**修复发现 14（revision + blob 孤儿泄漏）**。新增 `orphan-revision-gc-v1.ts` migration，在 `up` 里跑 `DELETE FROM vfs_revision WHERE ref_count <= 0 AND entry_id NOT IN (SELECT entry_id FROM vfs_entry)`，用 `changes() > 0` 判断是否清扫了孤儿。同时改 `revision-gc.ts` 的 `sweepSessionRevisions`（注意现有 `_conn` 参数未使用），在现有 path-scoped 清扫后追加一次全局孤儿清扫（同一事务内）。**接口选择（P1-2）**：给 `VfsRevisionRepository` 端口新增 `deleteGlobalOrphans(): Promise<number>`，SQL 同上，返回清扫行数；`sweepSessionRevisions` 在 path-scoped 清扫后调用它，返回值相加。注册进 `SCHEMA_MIGRATIONS` 数组末尾。**顺序约束（P1-5）**：`orphan-revision-gc-v1` 必须排在 `table-constraints-v1` 之前注册到 `SCHEMA_MIGRATIONS` 数组（数组按顺序执行），确保 vfs_revision rebuild 前孤儿已清——否则 rebuild 的 `INSERT INTO _new SELECT * FROM` 会把孤儿搬进新表。回归测试：造 10 文件 × 2 版，删全部文件，跑 GC，断言 revision 行数 = 0（之前残留 20 条）。测试放 `test/vfs/orphan-revision-gc.test.ts`（进默认 CI glob）。

- Step 2 — phase-correctness — blocking: yes — qa: manual_user：**修复发现 1（mobile foreign_keys）**。`tdbc-driver-rn/src/driver.ts` 的 `open` 方法，在 `adapter.open()` 成功后加 `await adapter.execute("PRAGMA foreign_keys = ON")`。同时在 `tdbc-driver-better-sqlite3/src/driver.ts` 显式 `db.pragma("foreign_keys = ON")` 让两端对称（better-sqlite3 默认已 ON，幂等无害）。Node 端回归测试放 `tdbc-driver-better-sqlite3/test/`；RN 端真机验收标注 `manual_user`。

### Phase 1：N+1 性能修复

- Step 3 — phase-n-plus-1 — blocking: yes — qa: auto：**修复发现 7+16（scanContents/grep 逐条读 blob）**。ContentStore 端口加 `getMany(hashes: readonly string[]): Promise<Map<string, string>>`，sqlite 实现用 `SELECT content_hash, encoding, bytes FROM vfs_content_blob WHERE content_hash IN (?, ?, ...)` 分块 500。`resolveScanRows` 改成：先收集所有 content_hash，一次 `getMany` 批量读取，内存里匹配。测试：500 文件 scanContents，断言 blob SELECT count ≤ 2（分块 500 一块就够）。

- Step 4 — phase-n-plus-1 — blocking: yes — qa: auto：**修复发现 8（vfs.delete 逐条 appendDeletedRevision）**。改 `appendDeletedRevisionsForSubtree`：用 `listFileHeadsUnderPrefix` 一次查出所有子文件的 `(entryId, version)`，`batchAdjustRefCount` 批量 -1 旧 head，`batchAppendWithRefCount` 批量 append deleted 版（refCount=1）+ `batchAdjustRefCount` 批量 +1 deleted 版。改完后 delete 路径不再调 scanContents，原 Step 4 对 Step 3 的依赖从“共享 scanContents 路径”退化为“仅测试计数层面的保守建议”——T-DEL1 的 `SQL 总数 ≤ 20` 上限仍需要 Step 3 修完 scanContents 后才稳定成立，所以实现上 Step 3 仍要先合并，但这不是逻辑依赖。测试：删 100 文件目录，断言 SQL 总数 ≤ 20（之前 302）。

- Step 5 — phase-n-plus-1 — blocking: yes — qa: auto：**修复发现 9+12（fork/copy 消息逐条 INSERT）**。MessageRepository 加 `batchInsert(messages: readonly ChatMessage[])`，用 `conn.batch(INSERT_SQL, messages.map(toParams))`。`message.service.ts` 的 `fork` 和 `session.service.ts` 的 `copy` 改成构造消息数组后一次 batchInsert。测试：fork 40 条消息，断言 INSERT count = 1（之前 40）。

- Step 6 — phase-n-plus-1 — blocking: yes — qa: auto：**修复发现 10a（rollback listBySession→countBySession）**。MessageRepository 加 `countBySession(sessionId): Promise<number>`，实现 `SELECT COUNT(*) FROM chat_message WHERE session_id = ?`。`message-rollback.service.ts` L175 的乐观锁对比改用 `countBySession`。测试：造 1000 条消息跑 rollback，断言乐观锁步骤的 SELECT 返回行数 = 1（之前拉全部 1000 行）。

- Step 7 — phase-n-plus-1 — blocking: no — qa: auto：**修复发现 13（project.delete VFS 逐条删）**。改 `vfs-tree-copy.ts` 的 `deleteVfsPrefix`：用 `repo.delete(scopeKey, prefix, { recursive: true })` 一条批量 DELETE...LIKE 替代逐条循环（确认 revision 在删 entry 前已由调用方处理）。**边界（P1-1）**：`sqlite-vfs-entry.repository.ts:444-454` 的 `recursive:true` 分支在 `changes() === 0` 时抛 `vfsNotFound`；而当前 `deleteVfsPrefix`（`vfs-tree-copy.ts:308-318`）对空 prefix 是静默返回，且 `sweepRevisionsUnderScope`（L285-289）链式调用它，抛异常会中断 revision GC。处理方式选定：在 repo 层新增 `deleteRecursiveIfAny(scopeKey, prefix)`——先用 `listEntriesUnderPrefix` 探测，为空直接 `return 0`，否则走 `recursive:true` 分支；`deleteVfsPrefix` 改调它，保持空 prefix 静默返回的语义不变。测试：删 100 文件，断言 DELETE count = 1（之前 100）；补一个空 prefix 用例，断言不抛异常、revision GC 链不被中断。

- Step 8 — phase-n-plus-1 — blocking: no — qa: auto：**修复发现 15（blob GC 逐条 DELETE）**。改 `sqlite-vfs-content-store.ts` 的 `gc`：把签名改成无参 `gc(): Promise<number>`，内部改成 `DELETE FROM vfs_content_blob WHERE content_hash NOT IN (SELECT content_hash FROM vfs_entry WHERE content_hash IS NOT NULL UNION SELECT content_hash FROM vfs_revision WHERE content_hash IS NOT NULL)` 一条 SQL（满足 T-GC2 全库引用集合同）。**冗余全表扫清理（P1-3）**：改完后原 `referencedHashes` 参数被 NOT IN 子查询取代，调用方 `deferred-blob-gc.ts:15-19` 的 `runDeferredBlobGc` 仍会先跑 `collectAllReferencedHashes()` 全表扫——这一步变冗余，必须同步删掉，否则全表扫白跑。同步改端口 `VfsContentStore.gc` 签名为无参，所有调用方一起改。测试：500 孤立 blob，断言 DELETE count = 1（之前 500）；额外断言 `runDeferredBlobGc` 执行过程中不再发出 collectAllReferencedHashes 对应的 SELECT。

- Step 9 — phase-n-plus-1 — blocking: no — qa: auto：**修复发现 18（integrity-repair 逐条）**。改 `repairRefCounts`：批量 SELECT 所有 key 的 ref_count，内存算 diff（current < expected），构造参数列表后 `conn.batch(UPDATE ... SET ref_count = ? WHERE entry_id = ? AND version = ?)`（保持"只增不减"语义）。测试：200 revision，断言 SELECT count ≤ 2 + UPDATE count ≤ 2（之前各 200）。

- Step 10 — phase-n-plus-1 — blocking: no — qa: auto：**修复发现 5（workplace.copyScope 逐条 upsert）**。`sqlite-workplace.repository.ts:194-207` 的 `copyScope` 里对 dirs 和 files 各一个 `for` 循环逐条 `upsertDirRule / upsertFileRule`，每个 upsert 内部又是 DELETE + INSERT 两条 SQL，规则条数十几到上百，round-trip 次数 = 规则数 × 2。改法：WorkplaceRepository 端口加 `batchUpsertDirRules(rules: readonly DirRule[])` 和 `batchUpsertFileRules(rules: readonly FileRule[])`，实现用 `conn.batch` 先批量 `DELETE FROM ... WHERE scope_key = ? AND dir IN (...)` 再批量 INSERT（保持单条 upsert 的 DELETE→INSERT 顺序语义在批量下仍正确）；`copyScope` 改成收集两组规则后各调一次 batch。**计数口径（P2-NEW-A）**：`copyScope` 现状开头有 `this.deleteScope(toScopeKey)` 全删目标 scope（dirs + files 各一条 DELETE）。改造后这条前置 `deleteScope` 保留语义不变（清空目标 scope，覆盖目标 scope 原有不在源 scope 的规则），`batchUpsertDirRules` / `batchUpsertFileRules` 内部不再重复 DELETE，直接批量 INSERT。所以 T-WP1 的口径是「copyScope 整体执行的 SQL 语句数」：DELETE = 2（deleteScope 的 dirs + files 两条，目标 scope 为空时 changes=0 但 SQL 仍发出）、INSERT = 2（两个 batchUpsert 各一条）。测试：copyScope 50 条 dir rule + 50 条 file rule，断言 DELETE count ≤ 2 + INSERT count ≤ 2（之前各 100）。

### Phase 2：表设计约束

- Step 11 — phase-constraints — blocking: yes — qa: auto：**编写脏值预扫描**。在 `table-constraints-v1.ts` migration 的 `up` 开头，对每个要加 CHECK 的列跑 `SELECT COUNT(*) FROM <table> WHERE <column> NOT IN (<合法值>)`。如果 count > 0，打 warning 并清洗（`UPDATE <table> SET <column> = <默认值> WHERE <column> NOT IN (<合法值>)`）。对于 NOT NULL 扫描（TEXT PK 列），`SELECT COUNT(*) FROM <table> WHERE <pk_col> IS NULL`。**下界 CHECK 预扫描（P2-3）**：`head_count` / `tail_count` / `ref_count`（>=0）、`seq` / `revision_version`（>=1）这几列要额外扫负值并清洗：`UPDATE <table> SET <col> = <下界> WHERE <col> < <下界>`。**boolean 列补全（P1-4）**：除了 chat_message.hidden / llm_provider.is_builtin，还要同步扫 `regex_rule.enabled` / `regex_rule.scope_user` / `regex_rule.scope_assistant` / `workplace_dir_rule.rule_enabled`，清洗 SQL 统一为 `UPDATE ... SET col = 0 WHERE col NOT IN (0,1)`。测试：造脏值，跑 migration，断言被清洗。

- Step 12 — phase-constraints — blocking: yes — qa: auto：**修复发现 22（TEXT PK NOT NULL）+ 发现 23（WITHOUT ROWID）+ 发现 20/28（CHECK）+ 发现 27（sort_order UNIQUE）+ 发现 26（json_valid）+ 发现 21（fill_policy DEFAULT）+ 决策 4（vfs_revision rowid→PK）+ P2-3（下界 CHECK）**。一条 migration `table-constraints-v1.ts` 按表逐个 rebuild（参照 `vfs-entry-id-redesign-v1` 模式）。每个表的 rebuild：
  - `CREATE TABLE _new (<带约束的 DDL>)`
  - `INSERT INTO _new SELECT * FROM <old>`（脏值已在 Step 11 清洗）
  - `DROP TABLE <old>`
  - `ALTER TABLE _new RENAME TO <old>`
  - 重建索引/触发器（IF NOT EXISTS）
  
  **vfs_revision 的特殊处理**：切 WITHOUT ROWID 前先改 `deleteUnreferencedUnderScope` 的 `WHERE rowid IN (...)` → `WHERE (entry_id, version) IN (...)`（决策 4）。同时 canonical DDL 改成带约束形态，`SCHEMA_BOOT_VERSION` +1（5→6；当前代码基线是 5，见 `novel-master-bootstrap.ts:59`）。Step 1 的 orphan GC migration 是纯加 migration，不动 BOOT_VERSION——只有 Step 12（canonical DDL 改约束）才 +1。

  **涉及表**：全部 16 张表（TEXT PK 列加 NOT NULL）；message_checkpoint / message_checkpoint_file / vfs_revision / vfs_content_blob 切 WITHOUT ROWID；chat_message（role/hidden CHECK）、vfs_entry（entry_kind CHECK）、vfs_revision（status CHECK + status-content_hash 耦合 CHECK）、vfs_content_blob（encoding CHECK）、workplace_dir_rule（sort_field/sort_order/fill_policy CHECK + DEFAULT 'header'）、workplace_file_rule（inclusion_mode CHECK）、regex_rule（flags CHECK + UNIQUE(group_id, sort_order)）、sksp_secrets（algo CHECK + iv 安全 CHECK）、llm_provider（is_builtin CHECK）、llm_saved_model（settings_json json_valid CHECK）、agent_definition（prompts_json json_valid CHECK）。

  **boolean CHECK 补全（P1-4）**：除了 chat_message.hidden 和 llm_provider.is_builtin，还要给 `regex_rule.enabled` / `regex_rule.scope_user` / `regex_rule.scope_assistant` / `workplace_dir_rule.rule_enabled` 加 `CHECK(col IN (0,1))`。

  **下界 CHECK 补全（P2-3）**：顺带给 `head_count` / `tail_count`（CHECK >= 0）、`ref_count`（CHECK >= 0）、`seq`（CHECK >= 1）、`revision_version`（CHECK >= 1）加上下界约束——这些都在同一批 rebuild 表内，错过这次要等下次大 rebuild，所以一并纳入。

- Step 13 — phase-constraints — blocking: no — qa: auto：**修复发现 24（冗余索引 idx_vfs_entry_scope_path）**。在 `table-constraints-v1.ts` migration 里 `DROP INDEX IF EXISTS idx_vfs_entry_scope_path`（UNIQUE 隐式索引覆盖）。确认前缀 LIKE 查询走 UNIQUE 隐式索引（EXPLAIN 验证）。

### Phase 3：LIKE 搜索（方案选型）

- Step 14 — phase-like-search — blocking: no — qa: manual_user：**验证 RN 端 SQLite 版本 + FTS5 支持**。在 mobile 端跑 `SELECT sqlite_version()` 和 `SELECT * FROM pragma_compile_options WHERE compile_options LIKE '%FTS5%'`。确认 SQLite ≥ 3.34（trigram 分词器需要）。标注 `manual_user`（需 APK）。

- Step 15 — phase-like-search — blocking: no — qa: auto：**FTS5 + trigram POC（Node 端）**。如果 Step 14 确认版本达标，在 Node 端（better-sqlite3）建 FTS5 虚拟表 + trigram 分词器 + 同步触发器 POC，测中文搜索效果。验证 trigram 对中文的匹配语义是否可接受。

## 测试策略

### 测试用例

- T-GC1 — blocking: yes — 删文件后 revision + blob 被完全回收（→ Step 1，孤儿 GC）
- T-FK1 — blocking: yes — RN 驱动 open 后 foreign_keys=ON；desktop 显式 ON（→ Step 2）
- T-SC1 — blocking: yes — scanContents 500 文件 blob SELECT ≤ 2（→ Step 3）
- T-DEL1 — blocking: yes — vfs.delete 100 文件 SQL 总数 ≤ 20（→ Step 4）
- T-FK2 — blocking: yes — fork 40 消息 INSERT count = 1（→ Step 5）
- T-RB1 — blocking: yes — rollback 乐观锁步骤 SELECT 返回 1 行（→ Step 6）
- T-DEL2 — blocking: no — project.delete 100 文件 DELETE count = 1（→ Step 7）
- T-GC2 — blocking: no — blob GC 500 孤立 blob DELETE count = 1（→ Step 8）
- T-RP1 — blocking: no — integrity-repair 200 revision SELECT/UPDATE count ≤ 2（→ Step 9）
- T-WP1 — blocking: no — copyScope 50 dir + 50 file rule，DELETE count ≤ 2 + INSERT count ≤ 2；计数口径为 copyScope 整体 SQL 语句数（含前置 deleteScope 的 2 条 DELETE，见 Step 10）（→ Step 10）
- T-CT1 — blocking: yes — 脏值预扫描 + 清洗（→ Step 11）
- T-CT2 — blocking: yes — 16 表 rebuild 后约束生效（NOT NULL 拒 NULL、CHECK 拒非法值、WITHOUT ROWID 表无 rowid 列、boolean CHECK 拒非 0/1、下界 CHECK 拒负值）（→ Step 12）
- T-CT3 — blocking: yes — vfs_revision WITHOUT ROWID 后 GC 正常（→ Step 12，决策 4）
- T-IDX1 — blocking: no — DROP idx_vfs_entry_scope_path 后前缀 LIKE 查询走 UNIQUE 索引（→ Step 13）
- T-FT1 — blocking: no — RN SQLite 版本 + FTS5 支持（→ Step 14，manual_user）
- T-FT2 — blocking: no — FTS5 trigram 中文搜索 POC（→ Step 15）

### 验收矩阵

| Step | 测试用例 |
|---|---|
| 1 | T-GC1 |
| 2 | T-FK1 |
| 3 | T-SC1 |
| 4 | T-DEL1 |
| 5 | T-FK2 |
| 6 | T-RB1 |
| 7 | T-DEL2 |
| 8 | T-GC2 |
| 9 | T-RP1 |
| 10 | T-WP1 |
| 11 | T-CT1 |
| 12 | T-CT2, T-CT3 |
| 13 | T-IDX1 |
| 14 | T-FT1 |
| 15 | T-FT2 |

## 风险与回滚方案

### 风险

1. **rebuild migration 在大库上耗时长**（最高风险）。vfs_revision / chat_message 可能有几万行，rebuild 的 CREATE + INSERT + DROP + RENAME 要跑几秒到几十秒。migration 在 bootstrap 事务内跑，长事务持锁。缓解：migration 探测到已是目标形态直接 return（幂等），只跑一次；大库应在启动时给用户提示"正在升级数据库"。

2. **脏值清洗可能丢数据**（Step 11）。把非法 role 值改成默认值会丢失原始信息。缓解：清洗前打 warning + 日志记原始值；对于 role 只清成 `'user'`（最安全的默认），对于 hidden 清成 `0`。下界 CHECK 与 boolean 列同理，清洗的原始值都要进日志。

3. **vfs_revision WITHOUT ROWID + rowid 查询改写的正确性**（决策 4）。如果漏改了某处 rowid 引用，WITHOUT ROWID 后会运行时炸。缓解：grep 确认生产代码只有 `deleteUnreferencedUnderScope` 一处用 rowid（探索报告已确认）；改写后跑 revision GC 全套测试。

4. **FTS5 RN 端不可用**（Step 14-15）。如果 RN SQLite 版本 < 3.34 或 FTS5 没编译进去，FTS 方案落不了地。缓解：本 spec 不落地 FTS migration，只做验证；如果不可用，发现 3 退化到"维持现状 + 冗余文本列"过渡方案。

5. **发现 10b（reconcileVfsPaths 批量化）不在本 spec 范围**。rollback 的 (b) 点留后续——它是 rollback 26099 SQL 里的大头，但批量化难度太高（每条 path 不同 outcome）。本 spec 只修 (a) countBySession，rollback 仍有可观 N+1。文档里标注。

6. **orphan GC migration 在大库上 DELETE 耗时（P2-4）**。`DELETE FROM vfs_revision WHERE ref_count <= 0 AND entry_id NOT IN (SELECT entry_id FROM vfs_entry)` 在历史长、孤儿多的库上可能命中大量行，bootstrap 事务持锁时间随之增加。缓解：migration 内可分块 DELETE——每次 `DELETE ... LIMIT 500`（SQLite 支持 DELETE ... LIMIT，需确认编译选项；若不可用则用 `rowid` 范围分块），循环跑到 `changes() === 0` 退出；并在每块之间检查是否需要 yield。如果评估后认为分块带来的复杂度不值得，也可先记录观测数据，待真机大库 profile 后再决定。

### 回滚

- 每条 N+1 修复（Step 3-10）是纯代码改动，git revert 即回滚。
- migration（Step 1、11-13）一旦 apply 就不好回滚（rebuild 后旧形态消失）——但这正是目标（旧形态有 bug）。如果必须回滚，需要写 downgrade migration（rebuild 回旧形态）。
- **Phase 之间可独立合并**：P0（Step 1-2）可以先合并修正确性 bug；P1（Step 3-10）和 P2（Step 11-13）可以分开合并。P3（Step 14-15）是验证性工作，不影响生产代码。

## Context Bundle

```yaml
iteration_name: sql-cr-audit-2026-08
requirement_path: docs/Iterations/sql-cr-audit-2026-08/findings.md
spec_path: docs/Iterations/sql-cr-audit-2026-08/fix-spec.md
explore_summary: >
  三轮探索覆盖 N+1 修复路径、migration 机制 + DDL rebuild、正确性 bug + 测试约束。
  关键：migration rebuild 有 vfs-entry-id-redesign-v1 先例可参照；加 CHECK 必须预扫描脏值；
  发现 14 的 LEFT JOIN 不可行，需全局孤儿清扫；vfs_revision 切 WITHOUT ROWID 必须同步改 rowid 查询；
  FTS5 最大坑是中文分词需 RN 端真机确认。
impact_files:
  - packages/core/src/bootstrap/（migration + canonical DDL + BOOT_VERSION）
  - packages/core/src/domain/vfs/（contentStore + repository + GC）
  - packages/core/src/domain/chat/（message batchInsert + countBySession）
  - packages/core/src/domain/message-checkpoint/（revision GC）
  - packages/core/src/domain/workplace/（copyScope 批量 upsert）
  - packages/core/src/service/（vfs + chat + rollback）
  - packages/tdbc-driver-rn/src/driver.ts
  - packages/tdbc-driver-better-sqlite3/src/driver.ts
constraints:
  - v1.4.08 最低支持版本不变
  - migration 幂等（PRAGMA table_info 探测）
  - N+1 修复对齐 v1.4.24 batchAdjustRefCount 模式
  - DDL rebuild 前必须预扫描脏值
  - vfs_revision WITHOUT ROWID 必须同步改 rowid 查询
  - orphan-revision-gc-v1 必须排在 table-constraints-v1 之前注册（P1-5）
  - deleteVfsPrefix 改 recursive:true 必须保留空 prefix 静默返回语义（P1-1）
  - blob gc 签名改无参后必须同步删 runDeferredBlobGc 里的 collectAllReferencedHashes（P1-3）
  - 发现 4（seed-builtin-providers）不在本 spec 范围
  - 发现 10b（reconcileVfsPaths）不在本 spec 范围
  - FTS5 只做验证不落地 migration
blocking_steps: [1, 2, 3, 4, 5, 6, 11, 12]
```
