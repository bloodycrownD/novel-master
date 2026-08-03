---
date: 2026-07-12
dependency:
  - Iterations/message-set-floor/prd.md
  - Iterations/chat-workspace-agent-sync/bugs/agent-run-lifecycle-unify/prd.md
  - Iterations/mobile-agent-nav-refactor/prd.md
---

# Agent 聊天与设置 UX Bugfix PRD

> **平台**：Mobile（Android + iOS）+ Desktop（`apps/mobile`、`apps/desktop`）  
> **性质**：三处独立 bugfix 打包交付，修复会话内 Agent 运行态与设置页 Agent 管理的体验偏差。  
> **Supersede**：本 PRD 对 [`message-set-floor`](../message-set-floor/prd.md) **部分 supersede**——将置位锚点资格从「user 或 assistant」收窄为 **仅 user**；其余置位语义、工作树 capture、菜单精简等条款仍沿用原 PRD。

## 背景

探索与现网对照发现三处与用户预期不符的行为：

| # | 现象 | 现状 |
|---|------|------|
| 1 | 置位应对 user 消息专用 | 双端 UI 与 Core 均允许 **user 与 assistant** 作锚点；[`message-set-floor`](../message-set-floor/prd.md) 亦按双角色设计 |
| 2 | 点「停止」后仍跳出工具调用 message | `uiRunning` 立刻 false（Composer 已停），但同 run 的落库事件仍驱动 transcript reload，assistant / 工具卡仍可能 **新增或刷新** 进入列表 |
| 3 | 删除 Agent 确认显示 id | **Mobile** 列表与失效编辑器确认框硬编码 `agentId`；列表标题却展示 `definition.name`，信息不一致。**Desktop** 列表删除已用 name |

Bug 2 用户已确认：**停止即真停**——点停止后聊天列表不应再新增任何内容（不出现新的工具调用卡片或 assistant 行）。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 置位锚点收窄 | assistant 消息长按/右键菜单 **不含「置位」**；仅 user 消息可触发置位流程 |
| 停止后 transcript 冻结 | 用户点停止后 **≤300ms** 内 Composer 停态；此后 **同一次 run** 不再向聊天列表 **新增** 任何 message（含 assistant 行、工具调用卡片） |
| 删除确认可读 | 单条删除确认文案展示 Agent **显示名**（`definition.name`），与列表标题一致 |
| 双端一致 | 上述三处修复在 Mobile 与 Desktop **行为对齐**（删除确认 Desktop 列表已正确，需保持并覆盖 Mobile 缺口） |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 长会话作者 | 希望对 **自己的 user 消息** 置位以重置 LLM 窗口；误对 assistant 回复置位导致上下文错乱 |
| Agent 运行中操作者 | 模型正在调用工具时点「停止」，期望聊天区立刻稳定，不再「弹出」新的工具调用 |
| Agent 管理者 | Mobile 设置页删除 Agent 时，确认框应显示「我的写作助手」而非 `agent-1730…` |

## 范围

### 包含范围

**Bug 1 — 置位仅 user 消息**

- **UI 资格**：Desktop `message-edit`、Mobile legacy RN `message-edit`、Mobile WebView `chat-transcript` 三处菜单构建逻辑——**仅** `role === 'user'` 且非工具卡片区域展示「置位」。
- **Core 校验**：`setMessageFloorAtMessage` 锚点 role 必须为 `user`；assistant / system 拒绝并给出用户可理解错误。
- **测试**：更新置位相关单测——移除 assistant 锚点正向用例，新增 assistant 菜单不含置位、Core 拒绝 assistant 锚点用例。
- **双端 parity**：Hidden user 消息仍可置位（与原 PRD 一致）。

**Bug 2 — 停止后 transcript 不再新增内容**

- **用户契约**：点停止后，**同一次 run** 内不再向 transcript **新增** message 行或工具调用展示（含 abort 竞态窗口内 LLM 返回、tool 执行完成等路径）。
- **UI 侧**：停止后不再因该 run 的 step 落库事件（含 `assistant` 与 **`tool_results` phase**）触发「向列表追加新内容」的 reload 效果；已展示内容可保留，但 **停止动作之后不应再出现新条目**；stream overlay（text/thinking）在停止后 **不得再增长**。
- **运行态**：Composer 停止态、stream overlay 清除、`agentActive` 释放等现有 lifecycle 语义保持；本 bugfix 聚焦 **停止后列表不再增长**。
- **双端 parity**：Desktop（IPC abort）与 Mobile（本地 AbortController）均满足同一验收。

**Bug 3 — 删除 Agent 确认显示 name**

- **Mobile** `AgentList` 单条删除确认：由 `确定删除 {agentId}？` 改为展示 **显示名**（格式对齐 Desktop：`删除 Agent「{name}」？` 或 Mobile Alert 等价文案）。
- **Mobile** `AgentEditorForm` 失效配置删除确认：同上，使用 `name` 而非 `agentId`。
- **降级**：仅当 definition 不可读、name 为空时，回退显示 `agentId` 并仍允许删除。
- **Desktop**：列表删除路径已正确，本迭代 **保持**；若失效编辑器路径存在 id 展示则一并修正。

