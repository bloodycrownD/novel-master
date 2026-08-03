---
date: 2026-06-13
---

# glm-tool-stream-stalled-metrics Bug 修复规格（SPEC）

## 根因分析

### 主因：未启用 GLM `tool_stream`

智谱 Z.AI OpenAPI 文档规定：流式 `chat/completions` 且携带 `tools` 时，须在请求体根级设置 `tool_stream=true`，才会增量推送 `tool_calls[].function.arguments`。默认行为为整包缓冲，大 write 参数生成期间 SSE 无 tool delta → `EVENT_AGENT_STREAM_TOOL_USE_DELTA` 不触发 → `toolUseChars` 恒为 0。

本仓库 `OpenAiProtocolAdapter.buildBody` 此前未发送该字段。

### 次因：mixed 模式 metrics 前缀

`useAgentStreamMetrics` 中 `buildChatStreamMetricsLine` 仅在 `streamKind === 'tool'` 时使用「工具调用生成中」。GLM 先输出 `reasoning_content` 再输出 tool 参数时，`thinkingChars > 0` 且 `toolUseChars > 0` → `streamKind === 'mixed'` → 前缀仍为「生成中」，用户感知为未进入工具阶段。

### 非 bug（设计澄清）

气泡「工具调用 (N)」与「正在执行工具调用…」仅在 assistant 消息**落库后**出现；流式生成 tool JSON 期间只靠 metrics 条反馈，不在 transcript 渲染工具块。

## 修复方案

1. **Core**：新增 `isGlmToolStreamModel(vendorModelId)`，在 `buildBody` 中当 `stream && tools.length > 0` 且型号匹配 GLM 4.6/4.7/5 时设置 `tool_stream: true`
2. **UI**：`buildChatStreamMetricsLine` / desktop 等价函数：当 `running && toolUseChars > 0 && textChars === 0` 时前缀用「工具调用生成中」

## 变更点清单

| 文件 | 变更 |
|------|------|
| `packages/core/src/infra/llm-protocol/logic/glm-tool-stream.ts` | 新增 GLM 型号判定 |
| `packages/core/src/infra/llm-protocol/impl/openai.adapter.ts` | `buildBody` 注入 `tool_stream` |
| `packages/core/test/infra/llm-protocol/glm-tool-stream.test.ts` | 型号判定单测 |
| `packages/core/test/infra/llm-protocol/openai.adapter.test.ts` | buildBody 含/不含 tool_stream |
| `apps/mobile/src/hooks/useAgentStreamMetrics.ts` | mixed 阶段前缀 |
| `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts` | 同上 |
| `apps/mobile/__tests__/use-agent-stream-metrics.test.ts` | 前缀回归 |
| `apps/desktop/test/use-agent-stream-metrics.test.ts` | 前缀回归 |

## 详细改动说明

`isGlmToolStreamModel` 规范化 `vendorModelId`（去 `models/` 前缀、小写），匹配 `glm-4.6*`、`glm-4.7*`、`glm-5*`。

`tool_stream` 与 `stream_options.include_usage` 同级，不影响非 GLM 提供商。

Metrics 前缀逻辑优先判断「仅有工具参数在增长」（`textChars === 0` 且 `toolUseChars > 0`），覆盖 thinking 已结束后的 mixed 场景。

## 测试策略

### 测试用例

- `isGlmToolStreamModel`：glm-4.7 / GLM-4.7-Flash / models/glm-5 为 true；gpt-4o / glm-4-flash 为 false
- `buildBody`：GLM + stream + tools → `tool_stream: true`；GPT + 同条件 → 无该字段
- `buildChatStreamMetricsLine`：thinking=100, tool=50, text=0 → 前缀「工具调用生成中」且含工具参数字数

## 风险与回滚方案

- **风险**：其他 OpenAI 兼容网关若误识别 GLM 型号可能收到未知字段（通常忽略）
- **回滚**：移除 `tool_stream` 注入与 metrics 前缀分支即可；不影响已落库消息
