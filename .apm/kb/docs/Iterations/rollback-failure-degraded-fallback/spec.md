---
date: 2026-06-19
---

# 回滚失败降级兜底 技术规格（SPEC）

## 设计目标

在 **不改动** `message-checkpoint-v2` / `vfs-user-ops-unified-tool-turn` 已定案语义的前提下，为 Mobile + Desktop 增加 **VFS restore 失败后的用户可控降级**：

1. 第一次确认后尝试 **完整回滚**（消息截断 + VFS reconcile，与现状一致）。
2. 若 VFS reconcile 在事务内失败 → 事务回滚，状态不变 → UI 展示 **第二次** 弹窗（错误摘要 + 后果说明）。
3. 用户选 **继续** → 调用 Core **仅消息截断** 路径；工作区文件保持失败前状态。
4. 用户选 **取消** → 无变更。

**非目标**：CLI 交互降级、自动静默降级、VFS 激进删除、修改「无 checkpoint 不阻断」策略。

## 总体方案

### 架构

```text
UI（Mobile Alert / Desktop ConfirmModal）
  │ ① 现有 destructive 确认
  ▼
rollbackToMessage({ skipVfsReconcile: false })   ← 默认，完整回滚
  │
  ├─ 成功 → Toast「回滚成功」+ 刷新消息/VFS
  │
  └─ throw SessionFsError(ROLLBACK_VFS_RESTORE_FAILED)
        │
        ▼
     UI ② 降级弹窗
        │
        ├─ 取消 → 结束（DB 已在①失败时回滚，无脏状态）
        │
        └─ 继续 → rollbackToMessage({ skipVfsReconcile: true })
                    → Toast「对话已截断，工作区未恢复」+ 仅刷新消息
```

### Core 分层

| 层 | 职责 |
|----|------|
| `domain/message-checkpoint/logic/` | 保持 `resolveRollbackAnchorMessage`、`resolveRollbackTargetTree`、`restorePathToRevision` 不变 |
| `service/message-checkpoint/impl/message-rollback.service.ts` | 抽取 rollback 上下文；支持 `skipVfsReconcile`；VFS 失败包装为可降级错误 |
| `errors/session-fs-errors.ts` | 新增 `ROLLBACK_VFS_RESTORE_FAILED`；导出 `isRollbackVfsDegradableError` |
| `apps/desktop` IPC | 请求体增加 `skipVfsReconcile?`；错误码透传 |
| `apps/mobile` | 直接调 runtime；catch 可降级错误 → 第二道 `Alert.alert` |

### 错误分类（定案）

| 错误 | 可降级 | UI 行为 |
|------|--------|---------|
| `ROLLBACK_VFS_RESTORE_FAILED` | ✓ | 第二次弹窗 |
| 内含 `RESTORE_REVISION_MISSING` 的 restore 失败 | ✓（包装后） | 同上 |
| reconcile 循环内非 `NOT_FOUND` 的 `VfsError` | ✓（包装后） | 同上 |
| `ROLLBACK_MESSAGE_NOT_FOUND` | ✗ | Toast 失败 |
| `ROLLBACK_MESSAGE_SESSION_MISMATCH` | ✗ | Toast 失败 |
| Agent 运行中 | ✗ | UI 门禁（现有），不调 Core |
| 无 checkpoint 前序树可解析（R9 等） | — | **非失败**，完整回滚成功，无降级弹窗 |

`ROLLBACK_NO_CHECKPOINT` 在 rollback 路径 **仍不抛出**（现状保留）。

### `skipVfsReconcile: true` 语义

在同一 anchor 解析逻辑下，事务内 **仅**：

1. `checkpoints.deleteCheckpointsForMessages(sessionId, tailMessageIds)`
2. `messages.deleteAfterSeq(sessionId, anchor.seq)`
3. `sweepSessionRevisions(...)`

**不**遍历 `pathsToReconcile`，**不**调用 `restorePathToRevision` / `deletePathIfExists`。

与 `MessageService.delete` 区别：按 **seq 批量截断 tail** + 删 tail checkpoints + GC；非单条删除。

## 最终项目结构

```text
packages/core/src/
  errors/session-fs-errors.ts                          # +ROLLBACK_VFS_RESTORE_FAILED, isRollbackVfsDegradableError
  service/message-checkpoint/
    message-rollback.port.ts                           # +RollbackOptions
    impl/message-rollback.service.ts                   # 重构 + skipVfsReconcile
  service/session-fs/session-fs.port.ts                # +RollbackOptions 透传
  service/session-fs/impl/session-fs.service.ts        # 透传
  public/session-fs.ts                                 # 导出新 helper / 类型

packages/core/test/message-checkpoint/
  rollback-degraded.test.ts                            # 新增

apps/desktop/
  shared/ipc-types.ts                                  # SessionFsRollbackRequest +skipVfsReconcile
  src/main/ipc/handlers/messages.ts                    # 透传；messages-only 不 markDirty
  renderer/features/chat/ConversationPanel.tsx         # 降级 confirmState + 双次回滚流
  renderer/ipc/client.ts                               # 类型随 shared 更新
  test/format-ipc-error.test.ts                        # +ROLLBACK_VFS_RESTORE_FAILED 映射

apps/mobile/src/
  services/message-rollback.service.ts                 # +RollbackOptions
  screens/tabs/chat-tab/useChatTabMessages.ts          # 降级 Alert 流
  errors/format-error.ts                               # 可选：识别 degradable code（非必须）
```

