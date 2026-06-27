---
date: 2026-06-27
---

# 消息 Worktree 刷新收窄与批量选择 技术规格（SPEC）

> **PRD**：[`prd.md`](./prd.md)  
>  **前置**：[`message-delete-worktree-narrow-refresh/spec.md`](../message-delete-worktree-narrow-refresh/spec.md)、[`worktree-vfs-ui-refresh-fix/spec.md`](../worktree-vfs-ui-refresh-fix/spec.md)  
> **建议分支**：`feature/message-worktree-refresh-tighten`

## 设计目标

1. **收窄 markDirty**：`truncateMessagesAfter`、`rollbackToMessage` 不再调用 `markSessionWorktreeDirty`；hide/show 与规则变更路径不变。
2. **收窄 UI token 刷新**：双端 delete 批量、回滚成功 **不** bump 消费方 ①；hide/restore 批量仍 bump。
3. **Core 统一 tail 可选规则**：`TailBatchRow` 携带 `hidden`；`delete` / `restore` 按 hidden 过滤可选锚点，**级联 seq 算法不变**。
4. **长按菜单**：`hidden === true` 时不展示「回滚」。
5. **不推翻**消费方 ①/② 分离、Agent 写盘 lazy 刷新、手动「刷新工作树」仅 dirty ② 等 [`worktree-vfs-ui-refresh-fix`](../worktree-vfs-ui-refresh-fix/spec.md) 定案。

## 总体方案

### Worktree 刷新口径（本迭代后）

| 动作 | Core `markDirty` | Mobile `bumpWorktreeUiToken` | Desktop `notifyWorkspaceMutated` |
|------|------------------|-------------------------------|----------------------------------|
| hide / show（含批量、压缩 hide-message） | ✅ | hide/restore 批量 ✅ | hide/restore/delete 批量 → **仅 hide/restore ✅** |
| truncate / rollback | ❌ | ❌ | ❌ |
| 手动刷新工作树 | invalidate ② | ❌ | ❌ |
| 规则变更 | ✅ | 现网路径 | 现网路径 |

**说明**：完整回滚会 reconcile VFS，但按 PRD **不**自动刷新 worktree UI；用户可手动「刷新工作树」或切换 workspace 面板触发 `reload()`。

### Tail 批量可选规则

```
TailBatchRow { id, role, seq, hidden, selectable }
  selectable: 合成行/展示行基础可选（现网 true；不可选行保留 false）

isTailBatchRowSelectable(row, mode):
  if !row.selectable → false
  if mode === 'delete'  → !row.hidden
  if mode === 'restore' → row.hidden
```

级联：`selectTailBatchEligibleIdsFromAnchor(rows, anchorId, mode)` 在 `isTailBatchRowSelectable(r, mode) && r.seq >= anchor.seq` 上全选。

**预览与确认**：`computeTailBatchAffectedIds` / `computeTailBatchRangeFromSelection` **不变**——仍按 seq 下界计算影响集（含 hidden 行），与「锚点仅 hidden/visible 可选但截断/恢复按 seq 边界」一致。

### 架构分层

```
Core
  domain/chat/logic/tail-batch-range.ts     # +hidden, +mode 参数
  service/chat/impl/message-transcript-effects.service.ts  # truncate 去 markDirty
  service/message-checkpoint/impl/message-rollback.service.ts  # 去 markDirty
  public/chat.ts                            # export 签名变更

Mobile
  components/chat/transcript-selectable-role.ts  # row mapper +hidden
  components/chat/message-edit.ts                # 长按无 rollback if hidden
  web/chat-transcript/main.ts                    # WebView 菜单
  screens/tabs/chat-tab/useChatTabMessages.ts    # finishMessageBatchMutation 分支
  ChatTabScreen / ChatConversationPanel          # select 传 mode

Desktop
  renderer/features/chat/transcript-selectable-role.ts  # buildTailBatchRows +hidden
  renderer/features/chat/message-edit.ts                # 长按
  renderer/features/chat/ConversationPanel.tsx          # select + confirm 刷新分支
```

