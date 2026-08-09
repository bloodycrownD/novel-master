---
date: 2026-08-09
---

# Session Runtime 抽取 技术规格（SPEC）

> 需求文档：`docs/Iterations/session-runtime-extract/prd.md`
> 依赖前置：`agent-subagent`（已实现）、`prompt-engine-refactor`（已实现）

## 设计目标

把 mobile 和 desktop 的 session 级运行时能力（stream / abort / batch / composer）拆成四个独立可插拔单元，让主会话和子会话各自按需组合。同时在 Core 层新增 abort registry，使子会话能独立中断子 agent，中断后末条消息作为失败 tool_result 回流父 agent。

## 总体方案

分三个 phase 实施，前后依赖：

```
Phase 1（Core）        Phase 2（Mobile）           Phase 3（Desktop）
abort registry         四能力拆分                   四能力拆分
中断回流语义           SubagentSessionScreen 重构   ConversationPanel 拆分
父中断级联             子会话停止按钮               子会话停止按钮
```

Phase 1 是 Phase 2/3 的前置——UI 层的独立中断依赖 Core 先开口子。Phase 2 和 Phase 3 文件域不重叠，可并行。

### Phase 1 核心设计

**abort registry**：新增 `AgentAbortRegistry`（`Map<sessionId, AbortController>` 薄封装），挂到 `AgentTurnRuntimePort`（可选字段，CLI 不注入也能跑）。`runAgentTurn` 和 `runChildAgent` 启动时注册 controller、try/finally 结束时反注册。

**controller 注册策略（P0-1 决议）**：`AbortSignal` 不暴露 underlying controller，core 拿到 caller 传入的 signal 也无法 register。所以 `runAgentTurn` 永远**内部 `new AbortController()`** 作为注册到 registry 的目标——不管 caller 有没有传 signal 都一样。caller 传入的 `signal` 参数保留为**级联触发源**：core 拿到 caller signal 后做桥接，`callerSignal.addEventListener("abort", () => internalController.abort(callerSignal.reason), { once: true })`，让外部 abort 同步级联到 internal controller。runChildAgent 的 childController 自建逻辑沿用现状，只是额外多一步 register。

**中断回流**：task 工具 `run` 方法在 `stopReason === "cancelled"` 时返回 `{ text: 末条文本, subagentSessionId, stopped: true, failureReason: SUBAGENT_STOP_REASON_USER }`（路线 B，不抛异常）。`buildToolResultBlock` 识别 `output.stopped === true` 翻 `ok: false` + 带 `meta.subagentSessionId` + `meta.failureReason`。

**父中断级联**：已有的 `parentSignal.addEventListener("abort", ...)` 天然成立，不需新机制；parentSignal 级联和 caller signal 桥接是两条独立链路，互不重叠。

### Phase 2 核心设计（Mobile）

从 `useChatStreamRuntime`（三股逻辑交织）拆出三个独立 hook：

| 单元 | 提取来源 | 输入 | 输出 |
|---|---|---|---|
| `useSessionStream` | stream 事件订阅 + state | sessionId、lifecycle 守卫函数 | streamingText、streamingThinking、handleStreamReset |
| `useSessionAbort` | useAgentRunLifecycle 的 abort 状态机 | sessionId、abortRegistry | abortUiRun、`getTranscriptFreezeCount()`（getter，不是 state）、abortRetainPending、commitAbortOverlay |
| `useSessionBatch` | wire queue + apply buffer | batchEnabled、webview ref | pushStreamBatch / pushStreamDelta 入口 |

`getTranscriptFreezeCount()` 以 getter 形态输出（不是 state）：freeze 计数会被高频 bus 回调读取，state 读取会额外触发 React 订阅/重渲染开销，换成 getter 后调用方拿到的总是最新值，bus 回调里读它零成本。

