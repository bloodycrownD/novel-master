---
date: 2026-06-28
---

# 回滚 revision 缺失 head 回补 技术规格（SPEC）

## 设计目标

在 **不改变** message-checkpoint-v2 锚点树语义的前提下：

1. revision 完好的 path → 精确 `restorePathToRevision`
2. revision 缺失的 path → 用户确认后 head 回补 placeholder → restore（该 path 保持现状）
3. revision 缺失 → **专用第二次 Alert**（「快照丢失，将使用最新内容修复」）
4. 其他 VFS 错误 → 仍 `ROLLBACK_VFS_RESTORE_FAILED` + degraded UI

## 总体方案

### 目标流程

```text
UI ① 现有 destructive 确认
  ▼
rollbackToMessage({ revisionHeadBackfill: false })
  │
  ├─ 无 dangling revision → 事务内 reconcile + truncate → Toast「回滚成功」
  │
  └─ throw ROLLBACK_REVISION_BACKFILL_REQUIRED
        ▼
     UI ② 快照丢失 Alert → 继续 → revisionHeadBackfill: true → partial reconcile
```

### 缺失检测

事务**前** `findMissingRevisionPointers`；`missing.length > 0 && !revisionHeadBackfill` → throw。

### 回补规则

| live entry | 回补 revision |
|------------|---------------|
| 存在（file） | active + entry.content |
| 不存在 | deleted + content null |

## 变更点清单（摘要）

- `detect-missing-revisions.ts`、`backfill-missing-revision.ts`、`restore-path.ts`
- `ROLLBACK_REVISION_BACKFILL_REQUIRED`、`RollbackOptions.revisionHeadBackfill`
- Desktop/Mobile 快照丢失 Alert；IPC 透传
- Desktop 回滚成功且 VFS reconcile 时 `notifyWorkspaceMutated()`

## 测试策略

### Core — `rollback-revision-backfill.test.ts`

| ID | 用例 | 断言 |
|----|------|------|
| RB1 | 多文件；无 flag | rejects `BACKFILL_REQUIRED`；消息 4 条；VFS 不变 |
| RB2 | 多文件 + `revisionHeadBackfill: true` | A→锚点；B→现状；消息截断 |
| RB3 | revision 完好 R1 | 一次成功 |
| RB4 | backfill entry 不存在 | deleted placeholder 行 |
| RB4b | tail 删文件 + 缺失 revision + backfill | 不创建文件；消息截断 |
| RB5 | revision 已存在 | 不重复 append |

### Core — `rollback-degraded.test.ts`

| ID | 变更 |
|----|------|
| DF1 | missing → `BACKFILL_REQUIRED`（非 degradable） |
| DF1b | `revisionHeadBackfill: true` → 成功 |
| DF2+ | 保留 degraded + skip |

### Desktop

| ID | 用例 |
|----|------|
| RB-D1 | `formatIpcError` 映射 `ROLLBACK_REVISION_BACKFILL_REQUIRED` |

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| backfill vs degraded 误判 | 独立 error code + UI branch |
| 检测与事务间 race | 检测后立即进事务 |

**产品回滚**：revert 分支；恢复 revision 缺失 → degraded。