## 最终项目结构

变更集中在既有文件，无新顶层模块：

```
packages/core/src/domain/chat/logic/tail-batch-range.ts
packages/core/src/public/chat.ts
packages/core/src/service/chat/impl/message-transcript-effects.service.ts
packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts
packages/core/test/chat/tail-batch-range.test.ts
packages/core/test/chat/message-transcript-effects.test.ts
packages/core/test/session-fs/rollback-to-message.test.ts
packages/core/test/package-exports/snapshots/public-chat-allowlist.json  # 若签名变更

apps/mobile/src/components/chat/transcript-selectable-role.ts
apps/mobile/src/components/chat/message-edit.ts
apps/mobile/src/web/chat-transcript/main.ts
apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts
apps/mobile/src/screens/tabs/ChatTabScreen.tsx
apps/mobile/src/components/batch/MessageBatchHeader.tsx
apps/mobile/__tests__/message-action-items.test.ts

apps/desktop/renderer/features/chat/transcript-selectable-role.ts
apps/desktop/renderer/features/chat/message-edit.ts
apps/desktop/renderer/features/chat/ConversationPanel.tsx
```

## 变更点清单

| 文件 | 变更 |
|------|------|
| `tail-batch-range.ts` | `TailBatchRow.hidden`；`isTailBatchRowSelectable(row, mode)`；`selectTailBatchEligibleIdsFromAnchor(..., mode)` |
| `message-transcript-effects.service.ts` | `truncateMessagesAfter` 移除 `markSessionWorktreeDirty` |
| `message-rollback.service.ts` | 成功路径移除 `markSessionWorktreeDirty` |
| Mobile/Desktop row mappers | 写入 `hidden`；vfs turn 行取 action 消息或 view.hidden |
| `useChatTabMessages.ts` | `finishMessageBatchMutation(mode)`：仅 hide/restore 调用 `bumpWorktreeUiToken` |
| `ConversationPanel.tsx` | `handleConfirm` / `executeRollback`：仅 hide/restore 调用 `notifyWorkspaceMutated` |
| `message-edit.ts`（双端） | `if (!message.hidden)` 才 push rollback |
| `main.ts` (WebView) | `buildMenuItems`：`if (!row.hidden)` 才 push rollback |
| `MessageBatchHeader.tsx` | delete/restore hint 文案区分 hidden 过滤 |
| `visibility-batch-range.ts` | **不改** hide 模式 assistant-only 语义（本迭代范围外） |

## 详细实现步骤

### Step 1 — Core `tail-batch-range`

1. 扩展类型：

```typescript
export type TailBatchRow = {
  readonly id: string;
  readonly role: string;
  readonly seq: number;
  readonly hidden: boolean;
  readonly selectable: boolean;
};

export function isTailBatchRowSelectable(
  row: TailBatchRow,
  mode: TailBatchMode,
): boolean;

export function selectTailBatchEligibleIdsFromAnchor(
  rows: readonly TailBatchRow[],
  anchorId: string,
  mode: TailBatchMode,
): ReadonlySet<string>;
```

2. 更新 `selectTailBatchEligibleIdsFromAnchor` 内 filter 使用 `isTailBatchRowSelectable(r, mode)`。
3. `computeTailBatchRangeFromSelection` 内 selected 过滤改为 `isTailBatchRowSelectable(r, mode)`（需新增 `mode` 参数）。
4. 更新 `packages/core/src/public/chat.ts` 导出签名；运行 public export 快照测试。

### Step 2 — Core 去 markDirty

1. `DefaultMessageTranscriptEffectsService.truncateMessagesAfter`：删除事务后 `markSessionWorktreeDirty` 调用。
2. `DefaultMessageRollbackService.rollbackToMessage`：删除成功路径 `markSessionWorktreeDirty` 调用。
3. 更新单测：
   - `message-transcript-effects.test.ts`：`truncateMessagesAfter` 断言 **不** dirty。
   - `rollback-to-message.test.ts`：删除或改写「rollback markDirty」「skipVfsReconcile markDirty」用例为 **不 dirty**。

