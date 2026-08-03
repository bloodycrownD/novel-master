---
date: 2026-06-21
dependency:
  - Iterations/message-delete-worktree-narrow-refresh/prd.md
  - Iterations/vfs-directory-nodes/prd.md
---

# Worktree / VFS 工作区展示与刷新修复 PRD

## 背景

会话 **Worktree** 在现网承担两类消费方，产品口径须分离：

| 消费方 | 用途 | 缓存 / dirty |
|--------|------|----------------|
| **① 工作区 UI + `{{$filetree}}` 宏** | 文件列表、纳入/展示标签；动态宏展开 | **无缓存**，每次按当前 VFS + 规则 **实时计算** |
| **② 提示词持久 worktree 块** | 写入 prompt 的静态 worktree 段落 | **有缓存** + `markDirty`；沿用 `message-delete-worktree-narrow-refresh` 窄刷新口径 |

现网缺口与上述口径不一致：

1. **Mobile `VfsFileManager`** 通过 `getOrRefreshSessionWorktreeSnapshot` 取列表行，误用消费方 ② 的缓存路径。Agent **write** 等工具写盘后，快照未 dirty，列表仍用旧 rows；VFS `list` 多出的路径走 `mapVfsListEntry` 兜底——**目录**错误显示「跟随」（应为「开启/关闭」），**文件**显示「跟随·全内容」；「状态变更」依赖 `worktreeRows` 中的 meta，无 meta 时 **点击无效**。
2. Agent 工具写盘完成后 **不自动** 刷新工作区列表（窄刷新设计）；用户从 **聊天面板切到工作区面板**（含点击 read/write/edit 工具卡片、user_vfs_turn 卡片等入口）时，工作区仍可能展示写盘前的陈旧列表与错误标签。
3. **`{{$filetree}}`** 动态宏已走 `renderFileTree()` 实时渲染；新文件行尾可显示「未加载」（展示规则下的 displayState 标签，非加载失败）。**持久 worktree 块**仍来自缓存快照，可与 UI / 宏 **不一致**——产品接受：工具结果已写入 message，隐藏/删除消息会触发 dirty；不强制写盘后立刻对齐提示词。
4. 双端会话「更多」菜单 **无「刷新工作树」**；用户无法在需要时主动使消费方 ② 与当前 VFS/规则对齐。`message-delete-worktree-narrow-refresh` 曾将手动按钮标为不包含，本迭代补回。

**与窄刷新的关系：** 消费方 ② 的 `markDirty` 触发时机 **不变**（消息 hide/show/delete/回滚截断、规则变更）。本迭代 **不** 因 Agent/VFS 写盘而 `markDirty`；仅修正消费方 ① 的数据源与切换时机，并新增消费方 ② 的手动刷新入口。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 消费方分离落地 | 工作区 UI 与 `{{$filetree}}` 不再读取 session worktree **快照缓存**；提示词持久块仍走缓存 + dirty |
| 修复写盘后的列表与标签错误 | 工具 write 后从聊天 **切入工作区**，目录为「开启/关闭」、文件纳入标签正确；「状态变更」可切换 |
| 工作区切换时实时列表 | 任意 **聊天 → 工作区** 面板切换触发消费方 ① 重载（**不** `markDirty`） |
| 手动刷新提示词 worktree | 双端会话「更多」新增 **刷新工作树**，仅 invalidate 消费方 ② |
| 接受提示词与 UI 可短暂不一致 | 写盘后未手动刷新时，持久 worktree 块可与 UI/`{{$filetree}}` 不同；文档与验收明确为 **预期** |

## 用户与场景

**用户：** Mobile / Desktop 使用会话聊天与工作区的作者与调试者。

**场景：**

1. **Agent write 后查看文件：** 模型写入 `/notes/ch1.md`，用户从工具卡片或底部 Tab 进入工作区，应看到 `notes` 目录与 `ch1.md`，目录规则为开/关、文件可改纳入状态。
2. **调试提示词：** 写盘与改规则后，用户打开「查看提示词」，持久 worktree 块可能仍旧；点「刷新工作树」后再查看，块内容与当前规则/消息可见性一致。
3. **宏与 UI 对照：** `{{$filetree}}` 在发送前展开为实时树；用户理解「未加载」为展示档位标签，不要求与持久块逐字相同。

## 范围

### 包含范围

- **双端**工作区文件树列表：改走消费方 ① 实时 API（如 `materialize` / `buildListRows` + 规则评估，**不经** `getOrRefresh` 缓存）
- **双端**聊天面板 → 工作区面板切换时，触发工作区列表 **实时重载**（不 `markDirty`）
- 修复 VFS 路径与 worktree 行合并时的 **目录/文件标签** 与 **状态变更** 交互（含原 `mapVfsListEntry` 兜底语义）
- Mobile `SessionActionsDrawer`、Desktop 会话 Composer「更多」菜单新增 **刷新工作树**（`markDirty` + 提示成功；**不**强制重载消费方 ①，因其本应已实时）
- 产品说明：`{{$filetree}}` 实时、持久块缓存、写盘后不自动 dirty 为 **设计行为**

