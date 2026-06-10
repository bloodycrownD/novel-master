# Mobile WebView Agent 流式卡顿与工具 loading 假死

> **类型**：性能 / UI 状态 Bug（已修复，2026-06）  
> **平台**：Android Mobile（`chatTranscriptEngine = webview`）  
> **分支**：`fix/chat-rollback-vfs-tool-fixes`  
> **关联迭代**：`chat-tool-turn-phase-ui`、`chat-rollback-vfs-tool-fixes`、`mobile-llm-streaming`、`mobile-chat-stability-fixes`  
> **调试会话**：`debug-ef0802`（`.cursor/debug-ef0802.log`）

## 现象

多轮 Agent tool 流式场景（如智谱 GLM-4.7、「write a file three times」）下出现：

1. **生成中卡死**：流式计时器停住、停止按钮无响应、界面长时间静止；控制台常见「最后一条 `xhr first chunk` 无 `xhr complete`」。
2. **工具一直 loading**：多个 assistant 气泡仍显示「正在执行工具调用…」，即使正文已流完或工具早已执行完毕。
3. **Agent 未退出「生成中」**：顶部 metrics 条持续显示 `running`，直至进程被杀或长时间等待。

易与 **网络挂死**、**maxSteps 截断**、**message checkpoint 阻塞** 混淆；实测多数情况下 **JS 主线程仍存活**（心跳定时器正常），属于 **UI 管道反压 + 状态未刷新** 的复合问题。

## 根因（经运行时日志确认）

### 1. 主因：流式 delta 驱动过重 UI 管线（有效反压不足）

每条 SSE token 大致走：

```
XHR onprogress → onChunk → EventBus
  → setStreamingText / setStreamingThinking（ChatTabScreen 整页重渲染）
  → ChatTranscriptWebView props 变化 → useEffect → postMessage
  → WebView DOM 更新
```

多轮 tool 时叠加：

- 每步 `reloadMessages`（SQLite，约 100–340ms）+ **全量** `sessionSnapshot` → WebView `list.innerHTML = …` 重建；
- 流式期间若做 **rich HTML / markdown-it**（`prepareStreamTailHtml`、`enrichTranscriptRows`）；
- `useAgentStreamMetrics` 曾 **per-delta `setTick`**，放大父组件重渲染。

**本质**：生产速率（SSE token）> 消费速率（主线程 UI 工作），且中间缺少足够合并——不是 SSE 协议本身故障。

日志特征（修复前）：

- 大量 `imperative-stream-flush` / `flush-rate` 仍救不回 `setStreamingText` 路径；
- `onChunk-slow` / `appendStreamDelta-slow` 偶发；
- 末轮常见 **无 `xhr-complete`**，但 **H-Z 心跳仍跳** → 更像 await 中 + UI 不更新，而非进程死锁。

### 2. 次因（回归）：`appendTailRows` 未刷新 `toolPhase`

为减轻全量 `renderRows`，agent 运行中每步只对 **新增消息** 做 `appendTailRows`。

但 `toolPhase: 'executing'`（「正在执行工具调用…」）打在 **之前的 assistant 行** 上；`tool_result` 落库后，这些行 **不会** 被增量逻辑更新。

表现：正文已写完 + 多个 executing 条 + `agentRunning === true`（若 `RUN_FINISHED` 尚未到达）。

**引入时机**：本次流式性能优化迭代中为减 snapshot 成本而加，缺少「tool_results 阶段必须刷新旧行」的约束。

### 3. 已排除或次要因素

| 假设 | 结论 |
|------|------|
| `maxSteps = 5` | **不导致卡死**；到上限应 `stopReason: max_steps` 并 `RUN_FINISHED`。修复后日志多次 `stepsExecuted: 4/5` 且 `completed`。步数过少可能导致 **任务提前结束**，不是 UI 冻结。 |
| message checkpoint | 轮间 `txMs` 约 200–300ms；改为 `void capture()` 后不阻塞流式。**非主因**。 |
| SSE / `xhr.responseText` 单点 | 末轮无 `xhr-complete` 常为 **表象**；`responseText` 单次读取未超 16ms（H-T）。长响应体积仍是长期风险点。 |
| Chrome DevTools 附加 | **放大**卡顿，非根因。 |
| EventBus 同步慢 | H-B 无超标日志。 |

## 修复摘要

