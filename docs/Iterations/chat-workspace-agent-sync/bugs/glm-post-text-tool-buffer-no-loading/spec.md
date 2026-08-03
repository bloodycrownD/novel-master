---
date: 2026-06-29
---

# glm-post-text-tool-buffer-no-loading Bug 修复规格（SPEC）

> **父级 PRD**：[../../prd.md](../../prd.md)  
> **Bug PRD**：[prd.md](./prd.md)  
> **相关历史**：[../glm-tool-stream-stalled-metrics/spec.md](../glm-tool-stream-stalled-metrics/spec.md)（仅借鉴 Core `tool_stream`，不恢复 metrics delta）

## 设计目标

在**不恢复** `TOOL_USE_DELTA` / metrics tool 计数的前提下，让 `chat-workspace-agent-sync` **两事件模型事件 1** 覆盖 GLM「thinking → 正文 → tool_call」路径；并改善正文后空等阶段的**终止**语义与 UI 反馈。

## 总体方案

```text
┌─────────────────────────────────────────────────────────────┐
│ P0-A Core: GLM + stream + tools → body.tool_stream = true   │
│         → 增量 tool_calls → 更早 EVENT_AGENT_STREAM_TOOL_USE │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│ P0-B UI: 扩展 computeToolInvoking                           │
│   路径1 (既有): thinking>0, text=0, thinkingIdle≥300ms      │
│   路径2 (新增): text>0, textIdle≥300ms, agentRunning        │
│   toolInvoking = heuristic ∨ toolUseLatched                 │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│ P1 Abort: ChatComposer 终止 → onStreamReset 即时反馈        │
│         agent-runner: signal.aborted → 跳过 assistant 落库   │
│                        与 runParallel                        │
└─────────────────────────────────────────────────────────────┘
```

与父级迭代关系：父级 `spec.md` 删除清单含 `tool_stream`；本修复为 **GLM OpenAPI 必需字段的定向恢复**，与「废弃 delta 计数」正交。

## 根因（代码锚点）

| 现象 | 位置 | 要点 |
|------|------|------|
| 无 `tool_stream` | `openai.adapter.ts` L115-133 `buildBody` | 无 GLM 分支 |
| 有正文即 false | `useStreamToolInvoking.ts` L24-26 | `textContent.length > 0` |
| interval 提前退出 | `useStreamToolInvoking.ts` L76-78 | `textRef.length > 0` 时不评估 |
| latch 过晚 | `openai-content-mapper.ts` `tryEmitOpenAiToolUseIfComplete` | 需完整 JSON |
| 首包正文清 latch | `useChatStreamRuntime.ts` L197-199 | `clearToolUseLatch()` |
| Desktop 无 latch | `ConversationPanel` / `useAgentStream` | 未订阅 `EVENT_AGENT_STREAM_TOOL_USE` |
| abort 仍 append | `agent-runner.test.ts` L153-202 | abort 后 assistant 仍落库 |
| 终止无 UI 反馈 | `ChatComposer.tsx` L171-173 | `running` 保持至 finally |

## 变更点清单

### Core

| 文件 | 变更 |
|------|------|
| `packages/core/src/infra/llm-protocol/logic/glm-tool-stream.ts` | **新增** `isGlmToolStreamModel(vendorModelId)` |
| `packages/core/src/infra/llm-protocol/impl/openai.adapter.ts` | `buildBody`：`stream && tools.length>0 && isGlmToolStreamModel` → `tool_stream: true` |
| `packages/core/test/infra/llm-protocol/glm-tool-stream.test.ts` | **新增** 型号判定单测 |
| `packages/core/test/infra/llm-protocol/openai.adapter.test.ts` | buildBody 含/不含 `tool_stream` |
| `packages/core/src/service/agent/impl/agent-runner.ts` | `request` 返回后若 `signal.aborted`：跳过 `session.append(assistant)`、`runParallel` |
| `packages/core/test/agent/agent-runner.test.ts` | 更新 abort 用例：cancelled 时不落库 assistant |

### Mobile

| 文件 | 变更 |
|------|------|
| `apps/mobile/src/hooks/useStreamToolInvoking.ts` | 扩展 `computeToolInvoking` 输入/逻辑；`lastTextAtRef`；interval 评估 post-text 路径 |
| `apps/mobile/src/hooks/useStreamToolInvokingDisplay.ts` | 透传 `noteTextDelta` 更新 text idle（若逻辑下沉到 hook 则最小改） |
| `apps/mobile/src/screens/tabs/chat-tab/useChatStreamRuntime.ts` | 评估是否移除/延后 `clearToolUseLatch` on first text |
| `apps/mobile/__tests__/use-stream-tool-invoking.test.ts` | post-text idle → true；有正文不否定 thinking-only 回归 |
| `apps/mobile/__tests__/use-chat-stream-runtime.test.ts` | thinking→text→timer → `toolInvoking` |
| `apps/mobile/src/components/chat/ChatComposer.tsx` | 终止时调用 `onStreamReset()`（即时清 stream）；可选 toast「已取消」 |

### Desktop

| 文件 | 变更 |
|------|------|
| `apps/desktop/renderer/hooks/useStreamToolInvoking.ts` | 与 mobile 同步 post-text 启发式 |
| `apps/desktop/renderer/features/chat/ConversationPanel.tsx` 或 `useAgentStream` | 订阅 `EVENT_AGENT_STREAM_TOOL_USE` → latch（可抽 `useStreamToolInvokingDisplay` 副本） |
| `apps/desktop/test/use-stream-tool-invoking.test.ts` | 对等单测 |

