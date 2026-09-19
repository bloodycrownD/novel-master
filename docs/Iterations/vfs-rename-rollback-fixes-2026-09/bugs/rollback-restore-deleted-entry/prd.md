---
date: 2026-09-15
dependency: iterations/vfs-rename-rollback-fixes-2026-09/prd.md
---

# rollback-restore-deleted-entry Bug PRD

## 背景

项目设计预期「回滚后工作区正文 = 目标检查点完成态」（`docs/Iterations/message-rollback-execution-redesign/prd.md` 语义合同；`chat-rollback-vfs-tool-fixes/prd.md` 验收明确「P1 被删除后回滚 worktree 恰好包含 P1、P2」）。但实际行为是删除后的文件回滚不回来，且无任何报错——静默丢失。

## 现象描述

删除一个文件（双端文件管理 UI 手动删除，或 agent 的 fs/rm 工具删除，两者同源），随后对更早的消息发起回滚（rollback），预期被删文件随回滚复现，实际文件没有回来，回滚本身报告成功。

## 复现步骤

1. 会话中创建文件 `/gone.md` 并产生至少一轮对话（checkpoint 捕获该文件）；
2. 在文件管理中删除 `/gone.md`；
3. 对删除前的消息发起回滚；
4. 观察：`/gone.md` 未复现，回滚无报错。

## 预期行为

回滚后工作区恢复为目标检查点完成态：`/gone.md` 复现且内容为锚点检查点时点的内容；删除后同路径重建的文件，回滚到重建之前时旧内容回来、重建内容被回退。

## 实际行为

- 所有删除走 `deleteWithRevision`：写 `status='deleted'` 墓碑 revision 后**物理 DELETE `vfs_entry` 行**；
- 回滚目标树 `loadFileTree` 用 INNER JOIN `vfs_entry` 反解 path——entry 行没了，该文件的 checkpoint 指针 `(entry_id, version)` 进不了 targetTree；
- reconcile 的 `pathsNeedWrite`（只遍历 targetTree）与 `pathsNeedDelete`（只遍历 live 树）两头都不命中；
- 结果：回滚事务成功提交、文件静默不复现。既有测试 RB4b（`rollback-revision-backfill.test.ts`）还把「回滚后 read 抛 NOT_FOUND」固化成了预期断言。

## 影响范围

- 所有「锚点检查点记录过、之后被删除」的文件（双端 UI 删除与 agent 工具删除同源，全部命中）；
- 衍生场景：删除后同路径重建（新 entry），回滚时旧 entry 指针 JOIN 不上，新文件反而可能被 `pathsNeedDelete` 误删。

## 验收标准

1. 删除 → 回滚：被删文件复现，内容为锚点检查点时点内容；
2. 删除 → 同路径重建 → 回滚（到重建前）：旧内容回来，重建产生的 entry 被墓碑回退；
3. 检查点 revision 行真缺失（非 entry 缺失）时维持既有确认流降级：默认抛 REVISION_BACKFILL_REQUIRED 阻断回滚，由双端 UI 确认后带 `revisionHeadBackfill: true` 重试，按 live head 回补占位/墓碑完成降级回滚（no-option 行为断言见 `rollback-restore-deleted-entry.test.ts`）；
4. 存量库升级后历史 checkpoint 行为不劣化（无 path 快照的行回退旧 JOIN 语义）；
5. 回滚复现后再次新建文件，entry_id 发号不回退、不撞唯一键。

## 回归测试要点

- 「checkpoint 记录后仅 write 未删除」的既有回滚恢复用例（指针重置语义不变）；
- rename 与回滚的交互（见 spec「行为变更」：路径语义从跟随现路径变为快照冻结，属有意修正）；
- 墓碑/GC：anchor 检查点钉住的 revision 不被 sweep 清理，恢复后 blob 幂等复用；
- 迁移：存量库 `ALTER TABLE` 加列 + 回填的幂等与快路径。
