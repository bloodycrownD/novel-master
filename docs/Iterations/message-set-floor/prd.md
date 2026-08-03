---
date: 2026-07-11
dependency:
  - Iterations/message-visibility/prd.md
  - Iterations/vfs-user-ops-unified-tool-turn/prd.md
  - Iterations/message-delete-worktree-narrow-refresh/prd.md
  - Iterations/message-worktree-refresh-tighten/prd.md
---

# 消息置位 PRD

> **平台**：Mobile（Android + iOS）+ Desktop（`apps/mobile`、`apps/desktop`）  
> **性质**：会话消息可见性交互重组——以长按「置位」替代 hide/restore 批量模式；精简会话菜单；**物理删除** App 内批量多选 UI 代码；**不删除** Core 层 hide/show/truncate 能力与 CLI。  
> **Supersede（快照 / dirty）**：[`worktree-engine-convergence`](../worktree-engine-convergence/prd.md) 已 supersede 本 PRD 中 **worktree 快照 / markDirty / isDirty** 相关验收口径（置位完成后由 **置位应用入口显式 capture**；Core hide/show 不附带快照副作用）。**本 PRD 仍管辖**：置位语义、transcript 可见性、批量 UI 删除、双端 UI 刷新触发（`bumpWorktreeUiToken` / `notifyWorkspaceMutated`）。

## 背景

当前双端消息可见性整理依赖 **三种独立批量多选模式**（隐藏 / 恢复 / 删除），入口在：

- Mobile：`SessionActionsDrawer`（顶栏 ☰）→「隐藏消息」「恢复消息」「删除消息」
- Desktop：Composer 左下 ⋯ → 同上三项

各模式规则不同（hide 仅 assistant 前缀、restore 仅 hidden 后缀、delete 仅 visible tail 截断），用户需先进入批量模式、再点锚点、再确认，学习成本高。

长按菜单经 [`vfs-user-ops-unified-tool-turn`](../vfs-user-ops-unified-tool-turn/prd.md) 收敛后，仅保留 **编辑、复制、分叉、回滚**，已无 hide/restore/delete。

常见诉求是：**以某条 user/assistant 消息为 LLM 上下文起点**——更早历史软隐藏（仍可在 transcript 备查），该条及之后全部纳入 prompt；**不删行、不动 VFS**。现网需分两次批量（hide + restore）或手动组合，无一键入口。

产品决策：

1. 新增长按菜单项 **「置位」**：一次操作完成「锚点之前全隐藏 + 锚点及之后全解除隐藏」；**仅** 底层 `role` 为 `user` 或 `assistant` 的消息行可用，**工具卡片不支持**。
2. 从会话菜单/抽屉 **移除**「隐藏消息」「恢复消息」「删除消息」及对应批量多选 UI；相关 **UI 代码物理删除**（非仅断入口）。
3. **App 内不再提供**「仅截断聊天记录、不改工作区」的批量删除入口；需要截断时改用 **回滚**（含降级「仅删除后续对话」）。Core `truncateMessagesAfter`、CLI 等 **后端能力保留**，本迭代不删 API。
4. **工作树刷新**：置位 **完整继承** 现网 hide / unhide（show、恢复显示）的工作树刷新机制，与 delete / rollback **不刷新** 路径严格区分。

## 目标（含成功指标）

