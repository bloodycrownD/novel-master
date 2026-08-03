---
date: 2026-07-13
dependency:
  - Iterations/agent-chat-ux-bugfix/prd.md
  - Iterations/chat-workspace-agent-sync/bugs/abort-partial-persist/prd.md
  - Iterations/chat-workspace-agent-sync/bugs/agent-run-lifecycle-unify/prd.md
---

# 停止后保留可见内容（Abort Retain Partial）PRD

> **父级迭代**：[../../prd.md](../../prd.md)  
> **平台**：Mobile（Android + iOS）+ Desktop  
> **性质**：对父迭代 Bug 2「停止后 transcript 冻结」的 **语义修订**——在保持「停后不再新增」的前提下，恢复「停止瞬间已可见内容」的保留与展示。  
> **Supersede（部分）**：  
> - 父迭代 [`prd.md`](../../prd.md) Bug 2 中「stream overlay 清除后 in-flight 内容不落库、不展示」的体感结果  
> - 父迭代 [`spec.md`](../../spec.md) 对 [`abort-partial-persist`](../../../chat-workspace-agent-sync/bugs/abort-partial-persist/prd.md) 的 supersede 方向——本变更 **恢复 partial 保留**，但 **保持** 停止后禁止新增条目  
> - [`chat-tool-turn-phase-ui`](../../../chat-tool-turn-phase-ui/prd.md) 中「Agent 停止且无 tool_result 时不展示工具卡片」条款（若存在）——与本需求「卡片仍存在」冲突，以本 PRD 为准  
> **保持**：[`agent-run-lifecycle-unify`](../../../chat-workspace-agent-sync/bugs/agent-run-lifecycle-unify/prd.md) 双信号模型、Composer ≤300ms 停态、`activeRunId` 保留至 FINISHED、停止后同 run **不再向列表新增** message 行或工具卡

## 背景

父迭代 `agent-chat-ux-bugfix`（2026-07-12）修复了「点停止后仍跳出工具调用」的问题：通过 Core 跳过 abort 后 append、UI `transcriptFreezeCount` 禁止增列表 reload，实现「停止即真停、列表不增长」。

上线后用户反馈新的体验偏差：

| 现象 | 用户预期 | 现网行为 |
|------|----------|----------|
| 流式生成中点停止 | 已看到的思考、正文、工具卡 **留在聊天里** | overlay 被清掉；未落库内容消失，体感「整条撤回」 |
| 工具尚未跑完 | 工具卡 **仍在**，标 **失败** | 若 assistant 已落库则卡仍在但标「已中断」；若仅 overlay 则卡不出现 |
| 工具已跑完 | **保持成功** | 已符合预期 |
| 停止之后 | **不再冒出**新工具卡或新 assistant 行 | 已符合预期（父迭代 Bug 2） |

用户已确认：**停止 = 保留停止瞬间已可见内容 + 未完成工具标失败 + 停后列表不再增长**。二者须同时满足，不可二选一。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 保留已可见内容 | 用户点停止后，停止瞬间聊天区已展示的 **思考、正文、工具卡** 在 **≤500ms** 内稳定留在列表中，**不**因停止动作而整条消失 |
| 未完成工具标失败 | 本轮 **尚无 tool_result** 的工具卡，停止后状态文案为 **「失败」**（非「执行中」、非「已中断」）；**Composer 已停（`uiRunning=false`）即标失败，不等后台 `agentActive` 回落或 `RUN_FINISHED`** |
| 已完成工具不变 | 停止前已有 tool_result 且显示「成功」或「失败」的工具，停止后 **状态不变** |
| 停后不再新增 | 停止后同一次 run **不再**向聊天列表新增 assistant 行、工具卡或 tool_result 展示（父迭代 Bug 2 **不退化**） |
| Composer 即时停态 | 点停止后 **≤300ms** 内 Composer 回到可发送态（父迭代保持） |
| 双端一致 | Mobile 与 Desktop 满足同一套验收 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Agent 运行中操作者 | 模型正在输出思考 + 正文 + 发起工具调用时点「停止」，希望 **已看到的内容留下**，未完成工具显示失败，而不是像没发生过 |
| 长会话作者 | 停止后需对照「模型打算调什么工具」做人工处理；工具卡消失会导致上下文丢失 |
| 双端用户 | Mobile WebView 与 Desktop 停止后体验一致 |

## 范围

### 包含范围

**变更 1 — 停止瞬间保留可见内容**

- **保留范围**：停止时刻用户已在聊天区看到的：
  - 思考过程（thinking）
  - assistant 正文（text）
  - 工具调用卡片（tool_use，含参数摘要）
- **来源**：既含 **已落库并 reload 进列表** 的内容，也含 **仅在流式 overlay / stream tail 中、尚未落库** 的内容——停止时须 **固化进列表**（或等价持久展示），不得仅清 overlay。
- **截断语义**：保留的是 **停止瞬间的快照**；停止后迟到的 stream token、迟到的 STEP 事件 **不得**再追加或改写该条内容。

**变更 2 — 未完成工具标「失败」**

- 本轮 assistant 上 **无配对 tool_result** 的工具卡：停止后展示 **「失败」**。
- 本轮 **已有 tool_result** 的工具：保持原有「成功」或「失败」，**不**因用户点停止而改写。
- 工具卡 **继续嵌在 assistant 气泡内**展示（与现网合并卡片模型一致），停止后 **不隐藏** 工具区。

**变更 3 — 保持停后列表不增长**

- 停止后同 run 内：
  - **不新增** assistant 消息行
  - **不新增** 工具卡或 tool_result 导致的列表变化
  - **不**因 tool 在后台执行完成而刷新出新的成功/失败态（abort 后 tool_result 不落库展示的路径保持）
