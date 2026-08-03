---
date: 2026-06-20
---

# 删除消息批量与 Worktree 窄刷新 技术规格（SPEC）

> **PRD**：[`prd.md`](./prd.md)  
> **代码基线**：`main`（2026-06-20）

## 设计目标

1. 双端新增「删除消息」批量模式；`restore` / `delete` **共用一套** tail 级联（seq ≥ 锚点、全 role）；`hide` 保持 assistant-only 不变。
2. 消息 hide / show / tail 截断 **各一条 Core 入口**，`worktreeSnapshot.markDirty` **仅写进入口内**。
3. 剥离 VFS 写删改、Agent `vfsMutated`、pullTemplate、fork 等对 worktree 的刷新；**保留**规则变更、消息 hide/show/truncate（含回滚截断）后的刷新。
4. 回滚与批量删 **共享 tail 截断事务逻辑**；回滚在此基础上额外 VFS reconcile + revision sweep。

## 总体方案

### 架构分层

```
UI（Mobile / Desktop）
  ├─ 更多菜单 → enterDelete / confirmDeleteBatch
  ├─ hide / restore / delete 批量 → Core tail-batch-range（restore∥delete）
  └─ 消息操作成功后 → reload transcript + bumpWorktreeUiToken（仅 UI，不 markDirty）

IPC（Desktop main）
  └─ messages/applyHideRange | applyShowRange | truncateAfter
      → MessageTranscriptEffectsService

Core
  ├─ domain/chat/logic/
  │     visibility-batch-range.ts   # hide 专用（不变）
  │     tail-batch-range.ts         # restore + delete 共用（新增）
  ├─ domain/message-checkpoint/logic/
  │     truncate-tail-in-transaction.ts  # 共享截断（新增）
  ├─ service/chat/
  │     message-transcript-effects.service.ts  # 三入口 + markDirty（新增）
  │     message.service.ts            # 保留底层 hideRange/showRange/delete（无 dirty）
  ├─ service/message-checkpoint/
  │     message-rollback.service.ts   # 委托 truncate-tail-in-transaction
  └─ service/events/
        hide-message.handler.ts       # 委托 hideMessagesInRange
        event-orchestrator.service.ts # 移除 hide 后 markDirty

Worktree 规则写入（保留 markDirty）
  ├─ apps/desktop/.../handlers/worktree.ts
  └─ Mobile VfsFileManager 规则相关路径（inclusion / dir rule）
```

### 关键 API（Core）

```typescript
/** @module service/chat/message-transcript-effects.port */

export interface MessageTranscriptEffectsService {
  /** hideRange + markDirty(projectId, sessionId) */
  hideMessagesInRange(
    projectId: string,
    sessionId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<number>;

  /** showRange + markDirty */
  showMessagesInRange(
    projectId: string,
    sessionId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<number>;

  /**
   * 截断 tail：deleteAfterSeq + tail checkpoint 清理 + markDirty。
   * 不做 VFS reconcile；默认不 sweepSessionRevisions（批量删）。
   */
  truncateMessagesAfter(
    projectId: string,
    sessionId: string,
    afterSeq: number,
    options?: { sweepRevisions?: boolean },
  ): Promise<void>;
}
```

```typescript
/** @module domain/chat/logic/tail-batch-range */

export type TailBatchMode = "restore" | "delete";

export type TailBatchRow = {
  readonly id: string;
  readonly role: string;
  readonly seq: number;
  /** 合成行（如 user_vfs_turn 卡片）仍为 true */
  readonly selectable: boolean;
};

/** restore / delete：任意非 hide 行均可勾选（含 user_vfs_turn 展示行） */
export function isTailBatchRowSelectable(row: TailBatchRow): boolean;

export function selectTailBatchEligibleIdsFromAnchor(
  rows: readonly TailBatchRow[],
  anchorId: string,
): ReadonlySet<string>;

export function computeTailBatchAffectedIds(
  rows: readonly TailBatchRow[],
  selectedIds: ReadonlySet<string>,
  sessionMaxSeq: number,
): ReadonlySet<string>;

/** { fromSeq: min(selected.seq), toSeq: sessionMaxSeq } | null */
export function computeTailBatchRangeFromSelection(
  rows: readonly TailBatchRow[],
  selectedIds: ReadonlySet<string>,
  sessionMaxSeq: number,
): { fromSeq: number; toSeq: number } | null;

/** delete 确认：afterSeq = fromSeq - 1 */
export function tailBatchDeleteAfterSeq(fromSeq: number): number;
```

