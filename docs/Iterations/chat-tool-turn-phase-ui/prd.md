# 工具 Turn 阶段提示与回滚对齐 PRD

> **类型**：体验简化 + Bugfix  
> **平台**：Mobile + Desktop + Core  
> **关联迭代**：`chat-rollback-vfs-tool-fixes`（条目 6 工具 loading 方案 **作废**，由本迭代替代）、`message-rollback-remove-session-log`、`mobile-webview-chat-transcript`

## 背景

当前聊天 UI 为工具调用维护了 per-tool 流式 overlay（`streamingTools`）、per-card pending/spinner，以及 Agent 运行中与回滚后的多种状态判定。Core 层在 LLM 流结束前 **不会** 逐条 emit 具体 `tool_use`，因此「工具卡执行中」与 Agent 级「生成中」高度重叠，代码复杂且易在回滚后出现错误状态（如 orphan `tool_use` 显示执行中）。

产品心智上，**一个 turn = 一条 assistant 消息 +（若有）与之配对的 user `tool_result` 消息**；用户看到的 assistant 气泡代表整轮。回滚应对齐 **turn 结束时刻** 的 checkpoint，而非 assistant 行与 tool_result 行之间的存储缝隙。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 工具 UI 简化 | 删除 `streamingTools` 及 per-tool live pending/spinner 相关 UI 路径；无仅服务于该能力的死代码 |
| Turn 阶段可感知 | 当前 turn 工具执行期间，用户看到固定文案 **「正在执行工具调用…」**；**不**展示任何工具卡片 |
| 终态卡片清晰 | 该 turn 全部 `tool_result` 落库后，一次性展示工具组（成功/失败） |
| 回滚与 turn 一致 | 对含工具的 assistant 气泡执行回滚，消息与 worktree 均对齐 **该 turn 结束时刻**；已完成的历史 turn 工具展示不变 |
| 无错误 loading | 回滚或 Agent 停止后，**不出现** per-tool「执行中」spinner |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile / Desktop 对话用户 | Agent 多轮工具调用时，先读流式正文/思考，再看到「正在执行工具调用…」，最后看到工具结果卡片 |
| 回滚用户 | 在某轮 assistant 气泡上点「回滚」，期望回到 **该轮工具已跑完** 的状态，而非留下半套 tool_use |
| 维护者 | 降低 chat UI 状态机复杂度，避免 `chat-rollback-vfs-tool-fixes` 中 loading 方案的技术债 |

## 范围

### 包含范围

1. **Turn 阶段 UI（Mobile WebView transcript + legacy RN + Desktop）**
   - LLM 流式阶段：仍展示正文 / thinking 流（不变）
   - 该 turn assistant 已落库且含 `tool_use`、但配对 `tool_result` 尚未全部落库、且 Agent 在跑：**仅**在该 assistant 气泡上展示固定阶段条「正在执行工具调用…」
   - **`tool_result` 全部落库后**：展示工具调用卡片（成功/失败）；执行期间 **完全不展示** 工具卡片
2. **删除 per-tool 流式 loading 路径**
   - 移除 UI 对 `streamingTools`、`EVENT_AGENT_STREAM_TOOL_USE` 的消费（事件可保留于 Core，供调试/未来使用）
   - 移除 persisted message 上 live run 的 per-tool `pending` / spinner / 工具组标题「· 执行中」
3. **渲染规则（按 turn）**
   - 每个 assistant turn 独立判定；已完成 turn 不受后续 turn 或回滚影响
   - **无配对 `tool_result` 且 Agent 未跑**：不展示工具区（不展示卡片、不展示阶段条、不展示「已中断」）
4. **Core + Mobile + Desktop — 回滚锚点与 turn 对齐**
   - 用户对 **含 `tool_use` 且已有配对 `tool_result` 的 assistant 气泡** 发起回滚时，消息截断与 checkpoint 解析应对齐 **该 turn 结束**（即配对 `tool_result` 消息时刻），与现有「工具轮 checkpoint 在 assistant 上、于工具全部 settle 后写入」一致
   - 纯文本 assistant、user 文本消息：回滚锚点仍为所点消息本身