### Step 3 — Mobile row mapper 与选择

1. `chatMessagesToTailBatchRows`：每条写入 `hidden: message.hidden`（vfs turn 用 `view.hidden` 或 actionMsg.hidden）。
2. `ChatTabScreen.handleToggleMessageSelect`：`selectTailBatchEligibleIdsFromAnchor(tailRows, messageId, messageBatch.mode)`。
3. `useChatTabMessages.confirmVisibilityBatch`：`computeTailBatchRangeFromSelection(..., messageBatch.mode)`。
4. `ChatConversationPanel` visibility preview：同上传入 mode。
5. `finishMessageBatchMutation`：签名增加 `mode`；`if (mode === 'hide' || mode === 'restore') bumpWorktreeUiToken()`。

### Step 4 — Desktop 对齐

1. `buildTailBatchRows`：写入 `hidden`（message.hidden / item 对应字段）。
2. `ConversationPanel`：`selectTailBatchEligibleIdsFromAnchor(..., messageBatch.mode)`；preview range 计算传 mode。
3. `handleConfirm`：在 hide/restore/delete 分支成功后，`if (mode === 'hide' || mode === 'restore') notifyWorkspaceMutated()`；delete 仅 `reloadMessages`。
4. `executeRollback`：移除 `notifyWorkspaceMutated()`。

### Step 5 — 长按菜单

1. Mobile `buildMessageActionItems`：`if (!message.hidden) items.push({ label: '回滚', ... })`。
2. Desktop 同文件镜像修改。
3. WebView `buildMenuItems(row)`：`if (!row.hidden) ...`。
4. 增补 `message-action-items.test.ts`：hidden 消息无 rollback 项。

### Step 6 — 文案

`MessageBatchHeader.batchHint`：

- delete：`点击未隐藏的消息…`
- restore：`点击已隐藏的消息…`

Desktop `batchHint` 同步。

## 测试策略

### 单元 / 集成

| 套件 | 用例 |
|------|------|
| `tail-batch-range.test.ts` | delete 锚点仅选 visible；restore 锚点仅选 hidden；级联 seq 不变；affectedIds 仍含范围内 hidden |
| `message-transcript-effects.test.ts` | truncate 不 dirty；hide/show 仍 dirty |
| `rollback-to-message.test.ts` | rollback / skipVfsReconcile 不 dirty |
| `message-action-items.test.ts` | hidden → 无 rollback |
| Mobile integration（若有 chat-tab batch 测试） | delete 确认后不调用 bump mock |

### 手工验收

1. 批量 delete 尾部消息 → 工作区 tab 列表 **不** 自动重载；token 标签随 transcript 变。
2. 批量 hide → 工作区 tab **重载**（或 token 更新路径可见）。
3. hidden 消息长按 → 无回滚；visible 仍有回滚。
4. restore 模式仅 hidden 可点；delete 模式仅 visible 可点；确认后 seq 范围与现网一致。
5. 完整回滚后工作区 **不** 自动刷新；手动「刷新工作树」后 prompt 块更新。

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 回滚 reconcile VFS 后 UI 滞后 | PRD 已接受；提示文案可后续加「工作区已变，可手动刷新工作树」 |
| 与 `message-delete-worktree-narrow-refresh` PRD 冲突 | 本迭代 PRD 显式修订刷新口径；实现以本 SPEC 为准 |
| Core API 签名变更 | 双端 row mapper + 测试同 PR 合并；export 快照一并更新 |
| **回滚** | 恢复 `truncate`/`rollback` 内 `markDirty` 与 UI bump 三处调用即可 |

---

请确认本 SPEC 后进入编码。建议 worktree：`feature/message-worktree-refresh-tighten`。
