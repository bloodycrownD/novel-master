---
date: 2026-06-28
dependency:
  - Iterations/chat-workspace-agent-sync/prd.md
  - Iterations/chat-workspace-agent-sync/bugs/glm-post-text-tool-buffer-no-loading/prd.md
---

# agent-run-lifecycle-unify PRD

## 背景

`chat-workspace-agent-sync` 两事件模型在 **1.3.06** 修复了「单流内正文后等 tool_call」路径，但真机仍复现另一类卡顿：

1. Assistant 已落库 → tool 执行 → `tool_result` 已落库  
2. Agent 进入**下一轮** `modelRequests.request`，等待下一条 Assistant  
3. 模型长时间无 SSE 字节时：stream tail 空白、终止体感无效、`agentRunning` 长期为 true  

根因叠加：

| 层 | 现状问题 |
|----|----------|
| **Core 事件** | `RUN_STARTED` / `RUN_FINISHED` / stream delta **无 `runId`**，仅 `sessionId` 过滤；abort 后迟到 microtask 事件可污染新 run |
| **Mobile** | `agentRunning` 与 `setMobileAgentActive` 同一布尔；终止保持 `running=true` 至 `finally`；`RUN_FINISHED` 不清 running |
| **Desktop** | 终止乐观 `running=false`，但 `abortAgentRun` **立刻** `agentActive=false`；旧 run `.finally()` 可误清新 run；`onRunFinished` 不校验 run 身份 |
| **stream tail UI** | 事件 1 用「工具调用中」、轮间无横条；文案分裂且轮间空白像卡死 |

**展示文案调整（相对父级 PRD）**：父级事件 1 原为 stream tail「**工具调用中**」。本迭代统一为「**生成中**」。父级 `chat-workspace-agent-sync/prd.md` 为历史 implemented 记录，**以本 bug PRD 为准**。

用户确认：**允许改 Core，双端彻底统一**；**不做** SSE stall timeout；stream tail idle **300ms**（与现网体感接近，含废弃 `toolUseLatched` 后的 ≤300ms 延迟）。

与 `glm-post-text-tool-buffer-no-loading` 关系：双路径 idle **废弃**；`tool_stream` 保留；`EVENT_AGENT_STREAM_TOOL_USE` **不再**驱动即时 latch，横条仅随 **text/thinking delta 时钟 idle ≥300ms** 出现。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 权威 run 身份 | Core 发出的 agent 生命周期与 stream 事件均带 **`runId`**；消费方按 `sessionId + runId` 过滤 |
| 双信号语义统一 | **`uiRunning`** 与 **`agentActive`** 分离；双端契约一致 |
| 终止可感知 | 点终止后 **≤300ms** `uiRunning=false`；stream tail 清除 |
| 终止可生效 | abort 后 **≤5s** `RUN_FINISHED(cancelled)` 且 `agentActive=false`；按阶段无多余落库（见验收） |
| 无 stale 竞态 | Run B 已成为当前 run 后，Run A 迟到事件不改变 B 的 UI |
| stream tail 统一 | `uiRunning` 且距上次 text/thinking delta **≥300ms** → 横条「**生成中**」 |
| 并发门禁 | `agentActive=true` 时不得启动第二个 `runAgentTurn`（对称 Desktop `AGENT_BUSY`） |
| 双端一致 | Mobile + Desktop 同等条件行为对齐 |

## 范围

### 包含范围

1. **Core**：`runId`；全链路 payload；abort 后 skip 落库（assistant / 未进入 tool 路径）
2. **双端 busy**：`agentActive` refcount；abort **不**清 busy；`RUN_FINISHED`/`RUN_FAILED` 按 `runId` 递减
3. **双端 UI**：终止乐观 `uiRunning=false`；`RUN_FINISHED`/`FAILED` 匹配 `runId` 收尾
4. **stream tail**：`streamTailGenerating = uiRunning && msSinceLastStreamDelta ≥ 300ms`；文案「生成中」；**删除** `useStreamToolInvoking*`
5. **Mobile**：`useAgentRunLifecycle`；移除 `ChatConversationPanel` 内 `setMobileAgentActive(running)`；`executeRun` 入口 `isMobileAgentActive()` 门禁
6. **Desktop**：`agent.ts` run 登记 + 条件 `finally`；`onRunFinished` runId 守卫；`RUN_STARTED` 类型与订阅
7. **自动化测试**：见 SPEC 测试表

### 不包含范围

- `toolRunner.runParallel` 执行期可中断
- 恢复 `TOOL_USE_DELTA` / metrics tool 字数
- SSE/XHR stall timeout
- 非 agent 通用取消框架

## 核心需求