composer 在 mobile/desktop 两端均为 dumb component，**不抽 hook**、不进 session 级层。本次仅做 wiring 改造：删除 composer 内部的外部 controller 创建（mobile `apps/mobile/src/components/chat/ChatComposer.tsx` 中 `new AbortController()` 与 `signal: controller.signal` 两处），改为只调 `runAgentTurn` 而不传 signal，让 core 自建 internalController 注册到 registry。停止按钮的 `runAbortController?.abort()` 改调 `abortUiRun()`（内部调 `abortRegistry.abort(sessionId)`）。`ChatTabProvider` 瘦身为消费 stream/abort/batch 单元的薄层 + tab 级 UI 状态。`SubagentSessionScreen` 改为消费 stream + abort + batch（不接 composer），删除平行实现。

**handleStreamReset 双向依赖解耦（P1-2 装配形态）**：stream 单元输出 `handleStreamReset`，abort 单元需要在其状态机里调它（abort 触发后清掉半成品 stream text）。推荐装配顺序——Provider 先实例化 `useSessionAbort`，传入一个占位 ref（`onStreamResetRef: MutableRefObject<() => void>`，初始值是 no-op）；再实例化 `useSessionStream`，把它输出的 `handleStreamReset` 写入同一个 ref；这样 abort 单元调用 `onStreamResetRef.current()` 即可，两个单元之间不直接 import。

### Phase 3 核心设计（Desktop）

desktop 的 `useAgentRunLifecycle` 近乎现成可做 abort 单元；`useAgentStream` 做 stream 单元事件源底座；batch 从零新建（renderer 层 buffer）；composer 保持 dumb component，仅做 wiring 改造（删外部 controller 创建，改调 core registry）。`ConversationPanel` 拆为消费四个单元的薄层。

desktop main 侧（`apps/desktop/src/main/ipc/handlers/agent.ts`）的 `handleAgentRun` 不再自建 `new AbortController()`、也不再写入 `activeRuns` Map——改由 core `runAgentTurn` 内部自建 internalController 注册到 registry；`abortAgentRun` / `handleAgentAbort` 改调 `rt.abortRegistry.abort(sessionId)`。`activeRuns` / `sessionRunIds` 的处理意见见 P0-3：保留为 RUN_STARTED/FINISHED/FAILED 事件与 runId 比对、`finishTrackedRun` refcount 递减的影子结构，不再存 controller；refcount 单一归属为 main 侧 `finishTrackedRun`，core 侧不再单独反注册 refcount，避免双递减。

## 最终项目结构

本次为重构，不新增顶层目录。新增文件集中在 Core abort registry + mobile/desktop 拆出的 hook。

## 变更点清单

### [新增] Core — abort registry（phase-1-registry）

| 文件 | 符号 | 说明 |
|---|---|---|
| `packages/core/src/service/agent/agent-abort-registry.port.ts` | `AgentAbortRegistry` 接口 | `register(sessionId, controller)` / `abort(sessionId)` / `unregister(sessionId, controller)`（带所有权校验）/ `has(sessionId)` |
| `packages/core/src/service/agent/create-agent-abort-registry.ts` | `createAgentAbortRegistry()` | Map 薄封装工厂；`unregister` 做 controller 引用比对（防误删新 run） |
| `packages/core/src/public/agent.ts` | re-export | 导出 registry 接口与工厂 |

### [改] Core — runAgentTurn / runChildAgent 注册 controller（phase-1-registry）

| 文件 | 改动 |
|---|---|
| `packages/core/src/service/agent/logic/run-agent-turn.ts` `AgentTurnRuntimePort` | 加可选字段 `readonly abortRegistry?: AgentAbortRegistry` |
| 同上 `runAgentTurn` | 永远内部 `new AbortController()`（下称 `internalController`），由它注册到 registry。caller 传入的 `signal` 不再被直接使用，而是做桥接：`callerSignal.addEventListener("abort", () => internalController.abort(callerSignal.reason), { once: true })`，让外部 abort 级联到 internal controller。try/finally 包住 `runner.run(...)`，启动时 `abortRegistry?.register(scope.sessionId, internalController)`，finally 里 `abortRegistry?.unregister(scope.sessionId, internalController)`。caller signal 为空时一样自建 internalController，只是不做桥接 |

