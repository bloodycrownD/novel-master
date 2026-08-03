---
date: 2026-06-20
dependency:
  - Iterations/message-visibility/prd.md
  - Iterations/vfs-user-ops-unified-tool-turn/prd.md
---

# 删除消息批量与 Worktree 窄刷新 PRD

## 背景

双端会话「更多」菜单已提供 **隐藏消息**、**恢复消息** 专用批量模式，交互与范围计算由 `visibility-batch-range.ts` 统一。`vfs-user-ops-unified-tool-turn` 迭代移除了通用批量删除，仅保留 hide/restore；当前 **无「删除消息」** 入口，长按菜单亦无单条删除。

恢复模式仅允许勾选 `user` 行；隐藏模式仅允许勾选 `assistant` 行。用户希望 **恢复** 与新增的 **删除** 放宽为任意 transcript 行（含 assistant、user、合成 card 行）均可作锚点，并共用 **同一套** 级联规则（锚点下方全选），**不维护 restore / delete 两套独立逻辑**。

Worktree 快照刷新方面，现网会在 VFS 写删改、Agent mutating 工具、pullTemplate、rollback 等路径 `markDirty` 并刷新工作区 UI。用户确认新口径：

- **刷新**：**消息**隐藏、**消息**删除（含批量删与 **回滚** 截断 tail）、**消息**恢复显示、**规则**变化。
- **不刷新**：纯 **VFS 操作**（删文件、编辑、写盘、建目录等）——用户 VFS 变更经 **user ops 卡片** 写入 transcript，模型已可见，**无需** 重算 worktree；回滚虽会 reconcile VFS，但触发刷新的原因是 **消息被删**，与 VFS 文件树是否变化无关。

压缩不单独触发；压缩链路内 `hide-message` 归入「**消息**隐藏动作」。

**统一实现原则（产品定案）：** 同类消息副作用必须走 **同一 Core 入口**，worktree `markDirty` 在该入口内 **集中触发**，UI / 事件编排 / IPC 只负责算范围并调用，**禁止**各端各自 `hideRange` / `deleteAfterSeq` 后再零散补 dirty。现网缺口：菜单批量隐藏直调 `hideRange` 而未 markDirty；压缩 hide 经 orchestrator 才 dirty——本迭代须收敛。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 双端支持「删除消息」批量 | Mobile `SessionActionsDrawer`、Desktop Composer「更多」均新增菜单项；进入批量模式后 UX 与恢复消息一致 |
| restore / delete **一套级联** | Core 单一范围函数；restore 与 delete 仅确认后 API 不同，选择/预览/锚点级联 **零分叉** |
| restore / delete 全 role 可选 | assistant、user、合成 card（如 `user_vfs_turn` 展示行）均可作锚点 |
| 删除为 transcript 截断 + checkpoint 清理 | 确认后截断 tail 消息；**不恢复 VFS**；附着于被删消息的 checkpoint **一并移除**（与回滚无关，消息没了锚点即失效） |
| Worktree 窄刷新落地 | 仅 §Worktree 刷新时机 所列动作后 markDirty 并刷新 UI |
| VFS 操作不刷新 worktree | 删/改/写/建/导入、Agent 工具写盘、文件保存等 **均不** markDirty |
| **消息副作用单入口** | 隐藏 / 恢复 / 截断删消息 各一条 Core 路径；worktree 刷新内聚其中，无遗漏、无重复 |

## 用户与场景

**用户**：在 Mobile / Desktop 使用会话聊天的作者与调试者。

**场景**：

1. **裁剪 transcript**：对话尾部实验失败，需从某条消息起物理删除后续记录，工作区文件不动；悬空 checkpoint 自动清掉；worktree 宏随 transcript 变短而更新。
2. **恢复已隐藏段**：从任意类型消息行作锚点，恢复其下方曾被 hide 的消息；worktree 重新纳入这些消息。
3. **减少无意义刷新**：用户改文件 / 删工作区文件后列表不再闪动（transcript 已有 user ops 卡片）；仅在改 **消息**可见性/删 **消息**/改 **规则** 时更新 worktree。

## 范围

### 包含范围

- **Core 单入口**：消息 hide / show / tail 截断删 各统一实现（见 §统一实现原则）
- Mobile、Desktop 更多菜单新增 **删除消息**
- **统一级联模块**：`restore` 与 `delete` 共用同一套锚点/范围/预览函数；**禁止** restore 一套、delete 另一套
- 全 role 可勾选（restore / delete）；级联：点击锚点 → 勾选所有 `seq ≥ anchor.seq` 的可选行
- 新增 `delete` 批量模式：调用与回滚 **共用的 tail 截断** Core 入口（**不**做 VFS reconcile）
- Worktree：剥离 VFS 全路径、Agent `vfsMutated`、pullTemplate、fork 等 dirty / UI refresh
- Worktree：消息 hide / show / delete（含回滚截断）与规则变更后 markDirty + UI 刷新
- Agent 运行中进入批量模式仍拦截（与现 hide/restore 一致）

### 不包含范围