### 共享截断（事务内）

```typescript
/** @module domain/message-checkpoint/logic/truncate-tail-in-transaction */

export type TruncateTailParams = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly afterSeq: number;
  readonly sweepRevisions: boolean;
};

/**
 * 在已有事务内：
 * 1. list messages where seq > afterSeq → tailIds
 * 2. deleteCheckpointsForMessages(sessionId, tailIds)
 * 3. messages.deleteAfterSeq(sessionId, afterSeq)
 * 4. if sweepRevisions → sweepSessionRevisions(...)
 * 5. 若 tail 非空 → sessions.setUserVfsPendingJson(sessionId, null)  // 保守清空 pending
 */
export async function truncateTailInTransaction(
  tx: TdbcConnection,
  deps: TruncateTailDeps,
  params: TruncateTailParams,
): Promise<void>;
```

**回滚**：`rollback.service` 在 VFS reconcile 后于同一 `conn.transaction` 内调用 `truncateTailInTransaction(..., { sweepRevisions: true })`，事务提交后 **不再** IPC 层 `markDirty`——改由 `MessageTranscriptEffectsService` 包装的回滚入口统一 `markDirty`，或 rollback service 注入 `worktreeSnapshot` 并在 `rollbackToMessage` 末尾 `markDirty`（与 truncate 同文件一次调用，避免双路径）。

**定案**：`DefaultMessageRollbackService` 注入 `SessionWorktreeSnapshotStore`；`rollbackToMessage` 成功结束后 `markDirty`（与 `truncateMessagesAfter` 相同一行调用 `markDirty`，可抽 `markSessionWorktreeDirty(snapshot, projectId, sessionId)` 私有 helper 供 effects + rollback 共用）。

### UI 刷新与 markDirty 分离

| 层 | 职责 |
|----|------|
| Core `MessageTranscriptEffectsService` / rollback 末尾 | `markDirty` |
| Mobile `bumpWorktreeUiToken()` | 仅 `vfsRefreshKey++`，**不** `markDirty` |
| Desktop `refreshWorkspaceTrees()` | 仅 `treeRefreshToken++` |
| 消息批量 / 回滚成功回调 | `reloadMessages` + `bumpWorktreeUiToken` / `refreshWorkspaceTrees` |

消息入口已在 Core dirty；UI token bump 保证 Explorer / VfsFileManager 重新 `getOrRefresh`。

---

## 现状与缺口（探索结论）

| 项 | 现状 | 目标 |
|----|------|------|
| 批量模式 | `hide` \| `restore` | + `delete` |
| restore 级联 | 仅 `user` | 与 `delete` 共用 `tail-batch-range` |
| 菜单 hide/show | 直调 `hideRange`/`showRange`，无 dirty | `MessageTranscriptEffectsService` |
| 压缩 hide | `hide-message` + orchestrator `markDirty` | 仅 effects 入口 dirty |
| 批量删 | 无 | `truncateMessagesAfter` |
| 回滚截断 | `truncateTailState` 私有 | 共享 `truncateTailInTransaction` |
| 回滚 dirty | Desktop IPC 条件 `markDirty`；`skipVfsReconcile` 跳过 | 凡截断 tail **一律** dirty |
| VFS IPC / VfsFileManager | 写删改均 invalidate | **仅规则变更** invalidate |
| Agent vfsMutated | session-worktree-sync + 双端 UI refresh | **移除** |
| pullTemplate / fork | markDirty 或 UI refresh | **移除** |

---

## 最终项目结构

