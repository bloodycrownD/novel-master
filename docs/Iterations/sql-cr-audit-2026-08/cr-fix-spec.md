---
date: 2026-08-12
status: fix-spec-ready
review_round: 2
dag_version: 3
---

# SQL CR 审计修复 Fix-Spec（cr-fix-spec）

本 SPEC 是 `docs/Iterations/sql-cr-audit-2026-08/fix-spec.md`（业务 Spec / PRD，只读参考）的 CR 修复执行规格。本 wave 范围：**全部 3 P1 + 12 P2 must-fix**，全部写入本文档；不改业务 spec，不改实现代码。

## 设计目标

本轮 CR 审计（`sql-cr-audit-2026-08`）分两个 worktree 落地原业务 spec：

- **wt-A**：`.woktree/sql-fix-migration`，分支 `feat/sql-fix-migration`，base `bc18100` → head `c784ca0`，承接 schema-migration / 约束 / orphan GC 一侧。
- **wt-B**：`.woktree/sql-fix-n-plus-1`，分支 `feat/sql-fix-n-plus-1`，base `bc18100` → head `e101931`，承接 N+1 / 批量化 / 聊天批量插入一侧。

CR 评审（round 1 / dag v2）在这两条链上分别识别出 must-fix，本文档把 15 条（3 P1 + 12 P2）全部登记、定改法、定验收、标注落点 worktree，作为后续逐条修复的执行依据。

**三条主线**（沿用业务 spec）：正确性止血（P1 优先）、可维护性收敛（DRY / 死代码 / 命名）、测试覆盖补齐（G 维度）。

## 元信息

| 字段 | 值 |
|------|-----|
| repo | `/home/bloodycrown/Dev/novel-master` |
| wt-A | `.woktree/sql-fix-migration`，`bc18100` → `c784ca0`，分支 `feat/sql-fix-migration` |
| wt-B | `.woktree/sql-fix-n-plus-1`，`bc18100` → `e101931`，分支 `feat/sql-fix-n-plus-1` |
| review_round | 1 |
| dag_version | 2 |
| status | draft |
| 业务 Spec | `docs/Iterations/sql-cr-audit-2026-08/fix-spec.md`（只读） |
| 评审来源 | `docs/Iterations/sql-cr-audit-2026-08/findings.md` + round 1 scope 评审 |

## 总体方案

### 波次编排：P1 止血 → P2 收敛

15 条 must-fix 按 P1 / P2 两波执行。P1 三条是正确性 + 明显死代码 / 重复，必须先合；P2 十二条是 DRY、命名一致性、注释准确性、测试覆盖补齐，可并行。

| 波次 | 主题 | 含条目 | 落点 |
|------|------|--------|------|
| wave-P1 | 正确性止血 + 死代码 / 重复收敛 | cr-p1-1 / cr-p1-2 / cr-p1-3 | wt-A ×1，wt-B ×2 |
| wave-P2 | DRY + 命名 + 注释 + 测试覆盖 | cr-p2-1 ~ cr-p2-12 | wt-A ×5，wt-B ×7 |

跨 worktree 的条目（cr-p1-2 涉及全 workspace typecheck）在合并前必须跨链验证，见「风险与回滚」。

### 关键决策（来自 must-fix 改法）

- **cr-p1-1 把 DROP INDEX 提到早退之前**——`IF EXISTS` 天然幂等，老库 / 新库两条路径最终态对齐，无需额外探测。
- **cr-p1-2 删除 `collectAllReferencedHashes`**——grep 确认生产侧已无调用方（`deferred-blob-gc.ts` 只调无参 `gc()`），删比留 `@deprecated` 更干净；测试侧 mock 需同步清理。
- **cr-p1-3 复用而非合并**——`n-plus-1-counting-connection.ts` 只留轻量 `CountingConnection` 装饰器，boot helper 统一走 `openSqlCountingNovelMasterTestConnection()`，消除第三份手写 boot 流程。
- **cr-p2-1 抽共享 SQL 常量**——migration `up` 与 repository `deleteGlobalOrphans` 引用同一份 `ORPHAN_REVISION_GC_SQL`，改 WHERE 条件只动一处。
- **cr-p2-9 约定 `batchXxx` 前缀为准**——对齐 v1.4.24 的 `batchAdjustRefCount`；`deleteRecursiveIfAny` 作为语义型命名保留，加注释说明例外。