- **隐藏消息** 模式的 role 限制与级联方向（仍为 assistant 锚点、seq ≤ anchor）——本迭代不改
- 删除消息恢复 VFS（与长按「回滚」区分；回滚仍走 checkpoint + VFS reconcile）
- 【工作树刷新】手动按钮（若后续需要可单独立项）
- CLI 新增 `nm message delete`（可后续补齐；本迭代聚焦双端 UI）
- 单条长按菜单恢复「删除」
- Worktree 窄刷新以外的 VFS unified tool turn 其余条目

## Worktree 刷新时机（唯一口径）

Worktree 快照失效 + 工作区 UI 刷新 **仅** 在下列 **动作完成** 后发生：

| 动作 | 含义 | 示例 |
|------|------|------|
| **消息隐藏** | 消息对 LLM 变为不可见 | 手动批量 `hideRange`、压缩链路内 `hide-message` |
| **消息删除** | 聊天记录物理截断 | 批量「删除消息」、`deleteAfterSeq`；**回滚**（`rollbackToMessage` 删 tail） |
| **消息恢复显示** | 曾被 hide 的消息重新可见 | 批量「恢复消息」确认、`showRange` |
| **规则变化** | worktree 纳入/展示规则变更 | 目录规则开/关、文件 inclusion、dir/file rule 编辑 |

**刷新 vs 规则变更（勿混淆）：** worktree 刷新指 **快照/宏展示重算**（transcript 可见消息集或纳入规则变了，prompt 里的 worktree 块需更新）。回滚会 reconcile VFS，但 **通常不改** inclusion/目录规则配置；仍须刷新，因为 **tail 消息被删**，worktree 宏所依赖的会话上下文已变——这与「规则变化」是不同维度，可叠加发生。

**为何纯 VFS 操作不刷新：** 用户 VFS 变更经 unified tool turn 写入 transcript（user ops 卡片），模型读 transcript 即可感知；单次写删文件 **不改变** worktree 规则配置，故 **VFS 删除、编辑、写盘、建目录、导入等均不 markDirty**。

**明确不属于刷新触发：**

- 纯 VFS **删 / 改 / 写 / 建 / 改名 / 导入**（无 transcript 消息删改）
- Agent 工具写盘、`vfsMutated` 事件
- session 文件保存、pullTemplate、fork
- **压缩** 作为独立事件—— 有 `hide-message` 时归入「消息隐藏」；无 hide 副作用时不额外 dirty

## 统一实现原则

同类操作 **一个 Core 入口**；worktree 刷新 **写进入口内**，不散落 UI / IPC / orchestrator。这样压缩、菜单、回滚、批量删 **自然** 获得一致的副作用与刷新行为。

| 消息副作用 | 统一入口（概念名，spec 定具体 API） | 调用方 |
|------------|--------------------------------------|--------|
| **隐藏** | `hideMessagesInRange(sessionId, fromSeq, toSeq)` → 内部 `hideRange` + `markDirty` | 菜单批量隐藏、压缩 `hide-message` action、CLI |
| **恢复显示** | `showMessagesInRange(sessionId, fromSeq, toSeq)` → 内部 `showRange` + `markDirty` | 菜单批量恢复、CLI |
| **截断删 tail** | `truncateMessagesAfter(sessionId, afterSeq)` → 内部 `deleteAfterSeq` + checkpoint 清理 + `markDirty` | 菜单批量删除、回滚（回滚在此之上 **额外** VFS reconcile + revision GC） |

**回滚 vs 批量删：** 回滚 **不是** 另一套删消息逻辑；回滚 = `truncateMessagesAfter`（或等价）+ VFS 正向恢复到锚点 checkpoint。批量删只调用截断入口，`skipVfsReconcile` 语义内聚。二者因共享截断实现，worktree 刷新 **只维护一处**。

**压缩 vs 菜单隐藏：** 压缩 `hide-message` **不得** 单独 `hideRange` 后再由 orchestrator 补 dirty；应调用与菜单相同的 **隐藏入口**（或隐藏入口被 action handler 委托）。orchestrator 不再单独 `markDirty`（避免双路径）。

**规则变化：** worktree 规则写入服务内 `markDirty`（与消息入口并列，同属 Core 白名单副作用）。

## 核心需求

### 消息批量（restore / delete）

1. **更多菜单**：Mobile `SessionActionsDrawer`、Desktop `#session-actions-menu` 在「恢复消息」旁增加「删除消息」，点击进入 `delete` 批量模式。
2. **一套级联规则（强制）**：restore 与 delete **必须** 调用同一组 Core 函数完成：可勾选判定、锚点级联、`seq` 范围预览、最小选中 `seq` 计算。两种模式 **仅** 在确认回调中分支（`showRange` vs `deleteAfterSeq` + checkpoint 清理）。UI 层不得各自实现第二套范围逻辑。
3. **选择与级联**：任意 transcript 行可勾选；点击锚点重置勾选集为所有 `seq ≥ anchor.seq` 的可选行。
4. **删除确认**：调用 **截断删 tail 统一入口**；**不** 恢复 VFS；toast「已删除」。
5. **恢复确认**：调用 **恢复显示统一入口**；选中与 delete 同一函数产出。