### [改] Core — 中断回流语义（phase-1-abort-reflow）

| 文件 | 改动 |
|---|---|
| `packages/core/src/domain/tool/builtin/subagent-tool.ts` `TaskToolOutput` | 加 `readonly stopped?: boolean` + `readonly failureReason?: string`。同时导出常量 `SUBAGENT_STOP_REASON_USER = "用户停止"`，三处引用（run 返回值 / outputSchema 描述 / 单测）统一使用该常量 |
| 同上 `outputSchema` | 同步加 `stopped` / `failureReason` 可选字段 |
| 同上 `run` 方法 | `stopReason === "cancelled"` 时返回 `{ text: lastText ?? "[用户停止，无已生成文本]", subagentSessionId, stopped: true, failureReason: SUBAGENT_STOP_REASON_USER }`（不再走 `[子代理未完成任务]` fallback 文案）。cancelled 分支的 text 取值边界：lastText 为空（LLM 还未输出）时固定占位文案，不吞掉、也不用半成品空串 |
| `packages/core/src/domain/tool/logic/build-tool-result-block.ts` `buildToolResultBlock` | ok 分支内检测 `output.stopped === true` → 产 `ok: false` block + `meta.subagentSessionId` + `meta.failureReason` |
| `packages/core/src/service/agent/impl/agent-runner.ts` `extractSubagentSessionIdFromOutcome` | 现有逻辑在 `ok=true && output.subagentSessionId` 时已提取（用于写入 `meta.subagentSessionId` 供 UI 跳转），中断回流场景（output.stopped=true）同样走该路径即可拿到 subagentSessionId。本步骤实质是 **no-op**——但要加单测固化，避免后续重构中被误删 |

### [改] Core — ToolResultBlock.meta 扩展（phase-1-abort-reflow）

| 文件 | 改动 |
|---|---|
| `packages/core/src/domain/chat/model/content-block.ts` `ToolResultBlock.meta` | 现状为 `{ subagentSessionId?: string }`。扩展为 `{ subagentSessionId?: string; failureReason?: string }`，使 `buildToolResultBlock` 写入失败原因不报 TS 错 |

兼容性重申：`meta` 同 `summary` / `ok` 是 UI-only 旁路字段，mobile / desktop / CLI 三端 content mapper 天然忽略，不会回流给 LLM 上下文。

### [改] Mobile — 四能力拆分（phase-2-mobile-extract）

| 文件 | 改动 |
|---|---|
| `apps/mobile/src/screens/tabs/chat-tab/useSessionStream.ts`（新建） | 从 `useChatStreamRuntime` 提取 stream 事件订阅 + streamingText/streamingThinking state + stale 守卫。接收 lifecycle 守卫函数注入 |
| `apps/mobile/src/screens/tabs/chat-tab/useSessionAbort.ts`（新建） | 从 `useAgentRunLifecycle` 提取 abort 状态机（uiRunning/freezeCount 状态/abortRetainPending/abortUiRun）；freezeCount 对外以 getter `getTranscriptFreezeCount()` 暴露。接收 abortRegistry 访问、onStreamReset ref |
| `apps/mobile/src/screens/tabs/chat-tab/useSessionBatch.ts`（新建） | 从 `useChatStreamRuntime` 提取 wire queue + apply buffer + pushStreamBatch/pushStreamDelta 双路径 |
| `apps/mobile/src/screens/tabs/chat-tab/useChatStreamRuntime.ts` | 改为消费上述三个 hook 的薄编排层（主会话用）；或废弃，由 ChatTabProvider 直接组合 |
| `apps/mobile/src/hooks/useAgentRunLifecycle.ts` | 瘦身：abort 状态机挪到 useSessionAbort；保留 run 生命周期（activeRunId/onRunStarted/onRunFinished）+ agentActivity refcount |
| `apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx` | 瘦身：消费新 hook；移除 session 级字段，保留 tab 级 UI 状态 |
| `apps/mobile/src/components/chat/ChatComposer.tsx` | wiring 改造：删除 `new AbortController()` + `setRunAbortController` state + `signal: controller.signal` 传参 + finally 里的 controller 清理；停止按钮改调 `abortUiRun()`（内部调 `abortRegistry.abort(sessionId)`） |
| `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx` | 重构：删除平行实现（手搓的事件订阅/state），改为消费 useSessionStream + useSessionAbort + useSessionBatch；加停止按钮；mount 时查 `abortRegistry.has(sessionId)` 合成 onRunStarted 处理错过 RUN_STARTED 的场景 |

