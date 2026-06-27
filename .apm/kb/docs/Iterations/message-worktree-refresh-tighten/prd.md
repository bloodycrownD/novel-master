---
date: 2026-06-27
dependency:
  - Iterations/message-delete-worktree-narrow-refresh/prd.md
  - Iterations/worktree-vfs-ui-refresh-fix/prd.md
---

# 消息 Worktree 刷新收窄与批量选择 PRD

## 背景

[`message-delete-worktree-narrow-refresh`](../message-delete-worktree-narrow-refresh/prd.md) 曾将 **消息删除**（含批量删、回滚截断）纳入 worktree `markDirty` 与 UI 刷新口径，理由是 transcript 变短后 prompt 上下文变化。

现网实现中，持久 worktree 块（消费方 ②）由 **VFS + worktree 规则** 物化，**不依赖** `message.hidden` 或 transcript 条数（见 `DefaultWorktreeService.materialize()` 与 `render-prompt.ts` 中 chat 段与 worktree 块分离）。用户确认新口径：

- **应刷新 worktree**：消息 **隐藏**、**恢复显示**、**压缩**（链路内 hide-message）、**手动刷新工作树**、**规则变更**（目录/文件 inclusion，沿用现网）。
- **不应刷新 worktree**：**消息删除**（批量 truncate）、**回滚**（含 VFS reconcile 与降级截断）——与「仅删聊天记录、工作区文件按各自路径变更」一致。

另：Mobile / Desktop 批量 **delete / restore** 现网对任意 transcript 行均可作锚点；用户希望 **delete 仅未隐藏、restore 仅已隐藏** 可选，**tail 级联 seq 语义不变**。双端同步（用户已确认）。

长按菜单对 **已隐藏** 消息仍展示「回滚」，与「hidden 为软移除、回滚为硬截断+VFS」语义冲突，应移除。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 收窄 worktree 刷新 | delete / rollback 后 Core **不** `markDirty`；双端 **不** bump 消费方 ① UI |
| 保留 visibility 刷新 | hide / show / 压缩 hide / 规则变更 / 手动刷新行为与现网一致或更窄（不扩大） |
| 批量选择按 hidden 分流 | delete 仅 `hidden=false` 可勾选；restore 仅 `hidden=true` 可勾选；双端一致 |
| 级联不变 | 确认后仍按 `seq` 下界 truncate / showRange；中间不可选 hidden/visible 行仍被范围覆盖 |
| 隐藏消息无回滚 | 双端 RN 菜单 + Mobile WebView 菜单对 hidden 行不展示「回滚」 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 长会话作者 | 批量删除失败实验尾部，**不**触发工作区列表闪动；prompt token 仍随 transcript 更新 |
| 整理上下文 | 批量恢复曾 hide 的段落，worktree 与 hide 路径一致刷新 |
| 调试 / 回滚 | 对 **可见** 消息回滚；已 hide 的「归档」消息不再误触 VFS 回滚 |
| 压缩后 | 压缩触发的 hide 仍使 worktree 快照失效（现网 Core 路径） |

## 范围

### 包含范围

- Core：`truncateMessagesAfter`、`rollbackToMessage` 移除 `markSessionWorktreeDirty`
- Core：`tail-batch-range` 增加 `hidden` 与 mode 相关可选规则（delete / restore）
- Mobile + Desktop：批量选择、确认预览、UI 刷新分支、长按/WebView 菜单
- 相关单测与 export 快照更新

### 不包含范围

- **hide 批量** 仍仅 assistant 锚点、prefix 级联（不改为「仅未隐藏 assistant」——可后续单独立项）
- 压缩后 Mobile 补 `bumpWorktreeUiToken`（现网仅 dirty ②，本迭代不扩大）
- CLI 新命令
- 回滚成功后自动 toast「请手动刷新工作树」（可后续体验优化）

## 核心需求

1. **删除 / 回滚不刷新 worktree**：含 Core markDirty 与 Mobile `bumpWorktreeUiToken`、Desktop `notifyWorkspaceMutated`。
2. **hide / restore 批量仍刷新 worktree UI**（与 hide/show markDirty 一致）。
3. **delete 批量**：仅未隐藏消息可作锚点；restore 批量：仅已隐藏消息可作锚点；级联与 seq 确认 API 不变。
4. **hidden 消息长按菜单**不含「回滚」（Mobile RN + WebView、Desktop）。
5. **双端行为一致**（批量选择与刷新分支）。
6. **手动「刷新工作树」、规则变更** 刷新口径不变。

## 验收标准

### Worktree 刷新

- **Given** 会话存在 worktree 快照且已物化，**When** 批量 delete 或 rollback（含 skipVfsReconcile）成功，**Then** `worktreeSnapshot.isDirty` 为 **false**（或未从 false 变 true），且 Mobile 工作区 tab **不**因该操作 alone 重载。
- **Given** 同上，**When** 批量 hide 或 restore 成功，**Then** markDirty 为 true，Mobile 工作区 tab 重载（或 vfsRefreshKey 递增）。
- **Given** 手动压缩触发 hide-message，**Then** Core markDirty（现网），本迭代 **不** 要求 Mobile UI bump。

### 批量选择

- **Given** delete 批量模式，**When** 点击 hidden 消息，**Then** 不可选 / 不更新选中集。
- **Given** delete 模式选中 visible 锚点 seq=N，**When** 确认，**Then** truncate 自 N 起（含其后 hidden 行）。
- **Given** restore 批量模式，**When** 点击 visible 消息，**Then** 不可选。
- **Given** restore 模式选中 hidden 锚点，**When** 确认，**Then** showRange 自 min(selected) 至 sessionMaxSeq。
- **Given** Desktop ConversationPanel，**Then** 与 Mobile 相同规则。

### 长按菜单

- **Given** `hidden=true` 的消息，**When** 长按，**Then** 菜单无「回滚」；编辑/复制/分叉规则不变。
- **Given** `hidden=false`，**Then** 仍有「回滚」（Agent 未运行等现网拦截不变）。

### 回滚后工作区

- **Given** 完整回滚 reconcile VFS 成功，**When** 未手动刷新，**Then** 工作区列表可能滞后（**接受**）；**When** 用户点击「刷新工作树」，**Then** 快照 dirty 并在下次 getOrRefresh 更新。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 回滚后工作区 UI 滞后 | 产品已接受；完整回滚后依赖手动刷新或切 tab reload |
| 修订前置 PRD | 与 `message-delete-worktree-narrow-refresh` §Worktree 刷新时机 部分相反，以本 PRD 为准 |

---

**文档路径**：`.apm/kb/docs/Iterations/message-worktree-refresh-tighten/prd.md`  
**下一步**：确认 PRD → 确认 [`spec.md`](./spec.md) → 实现