## Must-Fix 清单

> 每条字段：id / 严重度 / 维度 / 文件 / 问题 / 改法 / 验收·测试 / 来源 / 落点 worktree。

### Wave P1（3 条）

#### cr-p1-1 [P1] 新库路径冗余索引 `idx_vfs_entry_scope_path` 不被 DROP

- **严重度**：P1
- **维度**：A（正确性） + C-orch（编排一致性）
- **文件**：`packages/core/src/bootstrap/schema-migrations/table-constraints-v1.ts`
- **落点**：wt-A（`feat/sql-fix-migration`）
- **问题**：`up` 函数里 `DROP INDEX IF EXISTS idx_vfs_entry_scope_path` 写在 `isAlreadyConstrained(tx)` 早退（L615 `return`）**之后**（L624）。新库（`BOOT_VERSION` 6）会被前置的 `vfs-entry-id-redesign-v1` 的 Path B（`rebuildIndexes`）建出这个冗余索引；而新库走到 `table-constraints-v1` 时探测到已是目标形态（`WITHOUT ROWID`），直接 return，那条 DROP 永远不执行。结果：老库迁移后冗余索引被清掉，新库却永久保留——两条 bootstrap 路径最终态不一致。（已核验：早退 L615，DROP L624，顺序确认。）
- **改法**：把 `DROP INDEX IF EXISTS idx_vfs_entry_scope_path` 移到 `isAlreadyConstrained` 早退**之前**。`IF EXISTS` 保证幂等——对老库（索引已随 `DROP TABLE` 带走）是 no-op，对新库正好补上这一刀。
- **验收·测试**：新库 bootstrap 完成后 `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_vfs_entry_scope_path'` 返回空行；老库迁移跑完同样返回空。补一条断言覆盖新库路径（当前测试只覆盖了老库迁移路径）。
- **来源**：review-scope-constraints / round 1

#### cr-p1-2 [P1] `collectAllReferencedHashes` 变 dead code 未清理

- **严重度**：P1
- **维度**：C（死代码）
- **文件**：`packages/core/src/domain/vfs/content-store/vfs-content-store.port.ts`、`packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts`
- **落点**：wt-B（`feat/sql-fix-n-plus-1`）；合并前需跨全 workspace typecheck
- **问题**：`gc` 改成无参之后，`collectAllReferencedHashes` 的唯一生产调用方 `deferred-blob-gc.ts` 不再调它（已核验：该文件只调 `contentStore.gc()`）。端口声明（L45）+ sqlite 实现（L226）都还留着，变成 dead code，新人看到会误以为它仍参与 GC 路径。
- **改法**：grep 确认全 workspace 无其他**生产**调用方后，删除端口方法声明 + sqlite 实现。注意：测试侧仍有 mock 引用（`rollback-version-short-circuit.test.ts:32`、`rollback-ref-count.test.ts:40` 用它构造 mock store），删端口方法时这些 mock 要一起清掉，否则 typecheck 挂。若探到 diagnostic / 调试脚本引用，退而求其次改 `@deprecated` 注释标注 sunset。
- **验收·测试**：删除后 build 通过——core 自测 + 全 workspace `typecheck` 确认无残留引用（含测试 mock）。或标注方案下 grep 确认 `@deprecated` 注释存在。
- **来源**：review-scope-vfs-n1 / round 1

#### cr-p1-3 [P1] SQL 计数 helper 重复（两份拷贝 + 测试各自手写 boot 流程）