### Checkpoint 与回滚区分

| 能力 | 删消息批量 | 长按回滚 |
|------|-----------|----------|
| 截断 tail 消息 | ✓ | ✓ |
| 删除 tail checkpoint | ✓（清理悬空锚点） | ✓ |
| 恢复 VFS 到锚点树 | ✗ | ✓ |
| revision GC / 文件回退 | ✗ | ✓（按 rollback 计划） |
| 刷新 worktree（快照重算） | ✓ | ✓（因 tail 消息删除，与是否改纳入规则无关） |

删除批量 **不是** 回滚的简化版：不做 VFS 正向恢复；仅保证「消息没了，对应 checkpoint 也不留」。

### Worktree 窄刷新

6. **白名单**：§Worktree 刷新时机 所列动作，其 `markDirty` **仅** 出现在对应 Core 统一入口（及规则写入服务）内；UI/IPC **不** 再零散调用 `markDirty`。
7. **黑名单剥离**：移除纯 VFS 操作、Agent `vfsMutated`、pullTemplate、fork、文件保存等路径上的 dirty / refresh。
8. **收敛现网双路径**：菜单 `hideRange` 与压缩 `hide-message` 合并为同一隐藏入口；回滚与批量删合并为同一截断入口。

## 验收标准

### 一套级联（restore / delete）

- **Given** 同一会话、同一锚点 seq=N，**When** 分别进入 restore 与 delete 模式并点击该行，**Then** 勾选集与顶栏预览范围 **完全一致**。
- **Given** Core 范围函数单测，**When** 传入 restore 或 delete mode，**Then** 锚点/范围/预览逻辑走 **同一代码路径**（仅确认 API 不同）。
- **Given** Desktop 与 Mobile，**When** 同一锚点操作，**Then** 勾选与预览 **一致**（均来自 Core）。

### 删除与 checkpoint

- **Given** seq≥5 的消息含 checkpoint 锚点，**When** 用户确认 delete 批量（锚点 seq=5），**Then** seq≥5 消息移除；checkpoint 行清除；VFS **不变**；worktree **已刷新**。
- **Given** 用户需删消息并恢复工作区文件，**When** 使用长按「回滚」，**Then** 走 rollback（VFS reconcile + 删 tail）；与 delete 批量 **不同**，但二者完成后 worktree **均须刷新**。

### 恢复

- **Given** restore 模式锚点 seq=3，**When** 确认恢复，**Then** `showRange(3, maxSeq)`；worktree **已 markDirty 并刷新**。

### 隐藏模式（回归）

- **Given** 进入「隐藏消息」，**When** 点击非 assistant 行，**Then** 仍不可作锚点（行为与改前一致）。
- **Given** 批量隐藏或压缩 hide-message 完成，**When** 下次读 worktree，**Then** 已刷新。

### 统一入口与 worktree

- **Given** 菜单批量隐藏与压缩 hide-message，**When** 对同一 `fromSeq/toSeq` 执行，**Then** 均调用 **同一** Core 隐藏入口；worktree dirty **恰好一次**。
- **Given** 批量删消息与回滚（messages-only 截断部分），**When** 截断到同一 `afterSeq`，**Then** 消息删除与 checkpoint 清理走 **同一** Core 截断入口；回滚额外只做 VFS 层。
- **Given** 任一消息统一入口成功，**When** 检查调用栈，**Then** `markDirty` 仅出现在该入口（及规则服务）内，不在 `ConversationPanel` / `useChatTabMessages` / `event-orchestrator` 重复。

### Worktree 窄刷新

- **Given** 消息隐藏 / 消息删除（含批量删） / 消息恢复显示 / 规则变化 / **回滚截断 tail** 任一完成，**When** 下次读 worktree 快照，**Then** 已刷新。
- **Given** VFS 删除文件、VFS 编辑保存、VFS 新建、Agent `write`、pullTemplate、fork，**When** 操作成功且 **未** 删改 transcript 消息，**Then** worktree **不** 自动刷新。
- **Given** 压缩仅触发 hide-message，**When** hide 完成，**Then** 按「消息隐藏」刷新；**无** compaction-only 额外 dirty。

## 约束与依赖

- 依赖 `message-visibility` 的 hide/show API 与批量 UI 骨架。
- 依赖 `vfs-user-ops-unified-tool-turn` 的 user ops 卡片语义（VFS 变更对模型可见，故 worktree 不因 VFS 刷新）。
- 删除批量二次确认须标明：「仅删除聊天记录，不修改工作区文件；相关检查点将一并清除」。

## 风险与待确认项

- `deleteAfterSeq` 后 `user_vfs_pending` 是否与 tail 对齐，需在实现 spec 中核对。
- tail revision GC：删除批量不做 VFS 回退；是否对仅被删 checkpoint 引用的 revision 做 GC，实现 spec 细化（产品要求至少清除 checkpoint 行）。
