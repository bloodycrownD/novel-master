---
date: 2026-06-13
dependency: Iterations/chat-workspace-agent-sync/prd.md
status: implemented
---

# chat-workspace-agent-sync 工具调用 UX 技术规格（SPEC）

> PRD：`.apm/kb/docs/Iterations/chat-workspace-agent-sync/prd.md`

## 两事件模型

### 事件 1：stream tail「工具调用中」

**判定**（`computeToolInvoking` / `useStreamToolInvoking`）：

```
agentRunning
&& thinkingContent.length > 0
&& textContent.length === 0
&& msSinceLastThinkingDelta >= 300
```

**展示**：

| 层 | 实现 |
|----|------|
| Mobile legacy RN | `MessageList` stream 行内 `ToolTurnPhaseBar label="工具调用中"` |
| WebView transcript | bridge `streamToolInvoking` → `renderToolInvokingBar()` |
| Desktop | `MessageList` stream 行 `.chat-message__tool-invoking` |

`useChatTabStream` / `ConversationPanel` 在 text/thinking delta 路径调用 `noteTextDelta` / `noteThinkingDelta`；`handleStreamReset` 调用 `reset()`。

### 事件 2：assistant 落库 pending 工具卡

**`message-blocks.ts`（mobile + desktop）**：

- `ToolCallStatus` 增加 `'pending'`
- `toolCallViewFromUse`：无配对 `tool_result` 时 `status: 'pending'`
- `buildChatListItems`：有 `tool_use` 即 `tools.map(...)`，不再等 complete
- 删除 `toolPhase` / `isTurnToolExecuting` 用于 UI 的路径

**`ToolCallCard`**：`pending` → 文案「执行中」

## 删除清单

| 类别 | 项 |
|------|-----|
| Metrics | `useAgentStreamMetrics`、`ChatStreamMetricsBar`、`AgentStreamMetricsBar`、相关单测、`freezeToLastRun` |
| Delta | `EVENT_AGENT_STREAM_TOOL_USE_DELTA`、agent-runner 发布、ChatComposer/onStreamToolUseDelta、desktop `useAgentStream` 订阅、forward-event-bus |
| Parser | `LlmStreamEvent tool-use-delta` 及 anthropic/gemini/openai emit |
| GLM | `glm-tool-stream.ts`、openai.adapter `tool_stream`、相关单测 |
| Phase bar | message 行 `toolPhase` / `ToolTurnPhaseBar`（stream tail 保留改文案） |

## 新增/迁移

| 文件 | 说明 |
|------|------|
| `apps/mobile/src/hooks/useStreamToolInvoking.ts` | hook + 导出 `computeToolInvoking` |
| `apps/desktop/renderer/hooks/useStreamToolInvoking.ts` | desktop 同逻辑副本 |
| `apps/mobile/src/utils/format-char-count.ts` | 自 metrics 迁出 `formatCharCount` |
| `ChatTranscriptBridge.ts` | `streamToolInvoking` bridge 消息 |
| `ChatTranscriptWebView.tsx` | 接收 `toolInvoking` prop |

## 单测

- `use-stream-tool-invoking.test.ts`：`computeToolInvoking` 边界
- `message-blocks.test.ts` / `build-transcript-rows.test.ts`：pending 工具卡、无 toolPhase
- 删除 metrics 单测

## WebView 增量渲染说明

assistant 含 `tool_use` 落库仍走 `sessionSnapshot('preserve')`（appendTail 无法刷新既有行 tools 状态）。`toolPhase` 移除后，pending → success 转换依赖 snapshot 全量刷新，逻辑不变。
