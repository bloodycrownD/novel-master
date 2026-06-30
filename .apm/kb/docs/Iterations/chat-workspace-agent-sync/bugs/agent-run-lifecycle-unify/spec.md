---
date: 2026-06-28
---

# agent-run-lifecycle-unify 技术规格（SPEC）

> **父级 PRD**：[../../prd.md](../../prd.md)  
> **Bug PRD**：[prd.md](./prd.md)  
> **相关**：[../glm-post-text-tool-buffer-no-loading/spec.md](../glm-post-text-tool-buffer-no-loading/spec.md)

## 设计目标

1. Core **`runId`** + stale 事件过滤。  
2. **`uiRunning`** / **`agentActive`** 双信号，终止乐观、busy 保守。  
3. **`useAgentRunLifecycle`** 管理 **UI 与 `activeRunId`**；**`agentActive` refcount 由平台层独占**（见下）。  
4. Desktop `agent.ts` / renderer 竞态修补。  
5. **`streamTailGenerating`**：idle **300ms**；文案「生成中」；删除 `useStreamToolInvoking*`。

## 双信号职责（写死，禁止双端重复 refcount）

| 信号 | Mobile owner | Desktop owner | Renderer / UI hook |
|------|--------------|---------------|-------------------|
| **`agentActive`**（busy） | `runtime/agent-activity.ts` refcount | `main/runtime/agent-activity.ts` refcount | **不**在 `useAgentRunLifecycle` 内 increment/decrement |
| **`uiRunning`** | `useAgentRunLifecycle` | `useAgentRunLifecycle`（renderer） | composer + metrics + stream tail |
| **`activeRunId`** | `useAgentRunLifecycle` | 同左 | 过滤 bus / IPC 事件 |

**`runId` 唯一来源**：Core `agent-runner.run()` 生成并在 **`EVENT_AGENT_RUN_STARTED`** 发布。Main / Mobile bus **不得**自行 `generateAgentRunId()` 用于登记。

## 命名映射与接线矩阵

| 文档信号 | Mobile 文件 / prop | 绑定的信号 |
|----------|-------------------|------------|
| `uiRunning` | `ChatComposer.running`；`ChatStreamMetricsBarLive`；`useStreamTailGenerating` | `uiRunning` |
| `agentActive` | `isMobileAgentActive()`；`ChatConversationPanel` → 工具卡 `agentRunning`；`message-blocks.isTurnToolExecuting` | **`agentActive`**（非 `uiRunning`） |
| `streamTailGenerating` | `MessageList` / `ChatTranscriptWebView` | `streamTailGenerating` |
| `activeRunId` | `useAgentRunLifecycle` + `useChatStreamRuntime` 守卫 | 内部状态 |

| 行为 | 绑定信号 |
|------|----------|
| 长按消息菜单禁用 | `uiRunning` |
| 批处理 / 编辑守卫（`useChatTabMessages`） | `uiRunning` |
| `agentRunningRef`（reload 合并） | `agentActive` |
| 工具卡「执行中」 | `agentActive` + DB pending（见下） |

**工具卡门控**：`status=pending` 仅在 **`agentActive &&`** 该 assistant 为当前未完成回合时显示「执行中」。`agentActive=false` 后 pending 卡显示为「已中断」或保持 success/error 前态（实现取最小 diff：abort 后若已有 tool_result 则 success/error；若 assistant 已落库但 tool 未执行完且 run 已取消，卡文案「已中断」，**不**永久「执行中」）。

**禁止**：`ChatConversationPanel` 内 `setMobileAgentActive(running)`。

## Hook 契约

### `useAgentRunLifecycle`（双端 renderer / Mobile 同构）

```typescript
export type AgentRunLifecycle = {
  readonly uiRunning: boolean;
  readonly activeRunId: string | null;
  /** 发 run 前：uiRunning=true；Mobile 同时 incrementAgentActive（见 busy 时序） */
  beginUiRun(): void;
  /** 终止：uiRunning=false + onStreamReset；不碰 agentActive */
  abortUiRun(): void;
  /** runId 不匹配则丢弃；匹配则更新 activeRunId */
  acceptRunEvent(runId: string | undefined): boolean;
  /** 仅设 activeRunId=runId、uiRunning=true（幂等）；不 increment agentActive */
  onRunStarted(payload: AgentRunStartedPayload): void;
  /** 仅 accept 时：activeRunId=null、uiRunning=false；不 decrement agentActive */
  onRunFinished(payload: AgentRunFinishedPayload): void;
  onRunFailed(payload: AgentRunFailedPayload): void;
  resetUiForSessionChange(): void;
};
```

### busy 时序（Mobile 与 Desktop 对齐）