### [改] Desktop — 四能力拆分（phase-3-desktop-extract）

| 文件 | 改动 |
|---|---|
| `apps/desktop/renderer/hooks/useAgentRunLifecycle.ts` | 提取 abort 单元（近乎现成） |
| `apps/desktop/renderer/hooks/useAgentStream.ts` | 提取 stream 单元（事件源底座） |
| `apps/desktop/renderer/features/chat/conversation-batch.ts`（新建） | batch 单元（从零新建，renderer 层 buffer） |
| `apps/desktop/renderer/features/chat/ConversationPanel.tsx` | 拆为消费四个单元的薄层 |
| `apps/desktop/renderer/features/chat/ChatComposer.tsx` | 保持 dumb component，仅做 wiring 改造（删外部 controller 创建、改调 core registry） |
| `apps/desktop/renderer/layout/ChatRail.tsx` | readOnly 子会话面板加停止按钮 |

### [改] 两端 runtime 装配 — 注入 abortRegistry（phase-1-registry）

| 文件 | 改动 |
|---|---|
| `apps/mobile/src/runtime/types.ts` + `create-mobile-runtime.ts` | 加 `abortRegistry` 字段 + 实例化 |
| `apps/desktop/src/main/runtime/` | 加 `abortRegistry` 字段 + 实例化 |

## 兼容性说明

- **无 schema 变更**：不改 DB、不递增 `SCHEMA_BOOT_VERSION`。
- **ToolResultBlock.meta 扩展**：`meta` 从 `{ subagentSessionId?: string }` 扩为 `{ subagentSessionId?: string; failureReason?: string }`，新增的 `failureReason` 字段同 `subagentSessionId` 一样是 UI-only 旁路，mobile / desktop / CLI 三端 content mapper 天然忽略 meta，不污染 LLM 上下文。
- **abortRegistry 可选**：CLI 不注入也能跑（`abortRegistry?.register(...)` 空安全）。
- **现有 abort 级联保留**：`parentSignal.addEventListener("abort", ...)` 不动，registry 只负责「外部按 sessionId 找 controller」，级联走 parentSignal listener，两条路不重叠。
- **caller signal 桥接保留**：mobile ChatComposer / desktop handleAgentRun 在改造后不再传 signal，但 `runAgentTurn` 的 `signal` 参数依然支持传入并做 internalController 桥接，保证 CLI / 测试 / 第三方调用方不破。
- **行为变化**：task 工具中断后 tool_result 从「成功 + fallback 文案」变成「失败 + 末条文本 + 失败原因」。主 agent 能区分「用户停止」和「工具崩溃」。
- **父子同时 abort 竞态（P1-6 决议）**：用户在子会话点停止的同时，父会话也在 abort 的极端场景下——两个 abort 路径依赖的都是 `AbortController.abort()`，该 API 本身幂等、并发安全（重复 abort 同一个 controller 不会报错）；childController 上的 `parentSignal.addEventListener("abort", ..., { once: true })` 保证 parentSignal 监听只 fire 一次，registry 侧的 `abort(childSessionId)` 与父级联产生的 childController.abort 先后到达结果一致（最终都是 `signal.aborted === true`）。try/finally 的 `unregister` 带所有权比对（`map.get(sessionId) === controller`），重复调用也是 no-op。