| 目标           | 成功指标                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| 一键置位       | 用户对 **user/assistant 消息行** 长按 →「置位」→ 确认后，锚点 `seq` 之前消息对 LLM 不可见，锚点及之后消息对 LLM 可见 |
| 工具卡片隔离   | 对 **工具卡片**（含 `user_vfs_turn` 合成行、transcript 内 tool 展示卡片）长按 **不出现**「置位」                     |
| 菜单精简       | Mobile 会话抽屉、Desktop 会话 ⋯ 菜单 **不再出现** hide/restore/delete 三项                                           |
| 代码精简       | hide/restore/delete **批量多选 UI 及专属测试物理删除**，仓库内无用户可达残留                                         |
| 语义清晰       | 用户能区分：**置位**（软可见性）、**回滚**（截断 + 恢复工作区）、**分叉**（新会话）                                  |
| 双端一致       | Mobile RN 菜单、Mobile WebView 菜单、Desktop 右键/⋯ 菜单项与确认文案一致                                             |
| 工作树刷新继承 | 置位成功后 **应用层 capture** + 双端 UI 刷新行为 **与批量 hide / 批量 restore 一致**（非 delete/rollback 路径；snapshot/capture 见 WEC） |
| 后端保留       | Core hide/show/truncate API 与 CLI `nm message hide/show` **仍可用**；仅 App UI 入口变更                             |

## 用户与场景

| 用户         | 场景                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------ |
| 长会话作者   | 对话已跑很长，希望模型「从某条 user/assistant 消息起」只看后续上下文，前面历史仍可在列表灰显备查 |
| 整理实验分支 | 曾 hide 过多段或 restore 不完整，需 **一次性** 把可见窗口重置到某条消息                          |
| 误 hide 恢复 | 对某条 hidden 的 user/assistant 消息置位，使该条及之后重新进入 prompt                            |
| 需物理截断   | App 内用 **回滚**（或回滚降级仅删对话）；不再从会话菜单进批量删                                  |

## 范围

### 包含范围

**A. 长按菜单新增「置位」**

- 展示位置：与现网 **编辑、复制、分叉、回滚** 同级（建议：复制之后、分叉之前）。
- **展示条件（锚点资格）**：
  - **支持**：底层 `ChatMessage.role` 为 **`user` 或 `assistant`** 的消息行（含 `hidden=true` 行）。
  - **不支持**：**工具卡片**——包括但不限于：
    - `user_vfs_turn` 合成展示行（VFS 操作卡片）；
    - transcript 内以工具卡片形式展示的 `tool_use` / `tool_result` 等（非独立 user/assistant 消息行处）。
  - 对上述不支持对象：长按菜单 **不含「置位」**；若仅含工具卡片而无消息级菜单，行为与现网工具卡片长按一致。
- 交互：点击 → 二次确认 → 执行置位 → Toast 成功（或无可变更时提示）。
- Agent **运行中**禁止置位（与分叉/回滚一致，双端拦截）。

**B. 「置位」业务语义**

以用户所选 **合格消息** 的 `seq = N` 为锚点：

| 区间             | 效果                                                 |
| ---------------- | ---------------------------------------------------- |
| `seq < N`        | 全部 **隐藏**（`hidden=true`），不进 LLM prompt      |
| `seq ≥ N`        | 全部 **解除隐藏**（`hidden=false`），进入 LLM prompt |
| 消息行           | **不物理删除**                                       |
| VFS / 工作区文件 | **不变**                                             |
| checkpoint       | **不清理**（与回滚/批量删不同）                      |

锚点始终对应 **一条底层 message 的原始 seq**（非工具卡片展示 id）。**不**扩展到配对 `tool_result`；**不**调用 `resolveRollbackAnchorMessage`（与 rollback 锚点规则刻意区分）。

**C. 确认文案（双端一致）**

- 标题：**置位到此消息？**
- 正文：**此消息之前将不参与提示词，此消息及之后将恢复可见。**
- 确认按钮：**置位**；取消：**取消**
- 非 destructive 样式（与回滚区分）

**D. 会话菜单精简**

从下列入口 **移除** 三项及关联批量多选流程：

- Mobile `SessionActionsDrawer`：「隐藏消息」「恢复消息」「删除消息」
- Desktop `#session-actions-menu`：同上

移除后抽屉/菜单保留项（现网其余项，如重命名、查看提示词、压缩、刷新工作树等）**不变**。

**E. 批量多选 UI 物理删除（App）**

本迭代 **物理删除**（非仅隐藏入口）hide / restore / delete 消息批量多选相关 UI 与 wiring，包括但不限于：