| 步骤 | Mobile | Desktop |
|------|--------|---------|
| 门禁检查 | `executeRun` 入口 `if (isMobileAgentActive())` 拒绝 | `handleAgentRun` 入口 `if (isDesktopAgentActive())` → `AGENT_BUSY` |
| **increment** | **`beginUiRun()`**（在 `await runAgentTurn` 之前） | **`handleAgentRun` 通过 IPC 前**：main 在 `void runAgentTurn` 前 **`incrementAgentActive()`** |
| runId 登记 | `onRunStarted` ← bus `RUN_STARTED` | main `forward-event-bus` 见 RUN_STARTED → 更新 `activeRuns` |
| **decrement** | `RUN_FINISHED`/`FAILED`（accept + `runId`）→ `decrementAgentActive` | 同左；或 `handleAgentRun` **catch**（IPC 失败未启动 run） |
| abort | `abortUiRun`；**不** decrement | `abortAgentRun` 仅 abort；decrement 等 FINISHED |
| **早退兜底** | `executeRun`：`beginUiRun` 已 increment 但未收到匹配 FINISHED/FAILED 时，`catch`/`finally` **必须** `decrementAgentActive()`（幂等） | `handleAgentRun` **catch**（`runAgentTurn` 未启动）`decrementAgentActive()` |

Mobile **`beginUiRun` 必须** `incrementAgentActive()`，避免 `beginUiRun` → `RUN_STARTED` 窗口内双发。

### `useStreamTailGenerating`

```typescript
export type StreamTailGenerating = {
  readonly streamTailGenerating: boolean;
  noteStreamDelta(): void;  // 仅 text/thinking
  resetStreamClock(): void;
};
```

### `computeStreamTailGenerating`（Core）

```typescript
export function computeStreamTailGenerating(input: {
  uiRunning: boolean;
  msSinceLastStreamDelta: number;
  idleThresholdMs?: number;
}): boolean {
  if (!input.uiRunning) return false;
  return input.msSinceLastStreamDelta >= (input.idleThresholdMs ?? 300);
}
```

`EVENT_AGENT_STREAM_TOOL_USE`：不调用 `noteStreamDelta()`；接受 ≤300ms 延迟。

### stream 占位行

```text
uiRunning && (hasStreamTextOrThinking || streamTailGenerating)
```

### stale 事件守卫（须 `acceptRunEvent` 先于副作用）

以下 handler **必须先** `if (!acceptRunEvent(payload.runId)) return`：

- `EVENT_AGENT_STREAM_TEXT_DELTA` / `THINKING_DELTA` → `noteStreamDelta`、ingress
- `EVENT_AGENT_STREAM_TOOL_USE`（若仍订阅，仅丢弃，不驱动 latch）
- `EVENT_AGENT_STEP_COMMITTED` → `flushAgentStepUi` / reload
- `EVENT_AGENT_RUN_FINISHED` / `RUN_FAILED` → flush、`decrementAgentActive`（Mobile）、lifecycle 收尾

## 总体方案

```text
Core: runId @ RUN_STARTED
  → bus/IPC（全 payload 带 runId）
  → acceptRunEvent 过滤
  → agentActive refcount（平台层 increment/decrement）
  → useAgentRunLifecycle（uiRunning + activeRunId）
  → useStreamTailGenerating（300ms idle）
```

## 变更点清单

### Core

| 文件 | 变更 |
|------|------|
| `domain/agent/logic/generate-agent-run-id.ts` | **新增**（仅 Core 调用） |
| `domain/chat/logic/compute-stream-tail-generating.ts` | **新增** + 单测 |
| `domain/events/model/event-types.ts` | 全部 agent payload + `runId`（含 `STEP_COMMITTED`、`RUN_FAILED`） |
| `service/agent/impl/agent-runner.ts` | 生成 `runId`；全 publish 带 `runId`；`wrapStreamForBus(..., runId)` |
| `test/agent/*.ts` | runId、abort 不落库、stale delta |

**abort 落库守卫**：`request` 返回后、`append(assistant)`、`runParallel`、`append(tool_results)` 前 `signal?.aborted` 检查。

### Desktop main

| 文件 | 变更 |
|------|------|
| `src/main/runtime/agent-activity.ts` | `increment/decrement/isDesktopAgentActive` |
| `src/main/ipc/forward-event-bus.ts` | `RUN_STARTED`/`FINISHED`/`FAILED` 转发时登记/清理 run 登记 |
| `src/main/ipc/handlers/agent.ts` | 见下方伪代码 |

**`agent.ts` 伪代码（定稿）：**

```typescript
type RunEntry = { controller: AbortController; runId: string | null };
const activeRuns = new Map<string, RunEntry>();

// forward-event-bus 或 main 内 bus 订阅（二选一，写注释写死）：
function onCoreRunStarted({ sessionId, runId }: AgentRunStartedPayload) {
  const entry = activeRuns.get(sessionId);
  if (entry != null) entry.runId = runId;
}

function onCoreRunFinished({ sessionId, runId }: AgentRunFinishedPayload) {
  const entry = activeRuns.get(sessionId);
  if (entry?.runId === runId) {
    activeRuns.delete(sessionId);
    decrementAgentActive();
  }
}

// handleAgentRun
if (isDesktopAgentActive()) return AGENT_BUSY;
const controller = new AbortController();
activeRuns.set(sessionId, { controller, runId: null });
incrementAgentActive();
void runAgentTurn(..., { signal: controller.signal })
  .finally(() => {
    const entry = activeRuns.get(sessionId);
    if (entry?.controller === controller && entry.runId != null) {
      // 正常路径由 RUN_FINISHED 递减；此处仅兜底 controller 结束但 FINISHED 未达
      activeRuns.delete(sessionId);
      decrementAgentActive();
    }
  });

// abortAgentRun — 仅 abort + delete map entry；decrement 交给 FINISHED 或 finally 兜底
activeRuns.get(sessionId)?.controller.abort();
activeRuns.delete(sessionId);
```