- **严重度**：P1
- **维度**：C（DRY）
- **文件**：`packages/core/test/helpers/sql-counting-connection.ts`、`packages/core/test/vfs/n-plus-1-counting-connection.ts`
- **落点**：wt-B（`feat/sql-fix-n-plus-1`）
- **问题**：两个 SQL 计数 helper 几乎是同一套东西的两份拷贝。`vfs-n-plus-1-fixes.test.ts` 和 `vfs-repair-ref-count-batch.test.ts` 没复用 `openSqlCountingNovelMasterTestConnection()`，各自手写约 60 行 open + bootstrap + 建 service 的流程。改一处 boot 步骤很容易漏掉另一处。
- **改法**：`n-plus-1-counting-connection.ts` 只保留 `CountingConnection` 装饰器（轻量、可复用），把它复用到 `sql-counting-connection.ts` 的 boot helper 里；两个 N+1 测试文件改调 `openSqlCountingNovelMasterTestConnection()`，删掉各自的手写 boot 流程。
- **验收·测试**：改动后 `vfs-n-plus-1-fixes.test.ts`、`vfs-repair-ref-count-batch.test.ts`、`orphan-revision-gc.test.ts` 三个文件仍全绿；grep 确认全 workspace 不再有第三份手写 boot 流程（`openSqlCountingNovelMasterTestConnection` 为唯一入口）。
- **来源**：review-scope-vfs-n1 / round 1

### Wave P2（12 条）

#### cr-p2-1 [P2] orphan GC migration SQL 与 `deleteGlobalOrphans` SQL DRY

- **严重度**：P2
- **维度**：C（DRY）
- **文件**：`orphan-revision-gc-v1.ts` + `sqlite-vfs-revision.repository.ts`
- **落点**：wt-A
- **问题**：两条逐字相同的 DELETE SQL 各自维护一份，以后改 WHERE 条件很容易只改一边、漏另一边。
- **改法**：抽共享常量 `ORPHAN_REVISION_GC_SQL`，migration 的 `up` 和 repository 的 `deleteGlobalOrphans` 都引用同一份。
- **验收·测试**：grep 确认该 DELETE SQL 在仓库里只有一处定义；migration 与 repository 行为不变（跑 orphan GC 回归用例）。
- **来源**：review-scope-orphan-gc / round 1

#### cr-p2-2 [P2] `orphanRevisionGcV1Up` 死导出

- **严重度**：P2
- **维度**：C（死代码）
- **文件**：`orphan-revision-gc-v1.ts`（+ `index.ts` re-export 惯例核对）
- **落点**：wt-A
- **问题**：`export { up as orphanRevisionGcV1Up }` 全仓无 import，是悬空导出；同时 `ORPHAN_REVISION_GC_V1_ID` 未从 `index.ts` re-export，与其他 migration（如 `VFS_ENTRY_ID_REDESIGN_V1_ID`）的导出惯例不一致。
- **改法**：删掉 `orphanRevisionGcV1Up` 导出（若 cr-p2-1 已抽共享常量，`up` 只 migration 自己用，不需要对外暴露）。`ORPHAN_REVISION_GC_V1_ID` 按 `VFS_ENTRY_ID_REDESIGN_V1_ID` 的惯例从 `index.ts` re-export，或明确决定不导出并在文件头注释说明。
- **验收·测试**：build 通过；grep 确认无悬空导出（`orphanRevisionGcV1Up` 在 import 侧零命中）。
- **来源**：review-scope-orphan-gc / round 1

#### cr-p2-3 [P2] T-GC1 测试边界覆盖不足（部分删、无孤儿）