| 类别            | 示例（实现阶段对照删除，非穷举）                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Mobile 顶栏     | `MessageBatchHeader` 及消息批量专用逻辑                                                                                   |
| Desktop 顶栏    | `#chat-batch-bar` 及消息批量专用逻辑                                                                                      |
| 状态与入口      | 会话菜单进入 `enterHide` / `enterRestore` / `enterDelete` 的 chat 路径；transcript `batchMode` 下发（消息批量）           |
| 抽屉/菜单 props | `SessionActionsDrawer` / `App.tsx` 中 hide/restore/delete 回调与菜单项                                                    |
| Desktop 传参链  | `App.tsx` → `MainShell.tsx` → `ChatRail.tsx` → `ConversationPanel` 的 `messageBatch` props；`runSessionAction` 导出与调用 |
| 专属测试        | 上述组件与流程的批量多选单测/集成测（消息批量语境）                                                                       |

**保留**：`useBatchSelection` 等若仍被 **非 chat 场景**（如 Agent 列表、Provider 列表、Desktop Settings）使用，仅删除 **消息 transcript 批量** 相关分支，不破坏其他列表批量能力。双端删除 `enterHide` / `enterRestore` / `enterDelete` 后须 **强制补** 通用 `enter()`（与 Mobile 现网对齐），供非消息可见性批量场景使用。

产品验收口径：**用户无法进入消息 hide/restore/delete 批量模式**；相关死代码不保留。

**F. 工作树刷新（继承 hide / unhide）**

> **现行契约（WEC）**：Core 路径仅 transcript hide/show；`captureSessionWorktreeBlock` 在应用层（置位应用入口）；`bumpWorktreeUiToken` / `notifyWorkspaceMutated` 路径不变。详见 [`worktree-engine-convergence`](../worktree-engine-convergence/prd.md)。

置位在副作用上 **等价于** 对同一锚点依次执行 hide 前缀 + show 后缀，因此 **完整继承** 现网消息 **隐藏（hide）** 与 **恢复显示（unhide / show）** 的工作树刷新机制，遵循 [`message-worktree-refresh-tighten`](../message-worktree-refresh-tighten/prd.md) visibility 刷新矩阵：

| 层级    | 置位成功后行为（与 hide / restore 批量 **相同**）                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Core    | 经 `MessageTranscriptEffects`（或等价统一入口）调用 `hideRange` + `showRange`（**无** Core 内 markDirty/capture；见 WEC）            |
| 应用层  | effects 成功后 **`captureSessionWorktreeBlock`**（置位应用入口；验收见 WEC PRD §A）                                                  |
| Mobile  | 成功后 **`bumpWorktreeUiToken`**（或现网 hide/restore 批量所用的同等刷新触发）                                                     |
| Desktop | 成功后 **`notifyWorkspaceMutated`**（或现网 hide/restore 批量所用的同等刷新触发）                                                  |

**明确不继承** delete / rollback 路径：置位 **不** 调用 `truncateMessagesAfter`；**不** 因置位而跳过应用层 capture 或双端 UI 刷新；双端 **不** 走 delete/rollback 的「不 capture、不 bump/notify」收窄口径。

实现要求：置位 **复用** hide/show 统一副作用链路，**禁止** 新建一套独立的 worktree 刷新分支。

**G. 与现有操作的关系（产品边界）**

| 操作          | 保留                              | 变化                                               |
| ------------- | --------------------------------- | -------------------------------------------------- |
| 置位          | 新增（长按，user/assistant 消息） | 工具卡片不可用；worktree 刷新 **继承 hide/unhide** |
| 隐藏/恢复批量 | —                                 | App UI **物理删除**                                |
| 删除批量      | —                                 | App UI **物理删除**                                |
| 回滚          | 保留（长按，visible 消息行）      | 仍为截断 + VFS；hidden 行仍无回滚                  |
| 分叉          | 保留                              | 不变                                               |
| CLI hide/show | 保留                              | 不变                                               |
| Core truncate | 保留                              | 供回滚/CLI 等内部调用                              |