1. Core 每次 run 生成 `runId`，`RUN_STARTED` 公布；同源事件携带相同 `runId`。
2. 消费方校验 `runId === activeRunId`（及 `sessionId`）。
3. `uiRunning` 与 `agentActive` 分离：终止立刻清 `uiRunning`；`agentActive` 仅匹配 `runId` 的 FINISHED/FAILED 递减（**平台层** refcount，非 UI hook）。
4. 新 run 门禁用 `agentActive`：**Mobile** `beginUiRun` 即 `incrementAgentActive`（与 Desktop IPC 入口 increment 对齐）；teardown 完成前拒绝第二 run。
5. stream tail：`streamTailGenerating` 仅一条 idle ≥300ms 规则；**`EVENT_AGENT_STREAM_TOOL_USE` 不刷新时钟、不即时 latch**（仅 text/thinking delta 刷新 `lastStreamAt`）。
6. 工具卡 pending 仍为「**执行中**」；绑定 **`agentActive`**（非 `uiRunning`）。
7. Desktop：**仅 main** 管理 `agentActive` refcount；renderer `useAgentRunLifecycle` **不** increment/decrement busy。`abortAgentRun` 不 decrement；`RUN_FINISHED` 匹配 `runId` 时 decrement。
8. Mobile：`beginUiRun` 时 `incrementAgentActive`；`RUN_FINISHED`/`FAILED`（匹配 runId）时 decrement；abort 乐观 `uiRunning=false`。
9. **`runId` 唯一来源**为 Core `RUN_STARTED`；main/Mobile 不得自行生成 runId 用于登记。

## 验收标准

### runId 与 stale 事件

- **Given** 一次 agent run 开始  
  **When** 订阅 bus  
  **Then** `RUN_STARTED` 含 `runId`；同 run 各事件 `runId` 一致

- **Given** Run B 已通过 `RUN_STARTED` 成为当前 run（`activeRunId=B`）  
  **When** Run A 迟到 `RUN_FINISHED` 或 text-delta（`runId=A`）  
  **Then** B 的 `uiRunning`、`streamTailGenerating`、stream 内容、metrics **不变**

### busy 与并发

- **Given** Run A abort 后 teardown 中（`agentActive=true`，`uiRunning=false`）  
  **When** 用户尝试启动 Run B  
  **Then** 拒绝或提示「Agent 忙碌」；**不**启动第二个 `runAgentTurn`

- **Given** `agentActive=false`  
  **When** 用户正常发送  
  **Then** 可启动新 run

### 终止

- **Given** 任意运行中  
  **When** 用户点终止  
  **Then** ≤300ms 内 `uiRunning=false`、stream 清除；`agentActive` 可仍为 true

- **Given** 终止时 assistant **尚未**落库  
  **When** ≤5s 且网络正常  
  **Then** `agentActive=false`；**无**新 assistant / tool_result；`stopReason=cancelled`

- **Given** 终止时 assistant **已**落库含 `tool_use`  
  **When** ≤5s  
  **Then** 允许 DB 中保留该 assistant；**无**新 tool_result、**无**新一轮 `modelRequests.request`

### stream tail「生成中」（idle 300ms）

- **Given** `uiRunning`，text/thinking delta 间隔 &lt;300ms  
  **Then** **不**显示阶段横条

- **Given** `uiRunning`，自上次 text/thinking delta 起 ≥300ms  
  **Then** 横条「**生成中**」（含 GLM 正文冻结、轮间空等）

- **Given** 仅有 `EVENT_AGENT_STREAM_TOOL_USE`、无 text/thinking delta  
  **When** `beginUiRun` / `RUN_STARTED` 后满 300ms  
  **Then** 横条「**生成中**」（**接受**相对 1.3.06 即时 latch 最多 300ms 延迟；**不**为 TOOL_USE 单开规则）

- **Given** assistant 含 `tool_use`、tool 未返回  
  **Then** 工具卡「**执行中**」（可与 stream 横条并存）

### Desktop 回归

- **Given** 运行中切换到无进行中 run 的 session  
  **Then** 该面板 `uiRunning=false`

### 自动化

- Core runId + abort 不落库 + `computeStreamTailGenerating`  
- Mobile / Desktop lifecycle + composer abort + busy 门禁  
- 删除 `use-stream-tool-invoking*`；新增 `use-stream-tail-generating*`

## 风险与待确认项

- **Payload 破坏性变更**：双端同发版
- **abort 后短暂不可重发**：通常 &lt;2s；可选 toast「正在取消…」（P2，不强制验收）
- **TOOL_USE 横条延迟**：最多 300ms，用户已接受
- **父级 PRD 文案**：以本 PRD 为准