- **严重度**：P2
- **维度**：G（测试覆盖）
- **文件**：`packages/core/test/vfs/orphan-revision-gc.test.ts`
- **落点**：wt-A
- **问题**：T-GC1 只覆盖了「全部文件删除」一种边界，缺部分删（混合存活与孤儿）和无孤儿（sweep 返回 0 且不动存活 revision）两个场景。
- **改法**：补两个用例——(1) 造 10 个文件删掉 5 个，断言被删那侧的孤儿 revision 被清掉、存活那侧的 revision 不受影响；(2) 全部存活时跑一次 sweep，断言返回 0 且 revision 行数不变。
- **验收·测试**：新增两条用例通过。
- **来源**：review-scope-orphan-gc / round 1

#### cr-p2-4 [P2] 下界清洗可能引发 PK / UNIQUE 冲突

- **严重度**：P2
- **维度**：B（正确性·边界）
- **文件**：`packages/core/src/bootstrap/schema-migrations/table-constraints-v1.ts`
- **落点**：wt-A
- **问题**：`seq < 1 → seq = 1`、`version < 1 → version = 1` 的清洗，可能撞上已存在的合法行 PK / UNIQUE，导致 rebuild 阶段 INSERT 失败。触发概率极低，但一旦踩中 migration 会卡死。
- **改法**：二选一——(A) 清洗后额外跑一轮下界冲突检测：对清洗成下界值的行，若同一 key 已有合法行，则 discard 脏行或挪到 `MAX+1`；(B) 走轻量方案，在 warning 日志里标注「若 rebuild 因 PK 冲突失败，需人工处理 `seq=0` / `version=0` 脏行」。推荐先 B（概率低、改动小），有真实命中再升级到 A。
- **验收·测试**：造 `seq=0` + `seq=1` 同 session 脏数据跑一次 migration，断言不卡死（A 方案断言脏行被 discard / 挪位；B 方案断言 warning 输出存在且 migration 完成）。
- **来源**：review-scope-constraints / round 1

#### cr-p2-5 [P2] `message_checkpoint_file` 缺 WITHOUT ROWID 断言

- **严重度**：P2
- **维度**：G（测试覆盖）
- **文件**：`packages/core/test/bootstrap/table-constraints.test.ts`
- **落点**：wt-A
- **问题**：T-CT2 验证了 3 张表的 `SELECT rowid` 被拒，漏了第 4 张 WITHOUT ROWID 表 `message_checkpoint_file`。
- **改法**：补一条断言 `assert.rejects(() => conn.query('SELECT rowid FROM message_checkpoint_file LIMIT 1'), ...)`，与现有 3 张表断言同处。
- **验收·测试**：新断言通过（`SELECT rowid` 确实被拒）。
- **来源**：review-scope-constraints / round 1

#### cr-p2-6 [P2] `getMany` 的 `CHUNK_SIZE` 硬编码在函数内

- **严重度**：P2
- **维度**：C（风格一致性）
- **文件**：`packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts`
- **落点**：wt-B
- **问题**：`getMany` 内 `const CHUNK_SIZE = 500` 是 local const，而同模块的 `REVISION_BATCH_CHUNK_SIZE` / `REVISION_REPAIR_CHUNK_SIZE` 都是模块级命名常量。风格不统一，读起来像临时魔数。
- **改法**：提到模块级 `const CONTENT_GETMANY_CHUNK_SIZE = 500`，命名对齐同模块既有惯例。
- **验收·测试**：build 通过，`getMany` 相关测试不退化。
- **来源**：review-scope-vfs-n1 / round 1

#### cr-p2-7 [P2] T-GC2 revision 侧 SELECT 断言缺失

