---
date: 2026-06-13
status: implemented
branch: fix/glm-tool-stream-stalled-metrics
---

# chat-workspace-agent-sync 工具调用 UX PRD

## 背景

此前工具调用进度依赖三条并行机制：stream metrics 条（字数/速率）、`TOOL_USE_DELTA` 事件累加、assistant 气泡内 `toolPhase` 阶段条「正在执行工具调用…」。三者语义重叠、与 WebView 增量渲染不兼容，且 GLM `tool_stream` 路径增加维护成本。

用户确认采用 **两事件模型**，完全移除 metrics 与 delta 链路。

## 目标 UX（两事件）

| 时机 | UI |
|------|-----|
| **事件 1 — stream tail** | thinking 流结束且接下来无正文（无 text-delta）：stream 行显示「**工具调用中**」（thinking idle ≥300ms + agentRunning + 有过 thinking + 无 text） |
| **事件 2 — assistant 落库** | 消息含 `tool_use` 即渲染工具调用卡片（`pending` →「执行中」）；不再显示「正在执行工具调用…」phase bar |

## 废弃项

- `useAgentStreamMetrics`、`ChatStreamMetricsBar`、`AgentStreamMetricsBar` 及单测
- `EVENT_AGENT_STREAM_TOOL_USE_DELTA` / `LlmStreamEvent tool-use-delta` 全链路
- `glm-tool-stream.ts`、`openai.adapter` 的 `tool_stream`
- `ToolTurnPhaseBar` 用于 message 行（assistant 落库后 phase bar）
- `freezeToLastRun`（仅 metrics 用）
- `toolPhase: executing` 用于 UI 的路径

## 非目标

- 不在 LLM 流式中途提前渲染 per-tool 参数增量
- 不恢复 stream metrics 字数/速率条

## 验收标准

1. thinking 结束后、tool_use 落库前，stream tail 稳定显示「工具调用中」
2. assistant 含 `tool_use` 落库后立即出现 pending 工具卡，tool_result 返回后变为 success/error
3. 无 metrics 条、无 phase bar、无 TOOL_USE_DELTA 订阅
4. mobile jest + core test 通过