## 详细实现步骤

### Phase 1 — Core abort registry + 中断回流

- Step 1 — phase-1-registry — blocking: yes — qa: auto：新建 `AgentAbortRegistry` 接口 + `createAgentAbortRegistry()` 工厂。`unregister` 做 controller 引用比对（`if (map.get(sessionId) === controller) map.delete(sessionId)`），防误删。`abort(sessionId)` 拿到 controller 调 `.abort()` 后不删（删由 finally 的 unregister 做）。从 `packages/core/src/public/agent.ts` re-export。
- Step 2 — phase-1-registry — blocking: yes — qa: auto：`AgentTurnRuntimePort` 加可选字段 `readonly abortRegistry?: AgentAbortRegistry`。
- Step 3 — phase-1-registry — blocking: yes — qa: auto：`runAgentTurn` 注册主 run controller。**永远**内部 `new AbortController()`（`internalController`）作为注册目标——不管 caller 有没有传 signal。caller 传了 signal 时做桥接：`callerSignal.addEventListener("abort", () => internalController.abort(callerSignal.reason), { once: true })`，让外部 abort 级联到 internal。启动时 `abortRegistry?.register(scope.sessionId, internalController)`，try/finally 包住 `runner.run(...)`，finally 里 `abortRegistry?.unregister(scope.sessionId, internalController)`。caller signal 为空时不做桥接、但仍自建 internalController。**`runner.run(...)` 的 `signal` 字段改传 `internalController.signal`**（原来传的是 `options?.signal`）。
- Step 4 — phase-1-registry — blocking: yes — qa: auto：`runChildAgent` 注册子 run controller。childController 创建后立刻 `abortRegistry?.register(childSessionId, childController)`。try/finally 包住 `runner.run(...)`，finally 里反注册（带所有权比对）。保留现有 parentSignal 级联。
- Step 5 — phase-1-registry — blocking: yes — qa: auto：mobile runtime + desktop runtime 装配段注入 `abortRegistry: createAgentAbortRegistry()`。
- Step 6 — phase-1-abort-reflow — blocking: yes — qa: auto：`TaskToolOutput` 加 `stopped?: boolean` + `failureReason?: string`，outputSchema 同步。
- Step 7 — phase-1-abort-reflow — blocking: yes — qa: auto：`subagent-tool.ts`：导出常量 `export const SUBAGENT_STOP_REASON_USER = "用户停止"`。run 方法 `stopReason === "cancelled"` 时返回 `{ text: lastText ?? "[用户停止，无已生成文本]", subagentSessionId, stopped: true, failureReason: SUBAGENT_STOP_REASON_USER }`。其他非 completed 保持现有 fallback。text 取值边界明确：cancelled 分支下 lastText 为空时固定占位文案，避免空字符串吞掉回流。
- Step 8 — phase-1-abort-reflow — blocking: yes — qa: auto：`buildToolResultBlock`：ok 分支检测 `output.stopped === true` → 产 `{ ok: false, content: output.text, meta: { subagentSessionId: output.subagentSessionId, failureReason: output.failureReason } }`。同时确认 `content-block.ts` `ToolResultBlock.meta` 已扩为 `{ subagentSessionId?: string; failureReason?: string }`，否则 TS 报错。
- Step 9 — phase-1-abort-reflow — blocking: yes — qa: auto：`extractSubagentSessionIdFromOutcome`（agent-runner 侧，给 buildToolResultBlock meta 入参用）实质 **no-op**——现有 `ok=true && output.subagentSessionId` 提取逻辑已覆盖中断回流场景（output.stopped=true 也满足该条件）。注意与 `resolveSubagentSessionIdFromOutcome`（build-tool-result-block 内部从 output 自检）是互补两路，no-op 固化只针对前者。本步骤动作是**加单测固化**（given output.stopped=true → extract 返回 subagentSessionId），避免后续重构被误删。
- Step 10 — phase-1-verify — blocking: yes — qa: auto：Core build + test（含新增 abort registry 单测 + 中断回流单测）。跑 `npm run build -w @novel-master/core` + `npm run test -w @novel-master/core`。