| 层级 | 措施 |
|------|------|
| **消费端合并** | Bus 32ms 合并；WebView rAF 合并 `streamDelta` |
| **绕过 React 流式 state** | WebView 路径：`transcriptWebRef.pushStreamDelta()`，不再 `setStreamingText` |
| **流式期不做重 CPU 渲染** | 流式 tail 仅纯文本；rich HTML 在 persist / snapshot 后 |
| **SSE 生产端** | Core `postSseViaXhr`：32ms `setInterval` 整流（每 tick 最多一次 `onChunk`）；`onload` 同步 flush 尾部 |
| **增量 + 全量搭配** | assistant 新消息 → `appendTailRows`；**`tool_results` 落库 → `sessionSnapshot('preserve')`**，刷新 `toolPhase` / 工具卡 |
| **流式期推迟 snapshot** | `streamActiveRef` 为 true 时不发 snapshot，待 `streamReset` 后 flush |
| **reload 去重** | 并发 `reloadMessages(true)` 合并为单次 in-flight |
| **checkpoint** | `capture()` fire-and-forget，不 `await` 阻塞 runner |

修复后验证：连续 5 次多轮 tool 运行，日志均为 `run-finished` + `stopReason: completed`，末轮均有 `xhr-complete`。

## 对未来开发的约束（防复发）

### 流式路径「禁止」

1. **禁止** 用 `useState` 承载高频 stream text/thinking 并传入大列表父组件（`ChatTabScreen` 级）。
2. **禁止** 在 `agentRunning` 且 stream 活跃时做 **全量 `sessionSnapshot`**（除非 `tool_results` 等必须刷新旧行的阶段）。
3. **禁止** 在流式中途调用 markdown-it / `prepareTranscriptRichHtml` 处理 tail。
4. **禁止** per-delta 触发 metrics / 父组件 `setState`（用 ref 累积 + 低频 interval）。

### 增量 DOM 时必须

1. 任何 **写在「旧行」上的 transient 状态**（`toolPhase`、pending spinner、选中态）在阶段结束时必须有 **patch 或全量 refresh** 路径。
2. `tool_results` 提交后：要么 `sessionSnapshot`，要么 `messagePatch` 更新对应 assistant 行——**不能只 append user 行**。
3. 新增 WebView bridge 消息类型时，在 `chat-transcript/main.ts` 与 `ChatTranscriptBridge.ts` **同步**注册。

### 性能预算（经验值）

| 指标 | 建议上限 |
|------|----------|
| 流式 UI 更新频率 | ≤ ~30–60 次/秒（bus 32ms + rAF） |
| 单步 `reloadMessages` | 可接受 ~100ms；全量 snapshot 避免与流式重叠 |
| 传输层 `onChunk` 频率 | ≤ ~30 次/秒（32ms tick 整流）；`onload` 同步 flush 尾部 |

### 100 token/s 是否安全？

在 **当前** 合并策略下 **大概率安全**（UI ~30 次/秒更新）。若再出现卡顿，优先查：

- 是否重新引入 React 流式 state；
- `tool_results` 是否漏刷新；
- 会话很长 + richText 开时的 **轮间** snapshot 成本；
- 调试探针（fetch ingest）是否未移除。

## 关键文件

```
apps/mobile/src/screens/tabs/ChatTabScreen.tsx          # bus 合并、imperative stream、reload 去重
apps/mobile/src/components/chat/ChatTranscriptWebView.tsx # streamActive、appendTailRows / snapshot 分支
apps/mobile/src/components/chat/message-blocks.ts       # toolPhase、messageIsToolResultsOnly
apps/mobile/src/web/chat-transcript/main.ts             # appendStreamDelta、appendTailRows、applySnapshot
packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts  # 32ms 整流
packages/core/src/infra/llm-protocol/logic/sse-chunk-emitter.ts  # XHR burst 平滑
packages/core/src/service/agent/impl/agent-runner.ts    # checkpoint 非阻塞、step 生命周期
```

## 与迭代的因果关系

| 迭代 / 变更 | 关系 |
|-------------|------|
| **chat-tool-turn-phase-ui** | 引入 `toolPhase: executing`；与增量渲染不兼容时会「一直 loading」 |
| **WebView transcript 引擎** | 流式 + 每步 snapshot 成本高，暴露反压问题 |
| **chat-rollback-vfs-tool-fixes** | checkpoint、流式优化同分支；checkpoint 非主因 |
| **appendTailRows（性能优化）** | **直接回归**：未在 tool_results 刷新旧行 |

## 回归测试建议

1. Android、WebView 引擎、richText 开/关各 1 次。
2. Prompt：「write a file three times」或等价 3+ 轮 tool。
3. 断言：每步 executing 在 tool_result 后消失；全程无长时间「生成中」挂死；`RUN_FINISHED` 到达。
4. 可选：DevTools **断开** 下测（附加调试器会放大延迟）。

## 调试探针

已于 2026-06 合并前移除：`stream-perf-log.ts`（mobile + core）、所有 `H-*` ingest 日志及 WebView `appendStreamDelta-slow` 上报。