### 不包含范围

- Core API 删除或 CLI 命令移除（`hideRange` / `showRange` / `truncateMessagesAfter` 等 **保留**）
- Core 层 `visibility-batch-range` / `tail-batch-range` 等纯函数删除（可供 CLI、压缩、置位实现复用）
- 新增 CLI `nm message set-floor`（可后续单独立项）
- 回滚、分叉、编辑、复制行为变更（工具卡片上现有菜单不变）
- 压缩策略（`hide-message` 事件）逻辑变更
- FileEditor 手动保存与 checkpoint 策略

## 核心需求

1. **置位一键完成可见窗口重置**：单次确认即可将 prefix 隐藏、suffix（含锚点）显示；不要求用户理解 hide/restore 两种模式。
2. **锚点仅限 user/assistant 消息行**：以长按目标所映射的底层 `ChatMessage` 为准；`role` 须为 `user` 或 `assistant`。**工具卡片不得作为置位锚点**，菜单中不展示「置位」。锚点 seq 为所选 message 的 **原始 seq**，**不**扩展到 `tool_result`，**不**调用 `resolveRollbackAnchorMessage`。
3. **会话菜单去 clutter**：抽屉/⋯ 菜单移除 hide、restore、delete 三项；用户整理上下文的主路径改为长按置位。
4. **批量 UI 物理删除**：hide/restore/delete 消息批量多选 UI、transcript 批量态与专属测试从 App 代码库移除；非 chat 场景的通用批量组件可保留。
5. **删除能力 App 内收敛**：不再提供「仅删聊天记录」批量 UI；用户改用回滚（含「仅删除后续对话」降级）。**后端 truncate 能力不删**。
6. **双端 parity**：Mobile WebView transcript、Mobile legacy RN、Desktop 三处长按菜单对 **合格消息行** 均含「置位」且语义一致；工具卡片三端均不支持置位。
7. **运行中保护**：Agent 运行中不可置位，提示与分叉/回滚一致。
8. **工作树刷新继承 hide/unhide**：置位经 hide/show 统一入口执行 transcript 变更；**应用层** `captureSessionWorktreeBlock`（见 WEC）、Mobile `bumpWorktreeUiToken`、Desktop `notifyWorkspaceMutated` 与现网批量 hide / 批量 restore **一致**；**不**走 delete/rollback 不刷新路径。

## 验收标准

### 置位行为

- **Given** 会话含多条 visible 与 hidden 消息，**When** 用户对 `seq=N` 的 **user 或 assistant 消息** 长按并确认置位，**Then** 所有 `seq<N` 为 hidden、所有 `seq≥N` 为 visible，且消息行数不变。
- **Given** 锚点为 `seq=1` 的合格消息，**When** 置位，**Then** 无 `seq<1` 区间；`seq≥1` 全部 visible。
- **Given** 锚点为会话末条合格消息，**When** 置位，**Then** 前缀全部 hidden；末条 visible。
- **Given** 置位前已满足「prefix 全 hidden + suffix 全 visible」，**When** 再次对同一锚点置位，**Then** 状态不变或幂等成功，Toast「上下文已是最新状态」，无错误弹窗。

### 工具卡片不支持置位

- **Given** 用户对 **`user_vfs_turn` 合成展示行** 长按，**Then** 菜单 **不含「置位」**。
- **Given** 用户对 transcript 内 **工具卡片展示**（如 assistant 气泡内 `tool_use` 卡片、可点击 tool 行）长按，**Then** 菜单 **不含「置位」**（或根本不弹出消息级菜单）。
- **Given** 用户对底层 `role=user` 或 `role=assistant` 的 **消息行** 长按，**Then** 菜单 **含「置位」**（非 Agent 运行中）。

### 菜单与入口

