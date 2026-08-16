# Rollback reconcileVfsPaths 批量化（发现 10b 遗留）

> **类型**：性能（N+1 批量化）  
> **来源**：`docs/Iterations/sql-cr-audit-2026-08/findings.md` 发现 10 的 (b) 部分；`fix-spec.md` 决策 2 明确留后续  
> **状态**：open（2026-08-16 登记）  
> **关联迭代**：`sql-cr-audit-2026-08`（wt-B 侧）；`replace-quick-sqlite`（真机验证时再次暴露）

## 问题

`sessionFs.rollbackToMessage` 的 VFS 对齐阶段 `reconcileVfsPaths` 仍是**逐路径处理**，是 rollback SQL 次数的大头。

审计 harness 实测（2026-08-12，node / better-sqlite3）：**2000 文件会话回滚一次 = 26099 次 SQL，约 1.3s**。真机（op-sqlite，每语句一次 JSI 往返 + 16ms 量子让步）放大明显——大文件量会话回滚的体感耗时主要来自这里。

## 现状（2026-08-16 复核）

`packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts`：

- ✅ 10a 已修：乐观锁 `listBySession` → `countBySession`（不再拉全量消息行）。
- ✅ prefetch 已有：`findMetasByEntryVersions` / `findContentHashesByPaths` 一次性预取，消掉了逐 path 的 meta/hash 查询。
- ❌ 核心循环仍逐 path（L406-448）：
  - `pathsNeedWrite`：每条路径走 `restorePathToRevision`（或 backfill 变体）→ 内部 `vfs.write`，每次写带自己的 SQL 序列（entry upsert、revision append、ref_count、blob ensure）。
  - `pathsNeedDelete`：每条路径 `deletePathIfExists` → `vfs.delete`（墓碑 revision、ref 降级、GC 探测）。

## 为什么当批量化难（留后续的原因）

每条 path 的 outcome 不同（`skipped_same_version` / `skipped_same_content_hash` / `restored` / `deleted`），且 restore 可能触发 head backfill（append 新 revision），路径间有依赖。`vfs.write` / `vfs.delete` 走 service 层，各自封装了完整 SQL 序列，不像 checkpoint seed 那样是同构行可以一条多值 INSERT 打包。

## 修复方向（候选）

1. **按 outcome 分组批量化**：先用已有 prefetch 把全部 path 分类（same_version / same_hash / need_restore / need_delete），再对每类走批量路径——restore 类合并为「批量 entry upsert + 批量 revision append + 批量 ref_count」（复用 `batchAppendWithRefCount`、`insertMultiValues` 模式），delete 类复用 `sweepRevisionsUnderScope` 思路按前缀/集合批量。
2. **执行计划拆阶段**：把 backfill 场景单独评估（它天然路径间有依赖，可能保留逐条，先吃掉非 backfill 主路径）。
3. 验收基准：复用 `packages/core/test/session-copy.perf.ts` 模式写 rollback 基准，2000 文件场景 SQL 次数从 26099 降到 O(文件数/块) 量级；真机体感回滚进入亚秒级。

## 关联数据点

- 2026-08 集成分支已把 session.copy 的同类问题打掉（`seedCheckpoints` 多值 INSERT、`seedForkCopyParity` 批量 revision），rollback 是最后一块大头。
- findings.md L1011 盲区提醒：触发器内部的 blob ref 维护 SQL 不经 TdbcConnection，harness 统计偏乐观——批量化后的真实收益要用真机体感 + harness 双口径确认。