- 与变更 1 的边界：**允许**停止时 **一次**将 overlay 内容 commit 为可见条目；**禁止**停止后持续 reload 增列表。

**变更 4 — 双端 parity**

- Desktop（IPC abort）与 Mobile（AbortController + WebView transcript）均满足上述三条。

### 不包含范围

- 工具在后台是否继续执行、VFS 是否已变更（`toolRunner` 执行期不可中断，父迭代已排除）
- 将未完成工具写入 `ok=false` 的 `tool_result` 落库（除非实现阶段证明 UI 展示必须；本 PRD 以 **展示层「失败」** 为准）
- 整条 assistant 消息标「失败」或 Toast 报错（停止走 cancelled，非 run failed）
- 置位仅 user（父迭代 Bug 1）、删除 Agent 显示名（父迭代 Bug 3）
- Agent lifecycle 双信号模型重构
- Desktop blocks-aware IPC append（thinking/tool_use）及 synthetic optimistic row 长期驻留（极早 abort fallback 仅 text IPC，见子 SPEC 变更 1b）
- 批量停止、会话级 undo、CLI 行为变更

## 核心需求

1. **停止快照保留**：用户点停止后，停止瞬间已在聊天区可见的思考、正文、工具卡须 **保留在列表中**，不得因清 overlay 或未落库而导致整条消失。
2. **一次固化、之后冻结**：允许在停止时将 overlay 内容 **一次性**固化为可见 assistant 条目；固化完成后，同 run **不再**接受新增或增长的列表变更。
3. **未完成工具标失败**：无 tool_result 的工具卡停止后显示 **「失败」**；已有终态的工具卡状态 **不变**。展示判定以 **Composer 停态（`uiRunning=false`）** 为准，**不**依赖 `agentActive` 仍至 `RUN_FINISHED` 才 false 的时序（父迭代 T-AC2-7 **保持**）。
4. **卡片仍存在**：含 tool_use 的 assistant 停止后 **继续展示**工具卡组；不得因停止而隐藏工具区。
5. **停后不新增**：停止动作之后，用户 **不应观察到**新的 assistant 气泡、新的工具卡或工具从「执行中」变为「成功」的刷新（父迭代 Bug 2 保持）。
6. **Composer 即时停态**：停止后 Composer ≤300ms 回到可发送；与内容保留组合验收。
7. **双端一致**：上述行为在 Mobile 与 Desktop 对齐。

## 验收标准

### 变更 1 — 保留可见内容

- **Given** Agent 运行中，聊天区 stream tail 已显示思考 + 正文（尚未 reload 进持久列表）  
  **When** 用户点「停止」  
  **Then** ≤500ms 内列表中出现对应 assistant 条目，含已展示的思考与正文；**不**出现「整条消失」

- **Given** assistant 已落库，气泡内已有工具卡（执行中）  
  **When** 用户点「停止」  
  **Then** 该 assistant 气泡与工具卡 **仍在列表中**

- **Given** 用户已点停止并完成固化  
  **When** 同 run 迟到 stream delta 或 STEP 事件到达  
  **Then** 列表 **不**再增长或改写已固化内容

### 变更 2 — 工具状态

- **Given** 本轮有 2 个工具，第 1 个已成功、第 2 个无 result  
  **When** 用户点「停止」  
  **Then** 第 1 个仍显示「成功」；第 2 个显示「失败」

- **Given** 本轮仅 1 个工具，无 result，卡片显示「执行中」  
  **When** 用户点「停止」（Composer ≤300ms 回到可发送态）  
  **Then** ≤500ms 内该卡显示「失败」，**不**长期停留「执行中」或「已中断」；**即使**此时 `agentActive` 仍为 true（后台 run 未 FINISHED），亦须标「失败」

### 变更 3 — 停后不新增（防回归）

- **Given** 用户已点停止，列表已固化  
  **When** 后台 tool 执行完成或迟到 `STEP_COMMITTED(tool_results)` 到达  
  **Then** 聊天列表 **不**新增行、**不**新增工具卡、**不**将未完成工具刷新为「成功」

- **Given** 用户点停止  
  **When** 观察 Composer  
  **Then** ≤300ms 内回到可发送态

### 双端

- **Given** 上述场景分别在 Desktop 与 Mobile 复现  
  **When** 用户点停止  
  **Then** 双端行为符合同一 Given/When/Then

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 与父迭代 Bug 2 张力 | 实现须严格区分「停止瞬间一次固化」与「停止后持续 reload」；固化逻辑错误可能导致旧 bug「停后仍出 tool call」回归 |
| 后台已执行未落库 | 工具可能在 abort 后已在 VFS 生效但 UI 标「失败」；本 PRD **接受**展示与副作用不一致，不在范围修 |
| `chat-tool-turn-phase-ui` 冲突 | 若旧 PRD 要求停止后隐藏工具卡，以本 PRD「卡片仍存在」为准 |
| 文案「失败」vs「已中断」 | 用户已确认未完成工具用 **「失败」**；与历史上「已中断」语义不同，需在发布说明中注明 |
| 重进会话 | 固化内容须写入可持久化存储；重进会话后仍能看到保留的 assistant 与失败态工具卡 |
| 极早 abort（adapter `blocks=[]`） | Core 无 partial 时，Desktop/Mobile overlay fallback 为 **best-effort** 持久化（Desktop 仅 `ipcMessagesAppend` 写 text，无 thinking/tool_use）；极早停止可能 **仅保留 overlay 文本、无工具卡**；见子 SPEC 变更 1b |