```
packages/core/src/
  domain/chat/logic/
    visibility-batch-range.ts              # 不改 hide 语义
    tail-batch-range.ts                    # 新增
  domain/message-checkpoint/logic/
    truncate-tail-in-transaction.ts        # 新增
  service/chat/
    message-transcript-effects.port.ts     # 新增
    impl/message-transcript-effects.service.ts
    create-message-transcript-effects.ts   # 新增 factory
    message.port.ts                        # 不变（底层 API 保留）
  service/message-checkpoint/impl/
    message-rollback.service.ts            # 用共享 truncate + markDirty
  service/events/impl/
    actions/hide-message.handler.ts        # 改调 effects
    event-orchestrator.service.ts          # 删 hide markDirty
  public/chat.ts                           # export tail-batch + effects 类型

packages/core/test/
  chat/tail-batch-range.test.ts
  chat/message-transcript-effects.test.ts
  message-checkpoint/truncate-tail-in-transaction.test.ts
  session-fs/rollback-to-message.test.ts   # 增补 dirty + 共享 truncate

apps/desktop/src/main/
  ipc/handlers/messages.ts                 # apply* IPC；删 rollback markDirty
  ipc/handlers/vfs.ts                      # 去掉全部 invalidate
  ipc/handlers/sessions.ts                 # 去掉 pullTemplate markDirty
  session-worktree-sync.ts                 # 删除或空实现 vfsMutated 订阅
  runtime/create-desktop-runtime.ts        # wire messageTranscriptEffects

apps/desktop/renderer/
  App.tsx                                  # +删除消息；VFS 菜单去掉 refresh
  features/chat/ConversationPanel.tsx      # delete 模式；effects IPC；去 vfsMutated/fork refresh
  hooks/useBatchSelection.ts               # enterDelete
  features/chat/MessageList.tsx            # tail-batch selectable
  layout/PreviewPane.tsx                   # 去掉 save refresh

apps/mobile/src/
  components/chrome/SessionActionsDrawer.tsx
  hooks/useBatchSelection.ts
  screens/tabs/chat-tab/useChatTabMessages.ts
  screens/tabs/ChatTabScreen.tsx
  screens/tabs/chat-tab/ChatConversationPanel.tsx
  components/batch/MessageBatchHeader.tsx
  components/chat/MessageList.tsx
  web/chat-transcript/main.ts              # tail-batch 对齐 Core
  components/chat/ChatTranscriptBridge.ts
  components/vfs/VfsFileManager.tsx        # 仅规则路径 invalidate；VFS 删改不 reload
  screens/tabs/chat-tab/useChatTabScope.ts # split UI token vs markDirty
  runtime/create-mobile-runtime.ts         # wire messageTranscriptEffects
```

---

## 变更点清单

### Step 0 — Core domain：tail-batch-range

**新增** `packages/core/src/domain/chat/logic/tail-batch-range.ts`

- `restore` 与 `delete` **仅导出同一组函数**；`computeTailBatchRangeFromSelection` 对两模式返回值相同。
- `TailBatchRow.selectable`：由 UI 映射时设置——普通 message 行 `true`；`hide` 模式不走此模块。
- `user_vfs_turn` 卡片：映射为 `{ id: actionMessageId, role, seq, selectable: true }`（与 `user-vfs-turn-view` 一致）。

**迁移** `visibility-batch-range.ts` 中 restore 专用函数：标记 `@deprecated`，内部转调 `tail-batch-range` 或保留 hide 专用、删除 restore 重复实现（推荐后者：hide 留原文件，restore 改从 tail-batch 导入）。

**测试** `tail-batch-range.test.ts`：

- restore / delete 同锚点 → 相同 `selectedIds`、`affectedIds`、`computeTailBatchRangeFromSelection`。
- `tailBatchDeleteAfterSeq(5) === 4`。

### Step 1 — Core：截断事务 + Effects 服务

**新增** `truncate-tail-in-transaction.ts`  
从 `message-rollback.service.ts` 抽出 `truncateTailState` 逻辑；`sweepRevisions` 参数化。

**新增** `MessageTranscriptEffectsService`：

```typescript
// create-message-transcript-effects.ts
export function createMessageTranscriptEffectsService(
  conn: TdbcConnection,
  worktreeSnapshot: SessionWorktreeSnapshotStore,
): MessageTranscriptEffectsService;
```

- `hideMessagesInRange` / `showMessagesInRange`：校验 session 存在 → 底层 `hideRange`/`showRange` → `markDirty`。
- `truncateMessagesAfter`：`conn.transaction` → `truncateTailInTransaction(..., { sweepRevisions: options?.sweepRevisions ?? false })` → `markDirty`。

**修改** `message-rollback.service.ts`：

- `truncateTailState` 改为调用 `truncateTailInTransaction`。
- 注入 `worktreeSnapshot`；`rollbackToMessage` 成功返回前 `markDirty`（**含 `skipVfsReconcile`** 路径——只要有 tail 截断就 dirty）。

**修改** `hide-message.handler.ts`：

- 依赖改为 `MessageTranscriptEffectsService`；`runHideMessageAction` 末尾调 `hideMessagesInRange(projectId, sessionId, from, to)`。
- `CreateEventOrchestratorDeps` / handler deps 传入 `messageTranscriptEffects` + `projectId`（ctx 已有）。