- **严重度**：P2
- **维度**：G（测试覆盖）
- **文件**：`packages/core/test/vfs/vfs-n-plus-1-fixes.test.ts`
- **落点**：wt-B
- **问题**：T-GC2 的第三断言只拦了 `SELECT content_hash FROM vfs_entry`，没拦 `SELECT content_hash FROM vfs_revision`。`collectAllReferencedHashes` 原本会发两条 SELECT，只断了一条，另一条若回退没法被测试抓住。
- **改法**：断言改为同时检查 entry 和 revision 两条 SELECT 都不再被独立发出。注意与 cr-p1-2 的关系——若 cr-p1-2 已删 `collectAllReferencedHashes`，这两条 SELECT 从根上消失，断言是双保险；若 cr-p1-2 退而标注 `@deprecated`，这条断言就是唯一的回归网。
- **验收·测试**：断言生效（人为回退 revision 侧 SELECT 时测试能挂出来）。
- **来源**：review-scope-vfs-n1 / round 1

#### cr-p2-8 [P2] `deleteRecursiveIfAny` 返回值语义

- **严重度**：P2
- **维度**：B / C（语义准确性）
- **文件**：`packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts`
- **落点**：wt-B
- **问题**：返回的是探测阶段拿到的 `entries.length`，不是 `delete()` 的 `result.changes`。端口注释写「@returns 实际删除的行数」，实现返回的却是探测行数。今天两者必然相等（探测与删除在同一 scope + prefix 内），但措辞对不上，未来一旦分离就会出错。
- **改法**：优先 (A) 让 `delete()` 透出 `changes` 回填返回值（最准，注释不动）；若 `delete()` 不便透出，退 (B) 改端口注释为「探测命中的行数（与实际删除一致：探测与删除在同一 scope+prefix 内）」。
- **验收·测试**：方案 A 下，返回值与 `changes()` 严格一致（造一批 entry 断言等值）；方案 B 下，注释与实现描述对齐。
- **来源**：review-scope-vfs-n1 / round 1

#### cr-p2-9 [P2] batch 命名风格不统一

- **严重度**：P2
- **维度**：C-orch / C（命名一致性）
- **文件**：多文件（含 `sqlite-vfs-entry.repository.ts`、`sqlite-vfs-content-store.ts` 等）
- **落点**：wt-B
- **问题**：新增的批量方法三种命名风格混用：`batchAdjustRefCount`（batch 前缀）、`repairRefCountFloorBatch`（Batch 后缀）、`deleteRecursiveIfAny`（无 batch 标记）。
- **改法**：约定 `batchXxx` 前缀为统一风格（对齐 v1.4.24 的 `batchAdjustRefCount`）。`repairRefCountFloorBatch` 评估改名 `batchRepairRefCountFloor`。`deleteRecursiveIfAny` 保留——语义型命名比硬塞 batch 更清楚，加一行注释说明它是约定例外。
- **验收·测试**：build 通过；命名约定写入对应文件头或方法注释。
- **来源**：review-scope-vfs-n1 / round 1

#### cr-p2-10 [P2] T-FK2 消息内容验证缺失

- **严重度**：P2
- **维度**：G（测试覆盖）
- **文件**：`packages/core/test/chat/fork-copy-batch-insert.test.ts`
- **落点**：wt-B
- **问题**：T-FK2 只断言 `forkedMsgs.length === MSG_COUNT`，没校验消息内容（seq / role / content / hidden）是否被正确复制。数量对但内容错的情况抓不住。
- **改法**：fork 用例补遍历 `forkedMsgs`，逐条比对 seq / role / content / hidden 与源一致；copy 用例同理补内容校验。
- **验收·测试**：新断言通过；人为篡改一条 content 时测试能挂出来。
- **来源**：review-scope-chat-n1 / round 1

#### cr-p2-11 [P2] `batchUpsert` 注释与实现不符

- **严重度**：P2
- **维度**：C（注释准确性）
- **文件**：`packages/core/src/domain/workplace/repositories/workplace.port.ts`
- **落点**：wt-B
- **问题**：端口注释写「本方法只做 INSERT，不重复 DELETE」，但实现是 `INSERT ... ON CONFLICT DO UPDATE`（upsert 语义）。注释会误导未来调用方以为是无脑追加。
- **改法**：注释改成「走 `INSERT ... ON CONFLICT DO UPDATE`（upsert 语义）；调用方若想要覆盖式写入，需先清空目标 scope」。
- **验收·测试**：注释与实现一致（人工核对 + grep 确认注释关键词 `ON CONFLICT` / `upsert` 出现）。
- **来源**：review-scope-chat-n1 / round 1