> **注意**：`finally` 兜底与 `RUN_FINISHED` 互斥 decrement 须单测保证不双减（decrement 幂等或 `if (wasActive)` 守卫）。

### Desktop renderer

| 文件 | 变更 |
|------|------|
| `shared/agent-event-types.ts` | 全 payload + `runId`；`RUN_STARTED` |
| `renderer/hooks/useAgentRunLifecycle.ts` | **新增**；**仅** uiRunning + activeRunId |
| `renderer/hooks/useStreamTailGenerating.ts` | **新增** |
| `renderer/hooks/useAgentStream.ts` | 全事件 `acceptRunEvent` 前置 |
| `renderer/features/chat/ConversationPanel.tsx` | lifecycle；`onRunFinished`/`onRunFailed` runId 守卫 |
| `renderer/features/chat/ChatComposer.tsx` | `abortUiRun` + IPC abort |
| **删除** | `useStreamToolInvoking*` |

### Mobile

| 文件 | 变更 |
|------|------|
| `runtime/agent-activity.ts` | refcount |
| `hooks/useAgentRunLifecycle.ts` | **新增**；`beginUiRun` → `incrementAgentActive` |
| `hooks/useStreamTailGenerating.ts` | **新增** |
| `screens/tabs/chat-tab/useChatStreamRuntime.ts` | 全 bus 守卫；`RUN_FINISHED`/`FAILED` → `decrementAgentActive` |
| `screens/tabs/chat-tab/ChatConversationPanel.tsx` | 移除 `setMobileAgentActive(running)`；工具卡 `agentRunning={agentActive}` |
| `screens/tabs/ChatTabScreen.tsx` | 见接线矩阵 |
| `components/chat/ChatComposer.tsx` | `beginUiRun`；busy 门禁；乐观 `abortUiRun`；删除 keep-running-until-finally |
| **删除** | `useStreamToolInvoking*` |

### 删除引用表

| 文件 |
|------|
| `apps/mobile/src/hooks/useStreamToolInvoking.ts` |
| `apps/mobile/src/hooks/useStreamToolInvokingDisplay.ts` |
| `apps/mobile/__tests__/use-stream-tool-invoking.test.ts` |
| `apps/mobile/__tests__/use-chat-stream-runtime.test.ts`（改断言） |
| `apps/desktop/renderer/hooks/useStreamToolInvoking.ts` |
| `apps/desktop/renderer/hooks/useStreamToolInvokingDisplay.ts` |
| `apps/desktop/renderer/__tests__/*tool-invoking*`（若存在） |
| `useChatStreamRuntime.ts`、`ConversationPanel.tsx`、双端 `MessageList.tsx` |

## 实现步骤

1. **Core** runId + `computeStreamTailGenerating` + abort 测  
2. **Desktop main** refcount + `agent.ts` + RUN_STARTED 登记  
3. **双端 hooks** lifecycle（无 busy）+ stream tail  
4. **Mobile** `beginUiRun` increment + stream runtime decrement  
5. **删除旧 hook** + 接线矩阵落地  
6. **测试** T1–T22

## 测试策略

| ID | 场景 | 预期 |
|----|------|------|
| T1–T2 | Core runId / stream | 一致 |
| T3–T6 | `computeStreamTailGenerating` | 见 PRD |
| T7 | abort 第二轮 request | cancelled |
| T8 | Mobile abort | ≤300ms uiRunning=false |
| T9 | stale FINISHED | 不污染 B |
| T10 | teardown 中再发 | 拒绝 |
| T11–T12 | idle / TOOL_USE only 300ms | 「生成中」 |
| T13 | tool 卡 | 「执行中」绑 agentActive |
| T14 | Desktop abort refcount | busy 至 FINISHED |
| T15 | stale onRunFinished | 不 setRunning(false) |
| T16 | RUN_STARTED | activeRunId 设置 |
| T17 | stale microtask delta | 丢弃 |
| T18 | Desktop session 切换 | uiRunning=false |
| T19 | Mobile session 切换 | `resetUiForSessionChange` |
| T20 | stale STEP_COMMITTED | 不 reload |
| T21 | stale RUN_FAILED | 不 decrement 错 run |
| T22 | Mobile beginUiRun 双点 | 第二次拒绝 |
| T23 | Mobile/Desktop run 早退（无 RUN_STARTED） | agentActive 回落（幂等 decrement） |

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| FINISHED 与 finally 双 decrement | 幂等 decrement 或单路径递减 |
| abort 后不可重发 | P2 toast |
| TOOL_USE 300ms | 用户已接受 |

---

分支：`fix/agent-run-lifecycle-unify`。
