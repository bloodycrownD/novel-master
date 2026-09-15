---
date: 2026-09-15
agile_trace: true
---

# rollback-restore-deleted-entry 实现规格（SPEC）

## 根因 / 方案摘要

删除会物理删 `vfs_entry` 行（墓碑 revision 仍在、ref 被检查点钉住不被 GC），而回滚目标树 `loadFileTree` 以 INNER JOIN `vfs_entry` 反解 path——指针 `(entry_id, version)` 因 entry 行缺失而断链，被删文件进不了 targetTree，reconcile 两头落空，静默不复现。

方案：`message_checkpoint_file` 增存 `path` 快照列（capture 时冻结），读路径快照优先（entry 已删仍进 targetTree）；恢复原语支持按 checkpoint 的旧 entryId **复活** entry 行（显式 entry_id 插入 + head 指回目标版本），路径被新 entry 占用时先墓碑新 entry 再复活旧行。

## 变更点清单

| 提交 | 内容 |
|------|------|
| `30de0b82` | schema：`message_checkpoint_file` 加 `path TEXT NULL`；迁移 `add-mcp-file-path-snapshot-v1`（pragma 幂等探测 + ALTER TABLE + 存量行按 entry_id 回填现路径，entry 已删留 NULL；登记 SCHEMA_MIGRATIONS 阵尾，不 bump SCHEMA_BOOT_VERSION）；canonical DDL 同步加列 |
| `d894d56c` | 写路径：`MessageCheckpointInsertInput.files` / `seedCheckpoints` 参数加 `path` 必填，capture、backfillBaselineCheckpoints、seedForkCopyParity 三调用方从 `listSessionFileHeads` 的 logicalPath 传入；读路径：新增 `loadFilePointerTree`（`Map<path, {entryId, version}>`，快照非 NULL 优先、NULL 回退 LEFT JOIN 现路径），`loadFileTree` 保持旧形态由其派生，14 处既有调用零改动 |
| `81f24af0` | 恢复链路：新模块 `revive-deleted-entry.ts`（查 revision → put 幂等保 blob → 显式 entry_id 重建 entry 行 → `adjustRef(+1)`，对齐 resetHeadToVersion 的 oldVersion==null 分支）；repo 新增 `reviveEntryAtVersion`（显式插 INTEGER PRIMARY KEY，SQLite AUTOINCREMENT 表允许且自动推高 sqlite_sequence，entry-sequence-repair 启动期兜底 seq 不回退）；`restorePathToRevision`/`WithBackfill` 支持 checkpointEntryId（显式参数 + prefetch map）；`resolveReconcilePathSets`、`findMissingRevisionPointers` 对 entry 已删路径改按 checkpoint 旧 entryId 寻址，行在即非 missing；`resolveRollbackTargetTree`/`resolvePriorRollbackTargetTree` 返回 `{tree, entryIdByPath}` 穿线进 rollback plan |
| `7c92d7ab` | 实现期发现的两处修正：①同路径异 entry 时 live 与 checkpoint 指针分属两个独立版本空间，`v1==v1` 的 same_version / same_content_hash 短路会误判（回滚后留新内容），reconcile 与 restore 两侧加「同源判定」，diverged 时短路失效直接走墓碑+复活；②`reconcileVfsPaths` 清场（pathsNeedDelete）提前到写盘（pathsNeedWrite）之前，否则 rename 后回滚同一 entry 挂两路径、先复活撞 entry 主键；另 seed 列前缀补正 |
| `28d59c9b` | 测试：RB4b 拆分（纯删除复现 / 手工删 revision 行维持降级）、无 backfill 选项不抛 BACKFILL_REQUIRED、同路径重建（含 sqlite_sequence 不回退断言）、目录多文件递归删除、rename 快照语义、迁移四段式；`revive`/`restore-path-model`/`ensure-directory-chain` 拆模块消循环依赖 |

## 详细改动说明

- **同路径重建语义（拍板）**：按「回滚后工作区正文 = 目标检查点完成态」——旧内容回来、tail 期重建的同路径文件（新 entry）被墓碑回退。复活后 path 归旧 entry 所有，mcf 旧指针与 entry 链保持自洽。
- **GC 安全**：anchor 检查点行存在期间其 `(entryId, version)` ref_count ≥ 1，sweep 不删要恢复的 revision；`deleteGlobalOrphans` 只删 ref_count≤0。blob 由 `contentStore.put` 幂等复用（触发器 ref 维护不变）。
- **降级边界**：revision 行真缺失（非 entry 缺失）维持 `sessionFsRestoreRevisionMissing` 降级；无 path 快照的存量 mcf 行回退 JOIN 现路径，等同旧形态（修复对「迁移后才 capture 的检查点」完整生效）。

## 测试策略

- 基线先行：改动前 `test:msg` 等价套件 25 套件 / 112 用例全绿。
- 结果：message-checkpoint + bootstrap 43 套件 / 184 用例全绿；叠加 session-fs + vfs 102 套件 / 471 用例全绿；core 全量 442 套件 / 2126 用例全绿；typecheck 通过。主代理复核抽样（vfs + message-checkpoint + workplace）495/495。
- 新增文件：`rollback-restore-deleted-entry.test.ts`（184 行）、`add-mcp-file-path-snapshot-v1.test.ts`（四段式迁移测试）。

### 测试用例

1. 纯删除 → 回滚 → `/gone.md` 复现 anchor 内容（RB4b 主断言翻转）；
2. 手工删 revision 行变体 → 维持降级 NOT_FOUND（不阻断回滚）；
3. 删除 → 同路径重建 → 回滚 → 旧内容回来、新 entry 墓碑、再次新建 entry_id 不撞（sqlite_sequence 不回退）；
4. 目录多文件递归删除 → 回滚 → 全部复现；
5. rename 后回滚 → 文件回到 capture 时点路径（快照语义）；
6. 迁移：up 直调语义（加列/回填/幂等二跑）、快路径场景、bootstrapNovelMaster 集成、登记阵尾顺序。

## 行为变更（有意修正）

- **rename 快照语义**：历史 checkpoint 的路径从「跟随 entry 现路径」变为「冻结 capture 时点路径」。rename 后回滚，文件回旧路径（锚点完成态）、现路径清除。全测试套件检索确认无用例固化旧预期，新增用例固化新语义。
- **断言翻转 3 处**：RB4b（误固化的 NOT_FOUND）、R-BC2（原断言「/新文件.md 保留」依赖 INNER JOIN 断链的副产品——prior tree 变空树歪打正着触发 anchor 兜底；修复后 prior tree 完整，回滚正确恢复消息 3 完成态：`/old.md` 复活、`/新文件.md` 被删）、add-smart-sort 阵尾断言改为顺序断言。

## 风险与回滚方案

- 迁移仅加可空列 + 回填，不动 PK/数据；回滚分支整体 revert 即可恢复旧行为（mcf.path 列留存无害）。
- 显式 entry_id 插入无生产先例，但有 sqlite_sequence 自动推高 + entry-sequence-repair 启动兜底 + 测试断言三重保障。
- 影响面收敛在 core 回滚链路，双端无直接依赖 checkpoint 表结构（grep 确认 apps/ 无引用）。