CLI（`apps/cli/src/session/commands.ts`）**本迭代不改**。

## 变更点清单

### Core

#### 1. `session-fs-errors.ts`

```typescript
export type SessionFsErrorCode =
  | ...
  | "ROLLBACK_VFS_RESTORE_FAILED";

export function sessionFsRollbackVfsRestoreFailed(
  message: string,
  options?: { sessionId?: string; messageId?: string; logicalPath?: string },
): SessionFsError;

/** True when UI may offer messages-only degraded rollback. */
export function isRollbackVfsDegradableError(error: unknown): boolean;
```

- `isRollbackVfsDegradableError`：`isSessionFsError(error, "ROLLBACK_VFS_RESTORE_FAILED")`（含 `error.cause` 链 unwrap，复用现有 `unwrapCause`）。

#### 2. `message-rollback.port.ts`

```typescript
export type RollbackOptions = {
  /** Skip VFS reconcile; truncate tail messages/checkpoints only. */
  readonly skipVfsReconcile?: boolean;
};

export interface MessageRollbackService {
  rollbackToMessage(
    sessionId: string,
    projectId: string,
    anchorMessageId: string,
    options?: RollbackOptions,
  ): Promise<void>;
}
```

#### 3. `message-rollback.service.ts` 重构

抽取私有方法 `resolveRollbackPlan(...)` 返回：

```typescript
type RollbackPlan = {
  anchor: ChatMessage;
  tailMessageIds: string[];
  pathsToReconcile: Set<string>;
  targetTree: Map<string, number>;
  scope: VfsScope;
};
```

主流程：

```typescript
async rollbackToMessage(sessionId, projectId, anchorMessageId, options?) {
  const plan = await this.resolveRollbackPlan(...); // 含 findById / session mismatch 硬失败

  await this.deps.conn.transaction(async (tx) => {
    if (!options?.skipVfsReconcile) {
      try {
        await this.reconcileVfsPaths(tx, plan);
      } catch (cause) {
        throw sessionFsRollbackVfsRestoreFailed(
          formatDegradableMessage(cause),
          { sessionId, messageId: anchorMessageId },
        );
      }
    }
    await this.truncateTailState(tx, sessionId, plan);
  });
}
```

- `reconcileVfsPaths`：自现有 L113–126 循环抽出。
- `truncateTailState`：checkpoint 删 tail + `deleteAfterSeq` + `sweepSessionRevisions`。
- `formatDegradableMessage`：优先 `SessionFsError` / `VfsError` 的 `message`；前缀固定为 `工作区无法恢复：`（与 PRD F 一致，不提及删文件）。

#### 4. `session-fs.port.ts` / `session-fs.service.ts`

`rollbackToMessage` 签名对齐，透传 `options` 至 `MessageRollbackService`。

#### 5. `public/session-fs.ts`

导出 `RollbackOptions`、`isRollbackVfsDegradableError`、`sessionFsRollbackVfsRestoreFailed`（测试/UI 用）。

### Desktop

#### 6. `ipc-types.ts`

```typescript
export type SessionFsRollbackRequest = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly skipVfsReconcile?: boolean;
};
```

#### 7. `handlers/messages.ts`

```typescript
await rt.sessionFs.rollbackToMessage(
  req.sessionId, req.projectId, req.messageId,
  req.skipVfsReconcile ? { skipVfsReconcile: true } : undefined,
);
// markDirty 仅当 !req.skipVfsReconcile
```

#### 8. `ConversationPanel.tsx`

扩展 `confirmState`：

```typescript
| { kind: "rollback-degraded"; messageId: string; errorMessage: string }
```

- `executeRollback(messageId, skipVfsReconcile?)`：传 IPC flag；成功时 `skipVfsReconcile` → Toast `对话已截断，工作区未恢复`，否则 `回滚成功`。
- `executeRollback` 失败且 `result.error.code === "ROLLBACK_VFS_RESTORE_FAILED"` → `setConfirmState({ kind: "rollback-degraded", ... })`。
- `handleConfirm` 对 `rollback-degraded` → `executeRollback(messageId, true)`。
- 降级弹窗文案（`confirmMessage` / 独立 title）：

  - **标题**：`无法恢复工作区`
  - **正文**：`{errorMessage}\n\n可仅删除此消息之后的对话，工作区文件将保持现状。`
  - **确认**：`仅删除后续对话`（`danger`）
  - **取消**：`取消`

### Mobile

#### 9. `message-rollback.service.ts`

```typescript
export async function rollbackToMessage(
  runtime, scope, messageId,
  options?: RollbackOptions,
): Promise<void>
```