### Phase 2 — Mobile 四能力拆分

- Step 11 — phase-2-mobile-stream — blocking: yes — qa: auto：新建 `useSessionStream` hook，从 `useChatStreamRuntime` 提取事件订阅 + streamingText/streamingThinking state + acceptRunEvent/getUiRunning 守卫。接收 lifecycle 守卫函数注入（不直接依赖 abort 单元）。
- Step 12 — phase-2-mobile-batch — blocking: yes — qa: auto：新建 `useSessionBatch` hook，提取 wire queue + apply buffer + pushStreamBatch/pushStreamDelta 双路径。接收 batchEnabled 开关 + webview ref。
- Step 13 — phase-2-mobile-abort — blocking: yes — qa: auto：新建 `useSessionAbort` hook，从 `useAgentRunLifecycle` 提取 abort 状态机（uiRunning/freezeCount/abortRetainPending/abortUiRun）。`freezeCount` 以 getter `getTranscriptFreezeCount()` 形态输出（不是 state，避免高频 bus 回调读取时触发订阅/重渲染）。`abortUiRun` 内部调 `abortRegistry.abort(sessionId)` 触发 Core 层中断。**handleStreamReset 双向依赖解耦（P1-2）**：Provider 先实例化 `useSessionAbort`，传入占位 ref（`onStreamResetRef`，初始 no-op）；再实例化 `useSessionStream`，把 stream 输出的 `handleStreamReset` 在 effect 里写到 `onStreamResetRef.current`；abort 状态机调 `onStreamResetRef.current()` 即可，两个单元不直接 import。
- Step 14 — phase-2-mobile-composer — blocking: yes — qa: auto：`useAgentRunLifecycle` 瘦身：abort 状态机挪走后保留 run 生命周期（activeRunId/onRunStarted/onRunFinished）+ agentActivity refcount。**composer wiring 改造（P0-1 / P1-3）**：`ChatComposer.executeRun` 删除内部 `const controller = new AbortController()`、删除 `setRunAbortController` state、`runAgentTurn` 调用不再传 `signal`，让 core 自建 internalController 注册到 registry。`send` 函数里 `runAbortController?.abort()` 整行删掉，停止逻辑改调 `abortUiRun()`（由 useSessionAbort 提供）。composer 仍是 dumb component，不抽 hook。
- Step 15 — phase-2-mobile-provider — blocking: yes — qa: auto：`ChatTabProvider` 重构为消费 useSessionStream + useSessionBatch + useSessionAbort + 瘦身后的 lifecycle。移除 session 级字段，保留 tab 级 UI。确保主会话行为不变。按 Step 13 的装配顺序连接 stream/abort 单元的 handleStreamReset ref。
- Step 16 — phase-2-mobile-subagent — blocking: yes — qa: auto：`SubagentSessionScreen` 重构：删除平行实现（手搓事件订阅/state），改为消费 useSessionStream + useSessionAbort + useSessionBatch（不接 composer）。**错过 RUN_STARTED 的 stale 守卫（P1-1）**：mount 时主动查 `abortRegistry.has(sessionId)`，若该 sessionId 已有 in-flight run 则合成一次 `onRunStarted({ sessionId, runId })` 初始化 activeRunId，避免子会话页晚于 run 启动打开时 `acceptRunEvent` 永远拒绝。
- Step 17 — phase-2-mobile-stop — blocking: yes — qa: manual_user：子会话页加停止按钮。agent 运行中时显示，点击调 `abortRegistry.abort(sessionId)`。样式与主会话一致。
- Step 18 — phase-2-verify — blocking: yes — qa: auto：mobile tsc + build:webview + jest 全绿。

