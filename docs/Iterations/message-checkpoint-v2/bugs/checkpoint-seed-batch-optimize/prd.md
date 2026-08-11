---
date: 2026-08-12
dependency: Iterations/message-checkpoint-v2/prd.md
---

# checkpoint-seed-batch-optimize Bug PRD

## 背景

`message-checkpoint-v2` 引入了 message 级整树 checkpoint：每条 Agent 消息在 mutating tools 全部完成后，capture 当前工作区文件树快照（path → version 指针）。fork / session.copy 在复制会话时，通过 `seedForkCopyParity` 为目标会话的每条消息批量挂载同树 checkpoint，使分叉后的会话也具备回滚能力。

`vfs-revision-storage-optimize`（1.4.07）和 `vfs-version-redesign`（1.4.12）分别优化了 VFS 内容存储（blob 共享 + 压缩）和 VFS entry 层的批量操作（rename / copy / seed 批量化）。但 checkpoint 挂载这一层从未被批量化，一直沿用逐条 SQL 循环。

## 现象描述

会话消息多（数百条）且工作区文件多（数百个）时，copy / fork / delete 操作出现明显卡顿：

- 200 文件 + 500 消息的 copy / fork 耗时约 1.8–2.0 秒
- 200 文件 + 500 消息的 delete 耗时约 1.1–1.2 秒
- 批量删除时每个 session 都触发一次，卡顿线性叠加

而同等文件量但消息少（0 条）时，copy 仅约 15ms——说明瓶颈不在 VFS 文件复制层，而在 checkpoint 挂载层。

## 复现步骤

1. 创建一个 session，写入 200 个工作区文件
2. 发送 500 条消息（每条触发 checkpoint capture）
3. 对该 session 执行 copy / fork / delete
4. 观察操作耗时（秒级）

## 预期行为

200 文件 + 500 消息场景下，copy / fork / delete 的 checkpoint 相关阶段应在百毫秒级完成，用户无感知卡顿。

## 实际行为

checkpoint 挂载阶段耗时约 1.8 秒（copy / fork），因为 `seedForkCopyParity` 内部的 SQL 往返次数为 O(消息数 × 文件数 × 2)：

- 对每条消息调 `insertCheckpoint`（500 次）
- 每次 `insertCheckpoint` 内部对每个文件指针逐条 INSERT `message_checkpoint_file`（200 次/消息）
- 每次还逐条 UPDATE `vfs_revision.ref_count`（200 次/消息）
- 合计约 20 万次 SQL 往返

## 影响范围

- `seedForkCopyParity`（copy / fork 路径）
- `insertCheckpoint` 内部的文件指针写入和 ref_count 维护
- `decrementLiveRefsUnderScope`（delete 路径的 ref_count 递减）
- 所有调用 `insertCheckpoint` 的路径：`seed-fork-copy-parity`、`backfill-baseline-checkpoints`、`message-checkpoint.service` capture

## 验收标准

1. 200 文件 + 500 消息的 copy / fork，checkpoint 挂载阶段 P95 < 1500ms（性能回归测试守护）
2. `batchAdjustRefCount` 对 delta=+1 的缺失行抛 `VfsError("NOT_FOUND")`（守护 T-RB-REF-MISSING 不变量）
3. `batchAdjustRefCount` 对 delta=-1 的缺失行 no-op（不抛错）
4. fork / copy 后的 checkpoint 行数、revision ref_count、blob ref_count 与逐条版完全一致（parity）
5. 现有测试全部通过（fork-copy-parity、rollback-ref-count、vfs-tree-copy-batch 等）

## 回归测试要点

- fork/copy 后 blob ref_count 不变（T-F1 parity 套件）
- `adjustRefCount` 的 NOT_FOUND 校验在批量版里保留（T-RB-REF-MISSING）
- 删除路径 ref_count 递减正确（message-delete-gc、revision-gc）
- checkpoint capture / rollback 性能基线不退化（performance.test.ts P1/P2）
