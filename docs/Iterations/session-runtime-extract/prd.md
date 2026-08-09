---
date: 2026-08-09
dependency:
  - Iterations/agent-subagent/prd.md
  - Iterations/prompt-engine-refactor/prd.md
---

# Session Runtime 抽取（stream / abort / batch / composer 可插拔）PRD

## 背景

主会话和子会话的实时体验不对齐，根因是 mobile 的 session 级运行时能力（流式输出、中断、批处理、消息加载）全部耦合在 `ChatTabProvider` 这个 70+ 字段的巨型 context 里，和 tab 级 UI 状态混在一起。子会话浏览页（`SubagentSessionScreen`）无法复用这套能力，只能手搓一套减配版——没有 batch 双级缓冲、没有 abort、没有 freeze/retain 守卫、没有 runId stale 校验。

Desktop 端稍好——子会话直接复用了主会话的 `ConversationPanel` + `readOnly` 旗标，但 desktop 本身没有 `useChatStreamRuntime`（流式逻辑内联在 `ConversationPanel` 里），也没有做到能力可插拔。

同时，子 agent 的 abort 控制权存在架构缺陷：`runChildAgent` 的 `childController` 是闭包局部变量，没注册到任何 registry。子会话页无法独立中断子 agent——只能等父会话 abort 级联下来。

这次迭代要解决三件事：
1. 把 stream / abort / batch / composer 四个能力拆成独立可插拔单元，session 级与 tab 级分层，主会话和子会话各自按需组合。
2. Core 层提供按 sessionId 中断 in-flight agent run 的能力（含子 agent），使子会话页能独立中断。
3. 中断后子 agent 的末条消息作为 tool_result 回流父 agent，tool 调用标记失败（原因：用户停止）。

## 目标（含成功指标）

1. **四能力可插拔**：stream / abort / batch / composer 拆成独立单元，主会话和子会话各自按需组合，不再有「巨型 context + 平行实现」的双重问题。
2. **子会话独立中断**：子会话页有停止按钮，点击后子 agent 停止，不影响父会话；末条消息回流父 agent 作为 tool_result，tool 调用标记失败。
3. **父会话中断级联**：父会话中断时级联关闭所有子 agent，每个被中断的子 agent 同样回流末条消息 + 失败标记。
4. **两端对齐**：mobile 和 desktop 的子会话浏览页体验一致（流式输出、中断、批处理）。

成功指标：
- mobile 子会话页使用和主会话相同的 stream/abort/batch 单元，无平行实现。
- 子会话页停止按钮可独立中断子 agent，父会话不受影响，tool_result 回流带失败标记。
- 父会话中断时所有活跃子 agent 被级联中断，各自回流失败 tool_result。
- `npm test -w @novel-master/core` + `npm run build` 通过；mobile/desktop 构建通过。

## 用户与场景

- **写作用户在主会话派了子 agent 查大纲**：子 agent 跑偏了，用户不想等它跑完。用户直接在子会话页点停止——子 agent 立刻停，父会话的 task 工具收到失败结果（末条消息 + 「用户停止」原因），主 agent 看到失败后自己决定下一步。
- **用户在主会话点停止**：主 agent 正在跑，同时有两个子 agent 也在跑。用户点主会话停止——主 agent + 两个子 agent 全部停，各自回流末条消息 + 失败标记。
- **开发者在子会话浏览页看子 agent 实时流式输出**：体验和主会话完全一致——逐字输出、batch 合并高频 delta、工具调用时显示生成中。

## 范围

### 包含范围

**Core — abort registry + 中断回流**

- 新增按 sessionId 注册 in-flight agent run 的 AbortController 的 registry（`AgentAbortRegistry` 或等价）。
- `runAgentTurn` / `runChildAgent` 启动时将自己的 AbortController 注册到 registry（按 sessionId），结束时移除。
- 新增「按 sessionId 中断」的能力（`abortAgentRun(sessionId)`），供 UI 调用——既能中断主 run 也能中断子 run。
- 子 agent 被中断后，`task` 工具的 `run` 方法正常返回（不抛异常），返回值为 `{ text: 末条 assistant 文本或 fallback, subagentSessionId, stopped: true }`（或等价的失败标记）。
- tool_result 的 meta 带上 `is_error: true` + 失败原因（`"用户停止"`），使主 agent 能理解这是用户主动中断而非工具崩溃。
- 父 agent 中断时级联 kill 子 agent，每个子 agent 走同样的回流路径。

**Mobile — 四能力可插拔抽取**

- 从 `ChatTabProvider` / `useChatStreamRuntime` / `useAgentRunLifecycle` 中提取四个独立单元：
  - **stream**：事件订阅 + wire queue + apply buffer + stale 守卫（`acceptRunEvent` / `getUiRunning`）。
  - **abort**：abort registry 订阅 + freeze/retain 状态机 + overlay 固化。
  - **batch**：`chatStreamBatchEnabled` 开关 + `pushStreamBatch` / `pushStreamDelta` 双路径。
  - **composer**：输入框状态 + `executeRun` + 草稿管理（作为消费者单元，不抽 hook，仅做 wiring 改造：删外部 controller 创建、改调 core registry）。
