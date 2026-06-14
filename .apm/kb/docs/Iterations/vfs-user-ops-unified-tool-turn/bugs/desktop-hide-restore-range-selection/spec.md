---
date: 2026-06-15
---

# desktop-hide-restore-range-selection Bug 修复规格（SPEC）

## 根因分析

`MessageList` 仅用 `selectedIds.has(id)` 渲染 `is-selected`。`computeHideRangeFromSelection` 虽正确计算 `hideRange(1, toSeq)`，但未用于 UI 预览，导致 user 等不可勾选行无高亮，与用户心智（整段 seq 区间）不一致。

## 修复方案

1. 将可见性批量纯函数收敛至 `packages/core/src/domain/chat/logic/visibility-batch-range.ts`。
2. 新增 `computeVisibilityBatchAffectedIds`：由 hide/show range 推导将影响的消息 id 集合。
3. UI：`affectedIds` → `is-in-range` class；`selectedIds` → checkbox + `is-selected`（锚点行）。
4. batch bar 文案改为「将影响 N 条（seq …）」。
5. Desktop `shell.css` 优化 batch bar 与 `is-in-range` 样式。

## 变更点清单

| 路径 | 变更 |
|------|------|
| `packages/core/src/domain/chat/logic/visibility-batch-range.ts` | 新建；迁入 selectable role + range + affectedIds |
| `packages/core/test/chat/visibility-batch-range.test.ts` | 单测 |
| `apps/desktop/.../transcript-selectable-role.ts` | re-export core |
| `apps/desktop/.../MessageList.tsx` | `affectedIds`、`is-in-range` |
| `apps/desktop/.../ConversationPanel.tsx` | 计算 affectedCount、batch 文案 |
| `apps/desktop/renderer/styles/shell.css` | batch bar + in-range 样式 |
| Mobile MessageList / WebView / MessageBatchHeader | 同步 |

## 详细改动说明

### 范围预览

```text
hide + selected assistant max seq = S
  → affected = { m | m.seq <= S }

restore + selected user min seq = S
  → affected = { m | m.seq >= S }
```

### 样式分层

- `is-selected`：直接勾选的可选行（强选中）
- `is-in-range`：区间内所有行（浅高亮，含无 checkbox 的 user）

## 测试策略

### 测试用例

- hide：3 条消息 seq 1–3，选 seq 3 assistant → affected 3 ids
- restore：选 seq 2 user，maxSeq 5 → affected seq 2–5
- 无选中 → empty set

## 风险与回滚方案

- 风险低：仅 UI 预览；确认后 IPC 未改。
- 回滚：revert `92803dd`..`21e4174` 三个 commit。

## 提交

- `92803dd` 将可见性批量范围逻辑抽到 core 并补充单测
- `66f7352` Desktop 隐藏/恢复批量模式增加范围预览高亮
- `21e4174` Mobile/WebView 同步可见性批量范围预览