### Phase 3 — Desktop 四能力拆分

- Step 19 — phase-3-desktop-abort — blocking: yes — qa: auto：`useAgentRunLifecycle` 提取为 abort 单元（近乎现成，平移）。`ConversationPanel` 的 `abortUiRun` 改为调 core registry（经 IPC `ipcAgentAbort`）。
- Step 20 — phase-3-desktop-stream — blocking: yes — qa: auto：`useAgentStream` 提取为 stream 单元事件源底座。`ConversationPanel` 内联的 streamingText/streamingThinking state + onTextDelta/onThinkingDelta 移入单元。
- Step 21 — phase-3-desktop-batch — blocking: no — qa: auto：新建 batch 单元（`conversation-batch.ts`），renderer 层 buffer 包在 useAgentStream 外层。从零新建（desktop 当前无 batch）。
- Step 22 — phase-3-desktop-panel — blocking: yes — qa: auto：`ConversationPanel` 拆为消费四个单元的薄层。确保主会话行为不变。
- Step 23 — phase-3-desktop-stop — blocking: yes — qa: manual_user：`ChatRail` readOnly 子会话面板加停止按钮（精简 stop bar，调 `ipcAgentAbort`）。
- Step 24 — phase-3-desktop-main — blocking: yes — qa: auto：desktop main 进程（`apps/desktop/src/main/ipc/handlers/agent.ts`）接入 core registry：
  - **(a)** `abortAgentRun(sessionId)` 改为调 `rt.abortRegistry.abort(sessionId)`；`handleAgentAbort` IPC 随之走同一函数（不依赖 activeRuns）。
  - **(b)** `handleAgentRun` 删除内部 `const controller = new AbortController()`、删除 `activeRuns.set(sessionId, { controller, runId: null })`，`runAgentTurn` 调用不再传 `signal`，让 core 自建 internalController 注册到 registry。
  - **(c)** `activeRuns` / `sessionRunIds` 的去留：**保留为 refcount 影子**——仅用于 RUN_STARTED/FINISHED/FAILED 事件与 runId 比对、`finishTrackedRun` 的 `decrementDesktopAgentActive()`。Map 结构从 `{ controller, runId }` 简化为 `{ runId }`，不再存 controller。
  - **(d)** refcount 单一归属：desktop 的 agentActive refcount 只由 `finishTrackedRun` 递减（main 侧）。core 侧 internalController 的 try/finally `unregister` 只做 registry 反注册，**不触碰** refcount，避免 core 反注册 + main finishTrackedRun 双递减。
- Step 25 — phase-3-verify — blocking: yes — qa: auto：desktop build + 测试全绿。

## 测试策略

### 测试用例