### 不包含范围

- 本 PRD 不定义接口、表结构、任务拆分（见 SPEC）
- LLM 流式中途提前展示具体工具名 / 参数（产品明确不需要）
- Core 在 `content_block_start` 提前 emit `tool-use`（非目标）
- 工具失败 Toast / 最终用户错误 UI 改版（仍仅约束 LLM tool message，沿用既有迭代）
- iOS 专项验收（Android + Desktop 为准）
- `chat-rollback-vfs-tool-fixes` 中 VFS、checkpoint 补齐、块顺序等 **非工具-loading** 条目（已落地或独立保留，不在本迭代重复）

## 核心需求

1. **Turn 定义**：一个 tool turn = assistant（含一个或多个 `tool_use`）+ 紧随其后的 user 消息（仅 `tool_result` blocks，UI 不单独成泡）。
2. **阶段条**：当前 turn 处于工具执行期时，固定文案「正在执行工具调用…」；不带轮次编号、不列出工具名。
3. **延迟展示工具卡**：仅当该 turn 全部 `tool_result` 已落库后，在对应 assistant 气泡内展示工具组及终态（成功/失败）。
4. **删除 streamingTools 债**：Mobile / Desktop / WebView transcript 不再维护流式工具 overlay 及与之相关的 flush/clear 逻辑。
5. **回滚 turn 对齐**：对已完成 tool turn 的 assistant 气泡回滚，等价于回滚到该 turn 的 **结束边界**；不产生 orphan `tool_use` 导致的工具 UI 异常。
6. **历史 turn 隔离**：回滚只影响锚点之后的消息；锚点之前已完整 turn 的工具卡片与状态保持不变。

## 验收标准

### 1. 工具执行阶段（Mobile WebView + Desktop）

- **Given** Agent 正在运行，当前 turn 的 assistant 已落库且含 `tool_use`，`tool_result` 尚未落库  
  **When** 用户查看该 assistant 气泡  
  **Then** 显示「正在执行工具调用…」；**不**显示任何工具调用卡片；**不**显示 per-tool spinner

- **Given** 同上  
  **When** 该 turn 全部 `tool_result` 落库  
  **Then** 阶段条消失；工具组一次性出现，且状态为成功或失败

### 2. 多 turn 隔离

- **Given** turn 1 已完成（工具卡片可见），turn 2 正在执行工具  
  **When** 用户浏览会话  
  **Then** turn 1 工具卡片保持终态；**仅** turn 2 的 assistant 气泡显示阶段条

### 3. LLM 流式阶段

- **Given** Agent 正在流式输出正文/thinking，尚未落库 assistant  
  **When** 用户查看会话尾部  
  **Then** 仍显示流式 tail；**不**显示「正在执行工具调用…」；**不**显示工具卡片

### 4. 回滚（Mobile + Desktop + Core）

- **Given** 某 turn 的 assistant 含工具且 tool_result 已齐全，其后还有后续消息  
  **When** 用户在该 assistant 气泡上执行「回滚到此消息」并确认  
  **Then** 该 turn 的 assistant 与 tool_result 均保留；工具卡片仍为终态；后续消息被删除；worktree 与该 turn 结束时刻 checkpoint 一致；**不出现**工具「执行中」

- **Given** 更早的 turn 1 完整、turn 2 完整，用户回滚到 turn 2 的 assistant  
  **When** 回滚成功  
  **Then** turn 1 的工具展示与回滚前一致

### 5. 代码债清理

- **Given** 本迭代合入后  
  **When** 检索 Mobile / Desktop chat 模块  
  **Then** 不存在 `streamingTools` 状态及 WebView `streamTools` 宿主桥；不存在仅服务于 live per-tool pending 的 UI 测试/样式

### 6. Agent 停止 / 无 result

- **Given** Agent 已停止，某 assistant 含 `tool_use` 但无配对 `tool_result`（异常或中止）  
  **When** 用户查看该气泡  
  **Then** **不**展示工具卡片；**不**展示阶段条；**不**展示「执行中」