- **Given** 打开 Mobile 会话抽屉，**Then** 列表中 **无**「隐藏消息」「恢复消息」「删除消息」。
- **Given** 打开 Desktop 会话 ⋯ 菜单，**Then** 同上三项 **不存在**。
- **Given** 消息 `hidden=true` 且为 user/assistant 行，**When** 长按，**Then** 展示「置位」，**不**展示「回滚」。

### 拦截与确认

- **Given** Agent 运行中，**When** 用户尝试置位，**Then** 操作被拦截并提示（与分叉/回滚一致）。
- **Given** 用户点击「置位」，**Then** 展示确认框，文案含「之前不参与提示词」「及之后恢复可见」；确认后才执行。

### Prompt 与副作用

- **Given** 置位成功，**When** 查看 RealPrompt / 发送下一条消息，**Then** LLM 上下文仅含 `seq≥N` 的未隐藏消息（与 hidden 过滤规则一致）。

### 工作树刷新（继承 hide / unhide）

> **Supersede**：快照物化 / capture / dirty 验收以 [`worktree-engine-convergence`](../worktree-engine-convergence/prd.md) 为准（置位完成后由 **置位应用入口显式 capture**；Core hide/show **不** 设 `isDirty`）。本节仅保留 **双端 UI 刷新** 与 **非 delete/rollback 路径** 验收。

- **Given** 会话存在已物化 worktree 快照，**When** 置位成功，**Then** **置位应用入口** 已 capture，提示词文件块为最新快照（验收细则见 WEC PRD §A）。
- **Given** 同上，**When** 置位成功，**Then** Mobile 工作区相关 UI 刷新触发与现网 **批量 hide / 批量 restore** 相同（如 `bumpWorktreeUiToken` 递增）。
- **Given** 同上，**When** 置位成功，**Then** Desktop 工作区相关 UI 刷新触发与现网 **批量 hide / 批量 restore** 相同（如 `notifyWorkspaceMutated`）。
- **Given** 置位与批量 delete 或 rollback 对比，**When** 仅执行置位，**Then** **不** 采用 delete/rollback 的「不 capture、不 bump/notify」收窄行为（capture 口径见 WEC；UI 刷新仍须触发）。

### 批量 UI 物理删除

- **Given** 普通用户在 App 内，**Then** **无法**进入「隐藏消息」「恢复消息」「删除消息」批量多选模式（无入口、无顶栏、无 transcript 批量勾选态）。
- **Given** 代码库检索（实现验收），**Then** 消息批量专用 UI 组件（如 `MessageBatchHeader`、`#chat-batch-bar` 消息批量流程）**已删除**，非注释或 `if (false)` 残留。
- **Given** 开发者/CLI，**Then** Core truncate 与既有 CLI 能力 **仍可调用**（本 PRD 不要求删除后端）。

### 保留操作不受影响

- **Given** visible 的 user/assistant 消息行，**When** 长按，**Then** 仍可选分叉、回滚（编辑/复制条件不变）。
- **Given** 用户需截断且不改 VFS，**Then** 可通过回滚降级「仅删除后续对话」完成（现网能力，非本迭代新建）。

## 风险与待确认项

| 项                        | 说明                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 批量删 UI 移除            | 仅删 App 入口与 UI 代码；若用户强依赖「无确认回滚式截断」，需依赖回滚降级路径或 CLI                                                                                                                       |
| tool 轮次边界（已决）     | 锚点 **始终** 使用用户所选底层 message 的 **原始 seq**（含 `tool_use` 的 assistant 消息行亦对应该 message 本身，非工具子卡片）；**不**扩展到配对 `tool_result`；**不**调用 `resolveRollbackAnchorMessage` |
| 通用批量 hook 残留        | `useBatchSelection` 若共享给其他列表，删除时须限定为 **消息 transcript 批量** 分支，避免误伤 Agent/Provider 等批量 UI                                                                                     |
| Desktop/Mobile 运行中拦截 | 现网 Desktop 进批量无 Agent 拦截；本 PRD 要求置位双端拦截，与分叉/回滚对齐                                                                                                                                |