### 不包含范围

- 改变窄刷新 `markDirty` 触发集（不因 Agent write / 用户 VFS 写盘自动 dirty）
- Agent 写盘完成瞬间 **自动** 刷新工作区（仍 lazy；仅面板切换时刷新）
- 「查看提示词」打开时 **自动** `markDirty`（消费方 ② 仍依赖 dirty 与手动刷新）
- VFS「⋯」菜单内的刷新入口（仅会话更多）
- Desktop 工具卡片点击打开文件（若尚未实现，不在本迭代强行新增；面板切换刷新仍适用）
- `{{$filetree}}` 与持久块 **强制一致**、或消除「未加载」标签语义变更
- Core 事件 `refresh-macros` 复活

## 核心需求

1. **消费方分离：** 工作区 UI 与 `{{$filetree}}` 宏展开 **禁止** 使用 `SessionWorktreeSnapshotStore.getOrRefresh` 的缓存结果作为列表/树的数据源；提示词组装中的 **持久 worktree 块** 继续使用快照缓存。
2. **目录标签正确：** 工作区列表中，**目录行**仅展示目录规则 **「开启」/「关闭」**（及子文件数等），**不得** 对目录使用文件纳入态「跟随」。
3. **状态可变更：** 对实时 worktree 行（含写盘后新出现的文件/目录），「状态变更」须能切换文件纳入或目录规则开/关，切换后 **规则类** 变更仍 `markDirty`（沿用现网）。
4. **面板切换刷新：** 用户从 **聊天** 切换到 **工作区** 时（Mobile `conversationPanel`、Desktop 等价布局），工作区文件列表 **立即** 按消费方 ① 重算并重绘；**不** `markDirty`。
5. **手动刷新工作树：** 会话「更多」提供 **刷新工作树**，执行 `markDirty`（及消费方 ② 所需的重算），供用户主动对齐 **提示词持久 worktree 块**；操作后给予明确反馈。
6. **提示词与 UI 可不一致（设计）：** Agent 工具写盘、用户 VFS 写盘 **不** 自动使持久 worktree 块更新；用户可通过删/隐消息、改规则、或手动「刷新工作树」更新消费方 ②。`{{$filetree}}` 与 UI 同为实时源，彼此一致；二者可与持久块不同直至用户刷新消费方 ②。

## 验收标准

### 消费方 ①（UI + `{{$filetree}}`）

- **Given** 会话中 Agent 刚通过 write 创建 `/foo/bar.md`，且未 `markDirty`  
  **When** 用户从聊天面板切换到工作区（任意入口，含工具卡片）  
  **Then** 工作区列表出现 `foo` 与 `bar.md`；`foo` 徽章为「开启」或「关闭」（非「跟随」）；`bar.md` 纳入/展示标签与实时规则一致；对二者执行「状态变更」可成功切换。

- **Given** 工作区已展示某目录  
  **When** 用户仅切换聊天 ↔ 工作区 Tab，期间 VFS 无变更  
  **Then** 列表内容与切换前一致（无多余闪动即可；允许合理 loading）。

- **Given** 动态提示词含 `{{$filetree}}`  
  **When** 在 write 后、未手动刷新工作树前展开宏  
  **Then** 宏输出包含新路径（实时）；新文件行尾可出现「未加载」等等级标签，属预期。

### 消费方 ②（提示词持久块 + dirty）

- **Given** `message-delete-worktree-narrow-refresh` 所列 dirty 动作（消息 hide/show/delete/回滚、规则变更）  
  **When** 动作完成  
  **Then** 行为与现网窄刷新 PRD 一致（`markDirty` 仍仅在这些路径触发）。

- **Given** Agent write 完成且未发生上述 dirty 动作  
  **When** 用户打开「查看提示词」  
  **Then** 持久 worktree 块 **可以** 不含新文件（预期）；`{{$filetree}}` 动态区若存在则可含新文件。

- **Given** 写盘后持久块与现网不一致  
  **When** 用户在会话「更多」点击 **刷新工作树** 后再次「查看提示词」  
  **Then** 持久 worktree 块反映当前消息可见性与规则下的 worktree 展示。

### 双端与入口

- **Given** Mobile 与 Desktop 各一会话  
  **When** 检查会话「更多」菜单  
  **Then** 均存在 **刷新工作树**；VFS 局部「⋯」菜单 **无** 该项。

- **Given** Desktop 会话布局  
  **When** 从聊天侧切换至工作区/资源管理视图  
  **Then** 满足与 Mobile 相同的「面板切换 → 消费方 ① 重载」行为。