#### cr-p2-12 [P2] batch SQL 与单条 SQL DRY 注释

- **严重度**：P2
- **维度**：C（DRY）
- **文件**：`packages/core/src/domain/workplace/repositories/impl/sqlite-workplace.repository.ts`
- **落点**：wt-B
- **问题**：`batchUpsert` 的 SQL 与单条 `upsert` 的 SQL 各是一份近似字符串（一份 `#{}` 模板，一份 `?` 占位），改一处忘另一处就会 drift。
- **改法**：给 batch 版加注释指明「SQL 与 `upsertDirRule` 保持一致，改一处同步另一处」（参照 chat 侧 `MESSAGE_INSERT_SQL` + `toMessageParams` 的提取模式）。本轮先打标记防 drift，是否抽公共模板留给后续迭代。
- **验收·测试**：注释存在（grep 确认关键词）。
- **来源**：review-scope-chat-n1 / round 1

## 测试策略

### 测试原则

- 每条 must-fix 都有对应验收（build / grep / 新断言 / 回归用例四类之一）。
- P1 三条验收必须在各自 worktree 合并前全绿；cr-p1-2 额外要求跨全 workspace typecheck。
- 测试覆盖类（cr-p2-3 / cr-p2-5 / cr-p2-7 / cr-p2-10）的新断言需做成「能挂出来」的真断言，不能是恒真表达式。

### 验收用例汇总

| 用例 | 关联条目 | 落点 | 内容 |
|------|----------|------|------|
| T-CT1 | cr-p1-1 | wt-A | 新库 bootstrap 后 `idx_vfs_entry_scope_path` 在 `sqlite_master` 中查不到；老库迁移后同样查不到 |
| T-CT2 | cr-p2-5 | wt-A | `message_checkpoint_file` 的 `SELECT rowid` 被拒（补第 4 张表） |
| T-CT3 | cr-p2-4 | wt-A | `seq=0` + `seq=1` 同 session 脏数据下 migration 不卡死 |
| T-GC1 | cr-p2-3 | wt-A | 部分删（混合存活与孤儿）+ 无孤儿（sweep 返回 0）两个新用例 |
| T-GC2 | cr-p2-7 | wt-B | revision 侧 `SELECT content_hash` 断言补齐（与 cr-p1-2 联动） |
| T-DC1 | cr-p1-2 | wt-B | 删 `collectAllReferencedHashes` 后全 workspace typecheck 通过、测试 mock 同步清理 |
| T-DC2 | cr-p2-1 / cr-p2-2 | wt-A | grep 确认 orphan GC DELETE SQL 单一来源、`orphanRevisionGcV1Up` 无悬空 import |
| T-N1 | cr-p1-3 | wt-B | 三个计数测试复用 `openSqlCountingNovelMasterTestConnection()`，全绿 |
| T-N2 | cr-p2-6 | wt-B | `CONTENT_GETMANY_CHUNK_SIZE` 提模块级，getMany 测试不退化 |
| T-N3 | cr-p2-8 | wt-B | `deleteRecursiveIfAny` 返回值 = `changes()` |
| T-N4 | cr-p2-9 | wt-B | batch 命名约定 `batchXxx`，注释记录例外 |
| T-FK2 | cr-p2-10 | wt-B | fork / copy 用例补 seq / role / content / hidden 逐条比对 |
| T-WP1 | cr-p2-11 / cr-p2-12 | wt-B | `batchUpsert` 注释改 upsert 语义；batch SQL 加 DRY 同步注释 |

## 风险与回滚方案

### 高风险项