- `ChatTabProvider` 重构为消费这些单元的薄层，tab 级 UI 状态（面板切换、drawer、picker）留在原处。
- `SubagentSessionScreen` 重构为消费 stream + abort + batch 单元（不接 composer），删除手搓的平行实现。

**Desktop — 四能力可插拔抽取**

- 从 `ConversationPanel` 中提取与 mobile 对称的四个独立单元（desktop 版本，适配 IPC 架构）。
- desktop 子会话浏览页继续复用 `ConversationPanel` + `readOnly`，但现在底层走的是可插拔单元。
- desktop 的 abort 改为通过 core abort registry（不再仅靠 main 进程的 `activeRuns` Map）。

**UI — 子会话页停止按钮**

- mobile `SubagentSessionScreen`：agent 运行中时显示停止按钮（和主会话一致的样式），点击调 `abortAgentRun(sessionId)`。
- desktop 子会话面板：同上。

### 不包含范围

- **子会话可继续对话**：子会话仍只读浏览，不接 composer、不支持向子 session 发新消息。（composer 作为消费者单元在两端均保留为 dumb component，子会话不装配它。）
- **跨端共享代码库**：mobile 和 desktop 各自抽取自己的可插拔单元，不强行合并到 `packages/` 共享包（两端 IPC 架构差异太大）。
- **legacy RN 引擎对齐**：子会话页只走 WebView 引擎，不支持 legacy RN `MessageList`。主会话的 legacy 引擎支持保留不动。
- **消息分页**：子会话页的消息分页（`hasMore` / `onLoadOlder`）不在本次范围，仍一次性加载全量。

## 核心需求

### FR-1：Core abort registry

Core 层新增按 sessionId 注册 / 查找 / 中断 in-flight agent run 的能力：
- `runAgentTurn` 和 `runChildAgent` 都**永远内部 `new AbortController()`**（`internalController`）按 sessionId 注册到 registry——不管 caller 有没有传 signal。run 结束（正常完成 / 失败 / 中断）时移除。caller 传入的 `signal` 保留为级联触发源，core 做桥接（`callerSignal.addEventListener("abort", () => internalController.abort(callerSignal.reason), { once: true })`）。
- `abortAgentRun(sessionId)` 从 registry 拿到对应 controller 调 `.abort()`。
- 主 run 和子 run 的 sessionId 不同，互不影响——中断子 run 不碰父 run 的 controller。

### FR-2：中断后 tool_result 回流

子 agent 被中断（无论独立中断还是级联中断）后：
- `task` 工具的 `run` 方法正常返回（不抛异常），返回值含末条 assistant 文本（或固定占位文案）+ `subagentSessionId` + `stopped: true`。
- cancelled 分支的 text 取值边界：lastText 为空（LLM 还未输出文本）时固定占位文案 `[用户停止，无已生成文本]`，不吞掉、不用空字符串。
- tool_result 标记为失败（`is_error: true`），失败原因统一用 `subagent-tool.ts` 导出的常量 `SUBAGENT_STOP_REASON_USER = "用户停止"`。
- 主 agent 看到 tool_result 后能区分「用户主动停止」和「工具执行出错」，自行决定下一步。

### FR-3：父中断级联

父 agent 中断时，所有活跃子 agent 被级联中断：
- 每个子 agent 走 FR-2 的回流路径，各自返回失败 tool_result。
- 级联中断后父 agent 继续走自己的 abort 收尾流程。

### FR-4：stream 单元可插拔

- 从现有 `useChatStreamRuntime` 中提取 stream 订阅逻辑为独立单元（hook 或 service）。
- 输入：sessionId、可选的 lifecycle 校验函数（acceptRunEvent / getUiRunning）。
- 输出：streamingText、streamingThinking、reload 触发器、stream reset。
- 主会话和子会话各自实例化，互不干扰。

### FR-5：abort 单元可插拔

- 从现有 `useAgentRunLifecycle` 中提取 abort 状态机为独立单元。
- 输入：sessionId、abort registry 访问。
- 输出：abortUiRun（冻结 + retain）、`getTranscriptFreezeCount()`（getter，不是 state，高频 bus 回调读取零开销）、abortRetainPending、commitAbortOverlay。
- 主会话装配完整版（用户主动中断 + freeze + retain + overlay 固化）；子会话装配相同版本（独立中断 + freeze + retain）。

### FR-6：batch 单元可插拔

- 从现有 `useChatStreamRuntime` 中提取 wire queue + apply buffer 为独立单元。
- 输入：batch 开关、WebView imperative handle ref。
- 输出：pushStreamBatch / pushStreamDelta 入口。
- 主会话和子会话共用同一份 batch 偏好（`chatStreamBatchEnabled`）。