### 不包含范围

- 置位以外的 hide/show/truncate API、CLI、工作树 capture 机制变更
- Agent run lifecycle 双信号模型重构、toolRunner 执行期可中断、SSE stall timeout
- 批量删除确认文案（仍仅展示数量）
- 删除成功 Toast 是否附带 name（非本次必须）
- `agentId` registry 键语义、重命名能力变更
- CLI `nm agent delete` 输出格式（仍以 id 为准）

## 核心需求

1. **置位菜单资格**：assistant 消息（含纯 text、含 tool_use、hidden assistant）长按/右键菜单 **不得** 出现「置位」；user 消息（含 hidden） **可以**。
2. **置位 Core 守卫**：以 assistant 或 system 消息 seq 调用置位 API 时 **拒绝**，App 层 Toast 提示，不修改 transcript。
3. **停止后列表冻结**：用户触发停止后，该 run 不再产生 **新的** transcript 可见条目（含 `tool_results` phase reload 路径）；已存在条目可保留，但停止后用户不应观察到「又跳出」工具调用或新 assistant 气泡；stream overlay 停止后不得再增长。
4. **停止体感一致**：停止后 Composer 立即回到可发送态；与 Bug 2 验收组合——**停 = 列表不再增长 + UI 已停**。
5. **Mobile 删除确认可读**：单条删除确认展示与列表相同的 **显示名**；与 Desktop 列表删除文案风格一致。
6. **双端验收**：三处 bugfix 均在 Mobile 与 Desktop 通过同一套 Given/When/Then 验收（删除确认以 Mobile 修复为主、Desktop 防回归）。

## 验收标准

### Bug 1 — 置位仅 user

- **Given** 会话含 user 与 assistant 消息，Agent 未运行  
  **When** 长按/右键 **user** 消息  
  **Then** 菜单含「置位」，确认后执行成功

- **Given** 同上  
  **When** 长按/右键 **assistant** 消息（含仅 tool_use 块）  
  **Then** 菜单 **不含**「置位」

- **Given** Agent 运行中  
  **When** 长按 user 消息  
  **Then** 仍禁止置位（与原 PRD 一致）

- **Given** 以 assistant message seq 调用置位 API（绕过 UI）  
  **When** 执行  
  **Then** 拒绝，transcript 不变

- **Given** Mobile WebView transcript  
  **When** 长按 user 消息（非 tool-card 区域）  
  **Then** 含「置位」；长按 assistant 消息则不含

### Bug 2 — 停止后不再新增 message

- **Given** Agent 正在 run，assistant 即将或正在返回 tool_use  
  **When** 用户点「停止」  
  **Then** ≤300ms 内 Composer 为发送态；**此后** 同 run 聊天列表 **不新增** assistant 行或工具调用卡片

- **Given** Agent 正在执行工具（tool 并行中）  
  **When** 用户点「停止」  
  **Then** 停止后列表 **不新增** tool_result 对应的新展示或新 assistant 行

- **Given** 用户已点停止且 UI 已停  
  **When** 等待 run teardown 完成（≤5s）  
  **Then** 聊天列表条目数与停止瞬间相比 **不增加**（允许已存在条目内容不变或 stream overlay 清除；**不允许** overlay 在停止后继续增长）

- **Given** 用户已点停止，Core 仍发出迟到 `STREAM_TEXT_DELTA` / `THINKING_DELTA`  
  **When** delta 到达 UI  
  **Then** `streamingText` / `streamingThinking` **不**再更新

- **Given** Desktop 与 Mobile 各一  
  **When** 同上场景复现  
  **Then** 双端行为一致

### Bug 3 — 删除 Agent 显示 name

- **Given** Mobile Agent 列表，某 Agent 显示名为「我的写作助手」、`agentId` 为 `agent-1730…`  
  **When** ⋮ → 删除  
  **Then** 确认框展示 **「我的写作助手」或等价显示名**，**不** 仅展示 `agent-1730…`

- **Given** Mobile 失效配置编辑器  
  **When** 点「删除该智能体」  
  **Then** 确认框同样展示显示名

- **Given** definition 损坏、name 不可读  
  **When** 删除  
  **Then** 可回退显示 `agentId`，不 crash

- **Given** Desktop Agent 列表  
  **When** 单条删除  
  **Then** 仍展示 name（回归：不因本迭代退化）

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 置位 supersede | 收窄后「对 hidden assistant 行置位恢复」场景失去入口；若后续需要需另开需求 |
| 停止与 partial 落库 | 现行 `abort-partial-persist` 允许 abort 后 partial assistant 落库；本 PRD 要求停止后 **列表不新增**，实现时需协调「已停 run 的 late commit 是否丢弃 UI 刷新或阻止落库」——细节留 spec，本 PRD 以用户可见「不新增」为准 |
| Desktop 失效编辑器 | 探索发现 Desktop 失效路径无二次确认；非本次必须，可后续 polish |