## 详细实现步骤

### 步骤 1：Core `glm-tool-stream`

```typescript
// glm-tool-stream.ts（示意）
export function isGlmToolStreamModel(vendorModelId: string): boolean {
  const id = vendorModelId.toLowerCase().replace(/^models\//, "");
  if (id.includes("glm-4.6") || id.includes("glm-4.7")) return true;
  return /glm-5(?:\.|$|-)/.test(id);
}
```

`buildBody` 末尾：

```typescript
if (stream && req.tools != null && req.tools.length > 0
    && isGlmToolStreamModel(req.vendorModelId)) {
  body.tool_stream = true;
}
```

### 步骤 2：扩展 `computeToolInvoking`

新增输入 `msSinceLastTextDelta: number`（可选，默认 ∞）。

```typescript
// 路径1（保留）
const thinkingPath =
  thinkingContent.length > 0 &&
  textContent.length === 0 &&
  msSinceLastThinkingDelta >= threshold;

// 路径2（新增）
const postTextToolPendingPath =
  textContent.length > 0 &&
  msSinceLastTextDelta >= threshold;

return thinkingPath || postTextToolPendingPath;
```

`useStreamToolInvoking`：

- 增加 `lastTextAtRef`，`noteTextDelta` 更新
- `setInterval` 条件改为：在 `agentRunning` 下始终调用统一 `readToolInvoking`（移除 L76 `textRef.length > 0` 早退）
- `noteTextDelta` 在 `prev===true` 时重算（与 thinking 对称）

**`clearToolUseLatch` 策略**：保留首包正文清除 latch（tool-use 尚未到达时合理）；post-text 启发式不依赖 latch，与 P0-A 互补。

### 步骤 3：Desktop latch

在 `useAgentStream` 或 `ConversationPanel` 中 mirror mobile：

- `runtime.eventBus.subscribe(EVENT_AGENT_STREAM_TOOL_USE, …)` → `latchToolUse`
- `toolInvoking = heuristic || latched` 传入 `MessageList`

### 步骤 4：Abort 语义

**ChatComposer** `send()` running 分支：

```typescript
runAbortController?.abort();
onStreamReset(); // 即时清 stream tail / metrics acc 由 reset 链路处理
return;
```

**agent-runner** 在 `result = await modelRequests.request` 之后：

```typescript
if (signal?.aborted) {
  stopReason = "cancelled";
  break; // 在 session.append(assistant) 之前
}
```

现有测试 L153-202 期望 abort 后仍有 assistant → **改为** cancelled 且无新 assistant（或仅保留 streaming partial 不落库策略，与 `openai.adapter` partial blocks 一致：abort 时不 append）。

### 步骤 5：验证与文档

- 跑 core / mobile / desktop 相关 jest
- 手工：GLM 5.2 触发 write，观察正文后横条与终止

## 测试策略

### 测试用例

| ID | 层 | 场景 | 预期 |
|----|-----|------|------|
| T1 | Core | `isGlmToolStreamModel("glm-5.2")` | true |
| T2 | Core | `isGlmToolStreamModel("gpt-4o")` | false |
| T3 | Core | GLM buildBody stream+tools | `tool_stream: true` |
| T4 | Core | GPT buildBody stream+tools | 无 `tool_stream` |
| T5 | Mobile | thinking only idle | true（回归） |
| T6 | Mobile | text>0, text idle 300ms, running | true |
| T7 | Mobile | text>0, text still streaming | false |
| T8 | Mobile | TOOL_USE latch + post-text | true |
| T9 | Core | abort during request, had tool blocks in partial | stopReason=cancelled, 无 assistant 落库 |
| T10 | Desktop | post-text idle | 同 T6 |

### 命令

```bash
cd packages/core
npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test \
  test/infra/llm-protocol/glm-tool-stream.test.ts \
  test/infra/llm-protocol/openai.adapter.test.ts \
  test/agent/agent-runner.test.ts

cd apps/mobile
npm test -- use-stream-tool-invoking use-chat-stream-runtime

cd apps/desktop
npm test -- use-stream-tool-invoking
```

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 非智谱 OpenAI 兼容网关收到 `tool_stream` | 严格 `isGlmToolStreamModel`；单测覆盖误匹配型号 |
| post-text 启发式在「纯文本回复」末尾误亮 | 仅 `agentRunning` 时为 true；`runFinished` reset；若模型最终无 tool，assistant 落库后 stream reset |
| abort 不落库与 partial stream 已展示正文 | `onStreamReset` 清 UI；不落库则 reload 后无该 assistant |
| 父级「废弃 tool_stream」文档冲突 | Bug PRD 已说明定向恢复；合并后更新父级 PRD 脚注 |

**回滚**：revert 本 bug 分支；移除 `tool_stream` 注入与 post-text 分支即可。

## 最终项目结构（新增）

```text
packages/core/src/infra/llm-protocol/logic/glm-tool-stream.ts
packages/core/test/infra/llm-protocol/glm-tool-stream.test.ts
.apm/kb/docs/Iterations/chat-workspace-agent-sync/bugs/glm-post-text-tool-buffer-no-loading/
  prd.md
  spec.md
```