#### 10. `useChatTabMessages.ts`

抽取 `runRollback(messageId, skipVfsReconcile?)`：

1. 第一次：`skipVfsReconcile: false`（默认）
2. `catch`：`isRollbackVfsDegradableError(error)` → 第二道 `Alert.alert`：
   - 标题：`无法恢复工作区`
   - 正文：同 Desktop
   - 按钮：`取消` | `仅删除后续对话`（destructive）
3. 第二次：`rollbackToMessage(..., { skipVfsReconcile: true })`；成功 Toast 区分；`skip` 时不 `bumpVfsRefresh`

Agent 运行中门禁 **保持**在第一次确认之前（不进入降级流）。

## 兼容性或迁移说明

- **无 DB 迁移**；纯行为/API 扩展。
- 旧客户端调新 Core：`skipVfsReconcile` 缺省为 `false`，行为与现网一致。
- `ROLLBACK_NO_CHECKPOINT` 保留错误工厂与 IPC 映射测试，rollback 路径仍不抛出。
- CLI `nm session rollback` 暂不支持降级；失败时仍 exit 非 0（PRD 范围外）。

## 详细实现步骤

### Phase 1 — Core 错误与端口（~0.5d）

1. 新增 `ROLLBACK_VFS_RESTORE_FAILED` 与 `isRollbackVfsDegradableError`。
2. 扩展 `MessageRollbackService` / `SessionFsService` 签名。
3. 单测：helper 识别 degradable error。

### Phase 2 — Core 回滚重构（~1d）

1. 抽取 `resolveRollbackPlan`、`reconcileVfsPaths`、`truncateTailState`。
2. 实现 `skipVfsReconcile` 分支。
3. VFS 循环 `try/catch` 包装 degradable 错误。
4. 新增 `rollback-degraded.test.ts`（见测试策略）。

### Phase 3 — Desktop（~0.5d）

1. IPC 类型与 handler。
2. `ConversationPanel` 双确认流 + Toast 区分。
3. `format-ipc-error.test.ts` 补一条。

### Phase 4 — Mobile（~0.5d）

1. service wrapper 透传 options。
2. `useChatTabMessages` 降级 Alert。
3. 手工验收 A/B/C（PRD）。

### Phase 5 — 回归（~0.5d）

1. `packages/core` 全量 `message-checkpoint` 测试。
2. Desktop/Mobile 现有回滚 E2E 回归（`chat.rollback-vfs.e2e.ts` 应仍绿）。

## 测试策略

### 单元测试（Core）

文件：`packages/core/test/message-checkpoint/rollback-degraded.test.ts`

| ID | 用例 | 断言 |
|----|------|------|
| DF1 | 完整回滚时 revision 缺失 | `rejects` `ROLLBACK_VFS_RESTORE_FAILED`；消息数不变；VFS 不变 |
| DF2 | DF1 后 `skipVfsReconcile: true` | tail 消息删除；VFS 内容不变 |
| DF3 | 完整回滚成功（复用 R1 场景） | 无 degradable 错误；VFS + 消息均恢复 |
| DF4 | R9 纯文本 anchor 无 checkpoint | 完整回滚成功，**不**抛 degradable |
| DF5 | `ROLLBACK_MESSAGE_NOT_FOUND` | 不包装为 degradable |
| DF6 | `isRollbackVfsDegradableError` | true/false 边界 |

**DF1 构造**：capture checkpoint 后 `DELETE FROM vfs_revision WHERE ...` 或测库 API 删 revision，再 `rollbackToMessage` full。

### Desktop

| ID | 用例 | 方式 |
|----|------|------|
| DF-D1 | `formatIpcError` 映射 `ROLLBACK_VFS_RESTORE_FAILED` | 现有 `format-ipc-error.test.ts` |

Renderer 弹窗流以手工 + 可选后续 component test；本迭代不强制 E2E 覆盖降级分支。

### Mobile

| ID | 用例 | 方式 |
|----|------|------|
| DF-M1 | 手工 A/B/C/F | PRD 验收清单 |

### 回归

- `packages/core/test/message-checkpoint/rollback.test.ts` 全部通过（R1–R10、tool turn）。
- `apps/mobile/e2e/specs/chat.rollback-vfs.e2e.ts` 完整回滚路径仍绿。

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 降级后对话与 VFS「未来态」不一致 | 弹窗 + 成功 Toast 明示；用户主动确认 |
| 误将硬失败标为可降级 | 仅包装 reconcile 循环内错误；消息校验在事务外硬失败 |
| Desktop `markDirty` 误触发 | `skipVfsReconcile` 时跳过 |
| 双端文案漂移 | PRD F + SPEC 固定字符串表 |

**实现回滚（开发期）**：revert Core options 参数与 UI 二次弹窗；旧调用方无 `skipVfsReconcile` 时行为与现网一致。

**产品回滚**：关闭降级 UI，保留 `ROLLBACK_VFS_RESTORE_FAILED` 错误码仅作 Toast 亦可（feature flag 非必须，revert commit 即可）。