**修改** `event-orchestrator.service.ts`：`hide-message` case **删除** `markDirty` 行。

**导出** `packages/core/src/public/chat.ts`。

### Step 2 — Runtime 接线

**`create-desktop-runtime.ts` / `create-mobile-runtime.ts`**：

```typescript
const worktreeSnapshot = createSessionWorktreeSnapshotStore();
const messages = createMessageService(conn);
const messageTranscriptEffects = createMessageTranscriptEffectsService(
  conn,
  worktreeSnapshot,
);
// runtime 类型增加 messageTranscriptEffects
```

**`detachSessionWorktreeSync`**：删除 `apps/desktop/src/main/main.ts` 中对 `attachSessionWorktreeSync` 的注册，或保留空 stub 待删。

### Step 3 — Desktop IPC

**`handlers/messages.ts`**：

| Handler | 行为 |
|---------|------|
| `handleMessagesHideRange` | 改调 `messageTranscriptEffects.hideMessagesInRange` |
| `handleMessagesShowRange` | 改调 `messageTranscriptEffects.showMessagesInRange` |
| `handleMessagesTruncateAfter` | **新增** → `truncateMessagesAfter` |
| `handleMessagesRollback` | **删除** L262–264 `markDirty` |

**`handlers/vfs.ts`**：移除所有 `invalidateSessionWorktreeSnapshot`（写/删/建/改名/import）。

**`handlers/sessions.ts`**：`handleSessionsPullTemplate` 移除 `markDirty`。

**`handlers/worktree.ts`**：**保留** `setDirRule` / `setFileRule` 的 `invalidateSessionWorktreeSnapshot`。

### Step 4 — Desktop UI

**`App.tsx`**：`#session-actions-menu` 增加「删除消息」→ `runSessionAction("delete-messages")`；`runDirectWorkspaceAction` 中 create/rename **去掉** `refreshWorkspaceTrees`；**保留** `deleteWorkspaceEntry` 的 UI 列表局部更新（非 worktree markDirty）；`include-*` / `DirectoryRuleModal` **保留** refresh。

**`ConversationPanel.tsx`**：

- `useBatchSelection.enterDelete`；`batch.mode === 'delete'` 时 preview 用 `tail-batch-range`。
- `requestBatchConfirm`：`delete` → `ipcMessagesTruncateAfter(projectId, sessionId, afterSeq)` + 文案「仅删除聊天记录…」。
- `hide` / `restore` 改调 `applyHideRange` / `applyShowRange` IPC。
- 移除 `onStepCommitted` / `onRunFinished` 中 `vfsMutated` → `refreshWorkspaceTrees`；移除 fork 后 refresh。
- 回滚 / 批量消息成功后：`reloadMessages` + `refreshWorkspaceTrees`（UI token）。

**`MessageList.tsx`**：批量模式类型扩展；restore/delete 用 `isTailBatchRowSelectable`。

### Step 5 — Mobile UI

**`SessionActionsDrawer.tsx`**：增加「删除消息」。

**`useBatchSelection.ts`**：`enterDelete`；`BatchMode = 'hide' | 'restore' | 'delete'`。

**`useChatTabMessages.ts`**：

- `enterDeleteMessageBatch` / `confirmDeleteBatch` / 扩展 `confirmVisibilityBatch` 或拆分。
- 调用 `runtime.messageTranscriptEffects.*`（非 `messages.hideRange` 直调）。
- 回滚成功：`reloadMessages` + `bumpWorktreeUiToken`；**去掉** `skipVfsReconcile` 时不 bump 的分支。

**`useChatTabScope.ts`**：

```typescript
const bumpWorktreeUiToken = () => setVfsRefreshKey(k => k + 1);
// bumpVfsRefresh 改名为 bumpWorktreeUiToken，移除内部 markDirty
```

**`ChatTabScreen.tsx`**：删除 `handleStepCommitted` / `handleRunFinished` 的 `vfsMutated` → bump。

**`VfsFileManager.tsx`**：

| 操作 | `invalidateSessionSnapshot` |
|------|----------------------------|
| inclusion toggle / dir rule / batch rule / DirectoryRuleSheet | **保留** |
| create / rename / delete file / zip import | **移除** `reloadAfterMutation` 中的 invalidate；仅 `vfs.list` 局部更新列表 |

