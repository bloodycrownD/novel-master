---
date: 2026-08-12
agile_trace: true
---

# checkpoint-seed-batch-optimize 实现规格（SPEC）

## 根因 / 方案摘要

**根因**：`seedForkCopyParity` 逐条调 `insertCheckpoint`（500 次），每次 `insertCheckpoint` 内部对每个文件指针逐条 INSERT `message_checkpoint_file` + 逐条 UPDATE `vfs_revision.ref_count`。200 文件 × 500 消息 = 20 万次 SQL 往返，耗时约 1.8 秒。

**方案**：新增 `seedCheckpoints` 批量方法，在 `seedForkCopyParity` 里一次性完成全部 checkpoint 播种——锚点行、文件行用 `conn.batch` 一次插完，ref_count 用 `batchAdjustRefCountWithDelta` 一次加 `msgCount`。

## 变更点清单

| 文件 | 改动 |
|------|------|
| `message-checkpoint.port.ts` | 接口新增 `seedCheckpoints(sessionId, messages, files, createdAtMs)` 和 `batchAdjustRefCountWithDelta` |
| `sqlite-message-checkpoint.repository.ts` | 实现 `seedCheckpoints`：`conn.batch` 批量插锚点 + 文件行，`batchAdjustRefCountWithDelta` 批量调 ref_count |
| `vfs-revision.port.ts` | 接口新增 `batchAdjustRefCountWithDelta(pointers, delta)`（自定义 delta 版本） |
| `sqlite-vfs-revision.repository.ts` | 实现 `batchAdjustRefCountWithDelta`；`batchAdjustRefCount` 改为薄包装 |
| `seed-fork-copy-parity.ts` | 消息循环改为调 `seedCheckpoints`，替代 500 次 `insertCheckpoint` |
| `revision-ref-count.ts` | `increment/decrementRefsForCheckpointFiles`、`decrementLiveRefsUnderScope` 改调批量版 |
| 2 个 rollback 测试 mock | 补 `batchAdjustRefCount` / `batchAdjustRefCountWithDelta` |

## 详细改动说明

### `seedCheckpoints` 方法（核心）

在 `SqliteMessageCheckpointRepository` 新增，专给 `seedForkCopyParity` 用：

1. `conn.batch` 一次性插入全部消息的 `message_checkpoint` 锚点行（N 条）
2. `conn.batch` 一次性插入全部 `message_checkpoint_file` 文件指针行（N × M 条）
3. `batchAdjustRefCountWithDelta(pointers, msgCount)` 一次把每个文件指针的 ref_count 加 msgCount

前置假设：目标 session 是全新的，不需要 DELETE 旧行（seed 场景成立）。

### `batchAdjustRefCountWithDelta` 方法

泛化版的 `batchAdjustRefCount`，delta 可以是任意正整数（seed 场景加 msgCount）。delta > 0 时做存在性校验（守护 NOT_FOUND），delta < 0 时缺失行 no-op。

### `seedForkCopyParity` 改动

```typescript
// 原来：500 次循环调 insertCheckpoint
for (const msg of newMessages) {
  await checkpoints.insertCheckpoint({ ... });
}

// 现在：一次批量调用
await checkpoints.seedCheckpoints(targetSessionId, newMessages, files, createdAtMs);
```

## 实测性能（200 文件 + 500 消息）

| 操作 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| copy | 1837ms | 177ms | 10x |
| fork | 2137ms | 170ms | 13x |
| delete | 1284ms | 301ms | 4x |

delete 提升来自 `decrementLiveRefsUnderScope` 也改了批量 `batchAdjustRefCount`。

## 测试策略

### 测试用例

**`test/vfs/revision-ref-count.test.ts`（8 个用例）**：

- T-BATCH-REF-COUNT：批量 +1 / -1 后 ref_count 正确
- T-BATCH-REF-MISSING：delta>0 对缺失行抛 NOT_FOUND（守护不变量）
- T-BATCH-REF-DEC-NOOP：delta<0 对缺失行 no-op
- T-BATCH-REF-EMPTY：空入参安全返回
- T-BATCH-REF-CHUNK：超 500 pair 自动分块
- T-BATCH-REF-HELPERS：三个 helper 行为正确
- T-BATCH-REF-LIVE：decrementLiveRefsUnderScope 批量扣减
- T-BATCH-REF-HELPERS-MISSING：increment helper 对缺失行抛 NOT_FOUND

**`test/message-checkpoint/checkpoint-seed-batch-perf.test.ts`（性能回归）**：

- `seedCheckpoints` 200 文件 × 500 消息，P95 < 800ms（实测 ~170ms，逐条版 ~1.8s）

**回归测试（全部通过）**：

- `fork-copy-parity.test.ts`：fork/copy 后 checkpoint、ref_count、blob 一致
- `rollback-ref-count.test.ts`：T-RB-REF-MISSING 守护
- checkpoint 全部 97 个测试
- revision-ref-count 8 个测试

## 风险与回滚方案

**风险**：

- `seedCheckpoints` 假设目标 session 全新、不需 DELETE 旧行——只用于 `seedForkCopyParity`，capture 路径仍走 `insertCheckpoint`（处理旧行）
- NOT_FOUND 校验用 `batchAdjustRefCountWithDelta` 的前置存在性查询保留

**回滚**：revert 相关 commit 即可，无 schema 变更、无数据迁移。