### FR-7：composer 作为消费者单元（不抽 hook）

- composer 在 mobile / desktop 两端均为 dumb component，不抽 hook、不进 session 级层。仅做 wiring 改造：删除 composer 内部的外部 controller 创建（mobile ChatComposer 的 `new AbortController()` + `signal` 参数、desktop `ChatComposer` 的同类逻辑），改为只调 `runAgentTurn` 不传 signal，让 core 自建 internalController 注册到 registry（FR-1）。停止按钮的 `runAbortController?.abort()` 改调 `abortUiRun()`。
- 主会话装配 composer；子会话不装配。

### FR-8：子会话页停止按钮

- mobile `SubagentSessionScreen`：agent 运行中时显示停止按钮，点击调 `abortAgentRun(sessionId)`（FR-1）。
- desktop 子会话面板：同上。
- 中断后子会话页 UI 显示 cancelled 状态（和主会话中断后一致）。

## 验收标准

- **AC-1（子会话独立中断）**：Given 主会话派了一个子 agent 正在跑，When 用户在子会话页点停止，Then 子 agent 立刻停止，父会话不受影响（继续运行或已完成），父会话的 task 工具 tool_result 标记失败（原因：`SUBAGENT_STOP_REASON_USER`），tool_result 含子 agent 末条消息。例外：cancelled 且子 agent 还未生成 text 时，回流 text 固定为 `[用户停止，无已生成文本]` 占位文案（不算空文本）。
- **AC-2（父中断级联）**：Given 主 agent 正在跑且有两个子 agent 并行运行，When 用户在主会话点停止，Then 主 agent 和两个子 agent 全部停止，每个子 agent 各自回流失败 tool_result（含末条消息 + `SUBAGENT_STOP_REASON_USER`），主 agent 的 abort 收尾流程正常。父子同时 abort 的竞态场景依赖 `AbortController.abort()` 的幂等性 + parentSignal listener 的 `{ once: true }`，不产生重复回调。
- **AC-3（流式体验对齐）**：Given 子 agent 正在跑且用户在子会话浏览页，Then 子会话页的流式输出（逐字、batch 合并、生成中样式）和主会话完全一致，无平行实现。
- **AC-4（四能力可插拔）**：Given 重构后的代码结构，stream / abort / batch / composer 是四个独立单元，主会话和子会话各自按需组合，无巨型 context 平铺。composer 作为消费者单元不抽 hook。
- **AC-5（两端对齐）**：mobile 和 desktop 的子会话浏览页体验一致（流式、中断、批处理）。
- **AC-6（无平行实现）**：mobile `SubagentSessionScreen` 不再自己手搓事件订阅 / state 管理，消费共享的可插拔单元。子会话页打开时若 run 已在跑，主动查 `abortRegistry.has(sessionId)` 合成 `onRunStarted` 初始化 activeRunId。
- **AC-7（测试通过）**：`npm test -w @novel-master/core` 通过（含 abort registry 单测 + 中断隔离单测 T-R3 + 中断回流单测）；`npm run build -w @novel-master/core` 通过；mobile `npm run build:webview` + jest 全绿；desktop `npm run build -w @novel-master/desktop` 全绿。

## 约束与依赖

- 依赖 agent-subagent（已实现）、prompt-engine-refactor（已实现）。
- Core 层 abort registry 是 FR-2~FR-3/FR-5/FR-8 的前置——UI 层的独立中断能力依赖 Core 先开口子。
- mobile 和 desktop 各自抽取，不强行跨端共享代码（IPC 架构差异）。
- 不改子会话的「只读」定位（不接 composer、不支持发消息）。
- 不引入 legacy RN 引擎到子会话页。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| abort registry 的生命周期 | run 结束时必须移除注册，否则 sessionId 复用会误中断新 run。需确认 sessionId 是否会被复用（当前是 UUID，不复用）。 |
| 中断回流的消息内容 | 子 agent 被中断时可能正在 LLM 请求中途，末条 assistant 消息可能是半成品。回流时取半成品还是丢弃？倾向取半成品（和 abort-retain-partial 语义一致）。 |
| `session.message.received` 副作用 | 子 run `publishRunLifecycle: true` 后会发事件，其中 `session.message.received` 可能触发 compaction orchestrator（子 run `includeCompactionOrchestrator: false`）。需确认是否需要门控。 |
| desktop 抽取工作量 | desktop 没有 `useChatStreamRuntime`，流式逻辑内联在 `ConversationPanel`，抽取工作量可能显著大于 mobile。 |
| 父子同时 abort 的竞态 | 用户在子会话点停止的同时，父会话也在 abort——两个 abort 路径都依赖 `AbortController.abort()`，该 API 幂等且并发安全；childController 的 `{ once: true }` 监听保证 parentSignal 只 fire 一次；registry 侧 `abort(childSessionId)` 与父级联产生的 childController.abort 先后到达结果一致。 |