- T-R1 — blocking: yes — abort registry 注册/反注册/中断：register 后 `has(sessionId) === true`；abort 后 controller.signal.aborted === true；unregister 后 `has(sessionId) === false`；unregister 带所有权校验（不同 controller 实例不删）
- T-R2 — blocking: yes — runChildAgent 注册 childController 到 registry：子 run 期间 `registry.has(childSessionId) === true`；run 结束后 `=== false`
- T-R3 — blocking: yes — 中断隔离性：register 父 sessionId（parentController）+ 子 sessionId（childController）→ `registry.abort(childSessionId)` → `parentController.signal.aborted === false`、`childController.signal.aborted === true`、`registry.has(parentSessionId) === true`
- T-A1 — blocking: yes — 子 agent 中断回流：子 agent stopReason=cancelled → task 工具返回 stopped=true + failureReason=`SUBAGENT_STOP_REASON_USER`（"用户停止"）+ 末条文本 → tool_result ok=false + meta.subagentSessionId + meta.failureReason。额外覆盖 cancelled 且 lastText 为空时 text 固定为 `[用户停止，无已生成文本]`，不是空字符串
- T-A2 — blocking: yes — buildToolResultBlock 识别 stopped：output.stopped=true → ok=false + content=output.text + meta 带 subagentSessionId + failureReason
- T-A3 — blocking: yes — 正常完成不受影响：stopReason=completed → stopped 字段不出现 → tool_result ok=true（回归测）
- T-A4 — blocking: yes — 父中断级联：父 abort → 所有子 agent childController.abort() → 主 run 标 cancelled、各子 controller 反注册。中断回流的 tool_result 落库语义由 T-A1/T-A2 单元级覆盖（父 runner 检测 `signal.aborted` 后在 `session.append(tool_result)` 之前 break，partial tool_result 不落库，属 abort-retain-partial 既有语义）
- T-A5 — blocking: yes — extractSubagentSessionIdFromOutcome no-op 固化：output.stopped=true 且含 subagentSessionId → 返回该 subagentSessionId（防止后续重构被误删）
- T-M1 — blocking: yes — mobile 主会话行为不变：重构后主会话 stream/abort/batch 行为与重构前一致（回归测）
- T-M2 — blocking: no — mobile 子会话实时体验：子 agent 跑时子会话页流式输出 + batch 合并 + 停止按钮可见
- T-D1 — blocking: yes — desktop 主会话行为不变（回归测）
- T-D2 — blocking: no — desktop 子会话停止按钮：readOnly 面板有停止按钮，点击调 ipcAgentAbort（最终走 `rt.abortRegistry.abort(sessionId)`）

### 测试矩阵

| Step | 覆盖测试 |
|---|---|
| Step 1 | T-R1 |
| Step 3-4 | T-R2, T-R3 |
| Step 7-9 | T-A1, T-A2, T-A3, T-A5 |
| Step 4（级联） | T-A4 |
| Step 15 | T-M1 |
| Step 16-17 | T-M2 |
| Step 22 | T-D1 |
| Step 23 | T-D2 |

## 风险与回滚方案

### 风险

1. **双向依赖 handleStreamReset ↔ abort lifecycle**：当前 `streamResetRef.current = stream.handleStreamReset` 把 stream 的 reset 注入回 lifecycle。拆单元后用显式回调注入，不能让两个单元 mount 时互相 import，否则循环依赖。
2. **agentActivity refcount 三方共改**：lifecycle.beginUiRun 加、stream FINISHED/FAILED 减、composer finally 兜底减。拆单元后 refcount 归属明确到 run 生命周期单元，stream 单元的 FINISHED/FAILED 不再直接 `decrementAgentActive`，改为通知 lifecycle。
3. **`session.message.received` 副作用**：子 run `publishRunLifecycle: true` 后发事件。但子 run `includeCompactionOrchestrator: false`，实际不会触发 compaction。事件总线其他订阅者靠 sessionId 过滤不串。
4. **desktop batch 从零新建**：desktop 当前无 batch，FR-6 是新建不是抽取，工作量单独评估。
5. **registry 生命周期**：run 结束（含异常）必须反注册。childController 的 try/finally 包裹是硬约束。
6. **子会话页打开时 run 已在跑**：子会话页可能错过 RUN_STARTED 事件（run 已开始），导致 acceptRunEvent 永远拒绝。需在子会话页打开时主动检查 agentRunning 状态。

### 回滚

Phase 1（Core）和 Phase 2/3（UI）可独立回滚。Core 侧按 commit revert 即可恢复旧的 fallback 文案路径；UI 侧回退到手搓的 SubagentSessionScreen。abortRegistry 是可选字段，移除后 runAgentTurn/runChildAgent 空安全降级。