**`web/chat-transcript/main.ts`**：删除内联 restore role 判断；`batchModeKind === 'delete' | 'restore'` 时调用与 Core 一致的 tail 规则（通过 bridge 传入 `selectable` 标志或共享打包的 tail-batch 函数——推荐 metro 已能 import `@novel-master/core` 的 tail-batch）。

**`MessageBatchHeader.tsx`**：delete 模式标题/确认文案。

### Step 6 — 兼容与迁移

- **底层 API 保留**：`MessageService.hideRange` / `showRange` 仍供测试与 CLI；CLI `nm message hide` 本迭代可不改，或 Step 7 可选改为 effects（非必须）。
- **IPC 破坏性**：Desktop 新增 `truncateAfter`；旧 `hideRange`/`showRange` channel 行为变更（副作用含 dirty）——属预期行为变更，无 wire 版本冲突。
- **`user_vfs_pending`**：tail 截断时 **清空** `user_vfs_pending_json`（tail 有删即清空，实现简单且安全）。
- **revision GC**：批量删 `sweepRevisions: false`；回滚 `true`（与现网 rollback 一致）。

---

## 详细实现步骤

| Step | 内容 | 验证 |
|------|------|------|
| 0 | `tail-batch-range` + 测试 | `pnpm --filter @novel-master/core test tail-batch` |
| 1 | `truncate-tail-in-transaction` + `MessageTranscriptEffectsService` + rollback/hide-message 收敛 | core 单测绿 |
| 2 | Desktop/Mobile runtime 暴露 `messageTranscriptEffects` | 类型检查 |
| 3 | Desktop IPC 黑名单 + 新 truncate handler | integration IPC test（若有） |
| 4 | Desktop UI：delete 批量 + 去 vfsMutated refresh | 手工：删消息、hide、回滚后 worktree 更新 |
| 5 | Mobile UI 对称 + VfsFileManager 收窄 + WebView | 同上 |
| 6 | 全量 `pnpm test`（core + mobile 相关） | CI |

建议 **单 PR、按 Step 0→6 顺序提交**；Core 先合并再改 UI，避免半套 dirty。

---

## 测试策略

### 单元测试（Core）

| 用例 | 断言 |
|------|------|
| tail-batch restore/delete 同锚点 | 勾选集、preview、`fromSeq` 相同 |
| `hideMessagesInRange` | `hidden` 更新 + `worktreeSnapshot.dirty` |
| `showMessagesInRange` | 同上 |
| `truncateMessagesAfter` | seq>afterSeq 消失；checkpoint 清；VFS 不变；dirty |
| `truncateMessagesAfter` vs rollback truncate | 同一 afterSeq 消息集相同；rollback 额外 VFS |
| rollback `skipVfsReconcile` | 仍 dirty |
| hide-message handler | 调 effects，orchestrator 不二次 dirty |

### 集成 / UI（手工）

1. 菜单隐藏 → worktree 宏更新；VFS 保存文件 → worktree **不**闪。
2. 菜单恢复 / 删除 → worktree 更新；VFS 删文件 → worktree **不**闪。
3. 压缩（hide-message）与菜单隐藏后 worktree 行为一致。
4. 回滚（含仅删对话）→ worktree 更新。
5. 改 inclusion / dir rule → worktree 更新。
6. Agent `write` 一轮 → worktree **不**自动刷新。

### 回归

- hide 模式：非 assistant 不可锚点。
- Agent 运行中进入批量 → toast 拦截。

---

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 漏删 UI 路径 markDirty / 双 dirty | 单测 spy `markDirty` 调用次数；Code review 搜 `markDirty`/`invalidateSession` |
| Mobile WebView 与 RN 列表规则分叉 | tail-batch 只来自 Core；WebView bundle 引用同一模块 |
| truncate 后 pending 丢失 | 产品可接受（tail 删本即放弃未 flush turn）；文档注明 |
| 批量删无 revision sweep 遗留垃圾 revision | 与 PRD 一致；回滚仍 sweep；后续可加强 GC |
| Desktop VFS 删文件后列表陈旧 | VfsFileManager 仍 `vfs.list` 更新本地 rows，仅不 markDirty worktree |

**回滚**：功能可逐文件 revert；无 schema 变更。若需 feature flag，可复用 `userVfsUnifiedToolTurn` 旁路旧 refresh（本迭代 **不强制** 加 flag，除非发布前需要）。

---

**状态**：待用户确认 spec 后进入实现。