0. **【合并前硬门槛（merge gate）】cr-p1-2 跨 workspace `gc()` 签名 breaking change**：删 `collectAllReferencedHashes` 是接口收敛，下游 mock（`rollback-version-short-circuit.test.ts`、`rollback-ref-count.test.ts`）会同步报错。review-full 已确认影响面完全收敛在 core 包内部（port + impl + deferred-blob-gc + 两个测试 mock），不跨 workspace。但合并前仍**必须**跑全 workspace `typecheck` 且零 error，否则退回 `@deprecated` 方案，不得硬合（见 OQ-3 / OQ-4）。

0b. **两 worktree 同改 `vfs-revision.port.ts` + `sqlite-vfs-revision.repository.ts`**：wt-A 改了 `deleteUnreferencedUnderScope`（rowid→PK）+ 加 `deleteGlobalOrphans`；wt-B 加了 `repairRefCountFloorBatch`。两边 hunk 不重叠（wt-A 在文件末尾、wt-B 在 L36/L404 区域），git 应能自动合并。合并顺序建议先合 wt-A（schema 一侧），再合 wt-B（N+1 一侧）；合并后**必须重跑 core 全套测试**（尤其 orphan-revision-gc + vfs-repair-ref-count-batch + vfs-n-plus-1-fixes 三套），确认同文件两处改动语义自洽。
2. **cr-p1-1 DROP INDEX 前置的幂等性**：依赖 `IF EXISTS` 对老库是 no-op。回滚方案：若发现老库该索引实际未被 `DROP TABLE` 带走（与「发现 24」注释假设冲突），改为显式探测后再 DROP。
3. **cr-p2-4 下界冲突概率**：真实命中概率极低，B 方案（warning）可能掩盖问题。回滚方案：若发版后有用户报 PK 冲突，立刻升级到 A 方案（discard / 挪位）。
4. **cr-p2-9 改名波及面**：`repairRefCountFloorBatch` 改名 `batchRepairRefCountFloor` 可能撞到测试或调用点。回滚方案：若改名牵连面大，保留原名、仅在注释里登记命名约定。

### 回滚原则

- 两条 worktree 链独立可回滚——P1 不绿不合并，P2 单条挂了不阻塞同 wave 其他条目。
- cr-p1-2 / cr-p2-1 涉及接口与共享 SQL，回滚时必须连同测试 mock / 引用点一起回退，不能只回 src。
- 任何「删导出 / 删方法」类改动（cr-p1-2、cr-p2-2），回滚后必须重跑全 workspace typecheck 确认无残留引用。

## 附录 A：open_questions（不阻塞）

- **OQ-1** `deleteGlobalOrphans` 每次全表扫的开销：revision GC 不在热路径，先观测实际库规模下的耗时，暂不分块。
- **OQ-2** 大库分块 DELETE：业务 spec 已接受延后，本 wave 不做。
- **OQ-3** 跨 workspace `gc()` 签名 breaking change：review-full 确认影响面收敛在 core 包内部（不跨 workspace），但仍作为**合并前硬门槛**——cr-p1-2 落地后、wt-B 合并前，必须跑全 workspace `typecheck` 且零 error，否则退回 `@deprecated` 方案。详见风险段 #0。
- **OQ-4** `collectAllReferencedHashes` 留不留：与 cr-p1-2 关联，结论是删更干净（生产侧已无调用方）。

## 附录 B：spec_deviations

- **SD-1** Step 10 `batchUpsert` DELETE 策略：业务 spec 自身前后矛盾，实现取了更自洽的做法（前置 `deleteScope` + batch `INSERT ... ON CONFLICT`），不算偏离；cr-p2-11 / cr-p2-12 是把注释对齐到这套实现。
- **SD-2** `collectAllReferencedHashes` 方法本体保留与否：业务 spec 上下文是说删「调用方」，方法本身是否删未明确；本 wave 落 cr-p1-2，裁决为删（生产侧已无调用方）。
