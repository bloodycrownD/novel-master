---
zone: xc-proto
agent: 横切代理（W3 主题机位）——LLM 协议/传输兼容面族
files_scanned:
  - packages/core/src/infra/llm-protocol/ports/adapter.port.ts
  - packages/core/src/infra/llm-protocol/impl/openai.adapter.ts
  - packages/core/src/infra/llm-protocol/impl/anthropic.adapter.ts
  - packages/core/src/infra/llm-protocol/impl/gemini.adapter.ts
  - packages/core/src/infra/llm-protocol/logic/openai-sse-parser.ts
  - packages/core/src/infra/llm-protocol/logic/anthropic-sse-parser.ts
  - packages/core/src/infra/llm-protocol/logic/gemini-sse-parser.ts
  - packages/core/src/infra/llm-protocol/logic/sse-line-buffer.ts
  - packages/core/src/infra/llm-protocol/logic/sse-parse-errors.ts
  - packages/core/src/infra/llm-protocol/logic/sse-chunk-emitter.ts
  - packages/core/src/infra/llm-protocol/logic/dispatch-sse-chunk.ts
  - packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts
  - packages/core/src/infra/llm-protocol/logic/request-abort.ts
  - packages/core/src/infra/llm-protocol/logic/llm-stream-timeout-error.ts
  - packages/core/src/infra/llm-protocol/logic/stream-partial-blocks.ts
  - packages/core/src/infra/llm-protocol/logic/stream-watchdog.ts
  - packages/core/src/infra/llm-protocol/logic/openai-content-mapper.ts
  - packages/core/src/infra/llm-protocol/logic/http-util.ts
  - packages/core/src/service/provider/impl/model-request.service.ts
  - packages/core/src/service/agent/impl/agent-runner.ts
  - packages/core/src/service/agent/logic/run-agent-turn.ts
  - packages/core/src/service/agent/create-agent-stream-registry.ts
  - packages/llm-sse-native/src/transport.ts
  - packages/llm-sse-native/src/types.ts
  - packages/core/src/public/provider.ts
  - apps/mobile/src/web/tsconfig.json
  - apps/mobile/scripts/build-webview.mjs
  - apps/mobile/src/web/chat-transcript/stream/block-split.ts
  - apps/mobile/src/web/rich-document/webview/runtime/annotate-collect.ts
  - apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts
  - apps/mobile/__tests__/chat-transcript-stream-block.test.ts
  - apps/mobile/android/build.gradle
  - apps/mobile/src/services/session-stream-unit.ts
  - apps/mobile/src/services/session-stream-unit-manager.service.ts
  - apps/desktop/renderer/hooks/useAgentStream.ts
  - apps/mobile/src/services/agent-run.service.ts
---

## 摘要

这一族是「LLM 协议解析 + HTTP/SSE 传输 + 重试策略」的完整栈：三个协议 adapter（openai/anthropic/gemini）
各带一个增量 SSE parser，统一走 `llm-sse-transport` 的三分支传输（registered native → RN XHR → fetch），
上层由 `model-request.service` 施加重试策略，再由 `agent-runner` 把流事件分派到 eventBus，
最终在 mobile 的 `session-stream-unit` / desktop 的 `useAgentStream` 里累积成用户可见的正文。
本次横切沿「解析兼容面 → 传输资源面 → 事件契约面 → 重试/重复面」四条链走完，并对 ⑤ 号疑点做了实跑裁定。

## 职责与边界

- **协议解析**（`*-sse-parser.ts`）：把 UTF-8 增量 chunk 变成 `LlmStreamEvent` + `ContentBlock[]`。
  帧边界统一由 `sse-line-buffer.feedSseLines` 按 `\n` 切行，三 parser 各自认 `data: ` 前缀。
- **传输**（`llm-sse-transport.postSse`）：只搬字节不认协议，负责 2xx/非 2xx 分流、整调用预算
  （`SSE_WHOLE_CALL_TIMEOUT_MS = 600_000`，按「0 字节 / 有输出」分 first-chunk / idle 两级）、settle 守卫。
- **native 桥**（`packages/llm-sse-native`）：把 `SseTransport` port 落到 Kotlin OkHttp，按 requestId 路由事件。
- **重试**（`model-request.service.isRetryableError`）：决定这次失败要不要原样重发同一个请求。
- **呈现**（agent-runner → eventBus → 双端累积器）：`EVENT_AGENT_STREAM_TEXT_DELTA` 只增不换，
  step 边界靠 `streamRegistry.reset` / `handleStepCommitted` 清。

不在本族范围：prompt 组装、tool 执行、消息落库、渲染（markdown/代码块）。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `LlmProtocolAdapter` / `LlmStreamEvent` | `infra/llm-protocol/ports/adapter.port.ts:106` / `:27` | 协议 port；`tool-use` 事件契约注释在 `:31-36` |
| `postSse(url, init, onChunk, providerId, options)` | `logic/llm-sse-transport.ts:264` | 三分支 SSE 传输 |
| `registerSseTransport` | `logic/llm-sse-transport.ts:109` | app 装配层注册 native 传输 |
| `SseTransport.post` | `llm-sse-native/src/types.ts`（port 形状在 core `:85`） | core 鸭子类型，不 import 原生包 |
| `LlmStreamTimeoutError(phase)` | `logic/llm-stream-timeout-error.ts:30` | `first-chunk` 可重试 / `idle` 不可重试 |
| `ModelRequestService.request` | `service/provider/impl/model-request.service.ts:150` | 带重试的 LLM 调用唯一入口 |
| `AgentStreamRegistry.{register,append,reset,get}` | `service/agent/create-agent-stream-registry.ts:23` | 流式累积（供子会话页重进补齐） |
| `STREAM_IDLE_TIMEOUT_MS` | `infra/llm-protocol/logic/stream-watchdog.ts:22` → `public/provider.ts:133` | **已退役原语**，仍从 public 入口导出（allowlist 冻结面） |

## 数据访问

本族不直接触碰表 / KKV，只经由事件与消息通道：

- 落库出口仅一处：`agent-runner.ts:690` `session.append("assistant", { blocks: result.blocks }, …)`
  ——即**只有最后一次成功 attempt 的 blocks 会落库**，重试产生的重复正文不进库（见 F-xc-proto-01）。
- mobile 侧流式快照会被写穿到持久层：`apps/mobile/src/services/session-stream-unit-manager.service.ts:1657`
  `writethrough.append(runStateRowFromSnapshot(...))`，其中 `partialText: snap.partialText`
  （`:1677`）会把累积中的正文（含重复段）写进 run_state 行。
- 读侧：`streamRegistry.get()` 目前**无生产调用方**（`create-agent-stream-registry.ts:20` 自述），
  实际正文渲染走 eventBus，不走 registry。

## 依赖关系

```
agent-runner.run
  └─ modelRequests.request  (model-request.service)   ← 重试策略在此
       └─ adapter.chat  (openai/anthropic/gemini)
            └─ postSse  (llm-sse-transport)
                 ├─ native → packages/llm-sse-native transport → Kotlin OkHttp
                 ├─ xhr    → createSseChunkEmitter (32ms 整流)
                 └─ fetch  → ReadableStream + TextDecoder
            └─ feed*SseChunk → sse-line-buffer → *-sse-parser → LlmStreamEvent
  └─ wrapStreamForBus → SimpleEventBus
       ├─ streamRegistry.append (累积)
       └─ EVENT_AGENT_STREAM_TEXT_DELTA / _THINKING_DELTA / _TOOL_USE / _USAGE
            ├─ mobile: session-stream-unit-manager → session-stream-unit.ingestDelta → partialText
            └─ desktop: useAgentStream → applyTextDelta
```

被谁消费：三个 adapter 只被 `registry.ts` / `DefaultModelRequestService` 用；`postSse` 只被三个 adapter 用；
`wrapStreamForBus` 只被 `agent-runner` 用。

## 发现清单

### F-xc-proto-01 | P1 | model-request.service.ts:226 / agent-runner.ts:724 | **流中断被当可重试 ⇒ 用户真会看到重复正文（已实跑复现）**

引文（`packages/core/src/service/provider/impl/model-request.service.ts`）：

```ts
// :226   —— 同一个 onStream 被原样带进每一次 attempt
          onStream: options?.onStream,
// :81    —— 任何非 ProviderError 一律当"瞬时故障"重试
  if (!(error instanceof ProviderError)) {
    // Unknown transport/runtime failures are treated as transient once.
    return true;
  }
```

**实跑证据**（临时探针置于 gitignored `packages/core/tmp/`，跑完已删；复现步骤见文末附录）：
用 `OpenAiProtocolAdapter` + 假 `fetch`（第 1 次 attempt 经 `ReadableStream.pull` 先投 2 个 delta 再
`controller.error(new TypeError("terminated"))`，模拟服务端半途断连；第 2 次正常完成），
经 `DefaultModelRequestService` 走真实重试循环，观测两个**用户可见累积面**：

```
# [probe] fetch calls = 2
# [probe] result.assistantText = 前半段。被掐断了，这是重试后的完整回答。          ← 落库的，正确
# [probe] streamRegistry partial = "前半段。被掐断了，前半段。被掐断了，这是重试后的完整回答。"
# [probe] bus text-delta concat  = "前半段。被掐断了，前半段。被掐断了，这是重试后的完整回答。"
# [probe] control partial = "你好。"                                             ← 无失败对照组，不重复
```

**裁定：用户会真看到重复正文。** 理由链：

1. `postSse` fetch 分支把 `reader.read()` 的中途异常原样 `rejectOnce(error)`
   （`logic/llm-sse-transport.ts:673-682`），`TypeError` 不是 `ProviderError`；
2. adapter 的 `chatStream` 只在 `isRequestAborted` 时吞错，否则 rethrow
   （`impl/openai.adapter.ts:224-228`），错误直达重试循环；
3. `isRetryableError` 的 `!(error instanceof ProviderError) → true` 把这个「已吐了半个字」的失败
   判成可重试（`maxRetries` 默认 2，见 `:52-57`）；
4. 第二次 attempt 复用同一个 `onStream` → `wrapStreamForBus` 再次
   `bus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, …)`（`agent-runner.ts:1062-1068`）、
   `streamRegistry.append` 又追加一遍（`:1061`）；
5. 双端累积器都是**只增不换**：`session-stream-unit.ingestDelta` 直接
   `appendWireChunk(this.ingressQueue, {kind, delta})`（`apps/mobile/src/services/session-stream-unit.ts:1119`），
   desktop `applyTextDelta(p.text)` 同理（`apps/desktop/renderer/hooks/useAgentStream.ts:176`）。
   两者唯一的清零点都在 **step 边界**（mobile `handleStepCommitted:763-764`、
   core `streamRegistry.reset` `agent-runner.ts:724`），而重试发生在 step 内部。

**同一缺陷的其它触发面**（都会带「已输出部分」进重试）：

| 触发 | 错误形态 | 判据 | 位置 |
|---|---|---|---|
| Desktop/CLI fetch 流中途断连 | `TypeError: terminated` | 非 ProviderError → true | `llm-sse-transport.ts:679` |
| RN XHR 流中途 `onerror` | `ProviderError("XHR network error")` | 无 `HTTP nnn` → `status == null → true` | `llm-sse-transport.ts:568-573` + `model-request.service.ts:99-101` |
| **mobile native 主路径** `NativeSseTransportError{kind:"network"}` | 普通 Error | 非 ProviderError → true | `llm-sse-native/src/transport.ts:225-235` + `llm-sse-transport.ts:449-451` |

即 mobile 主力（native）与 Desktop（fetch）两条主路径都在暴露面上。

**已被正确处理、不在缺陷面的**（不要重复报）：`LlmStreamTimeoutError` 的 `idle` 相明确不重试
（`model-request.service.ts:78-80` + `llm-stream-timeout-error.ts:12-14` 的设计注释），
abort 形态也已被三道判据挡住（`isAbortLikeError` / `HTTP_ERROR`+`abort` / `delayWithSignal`）。
W2 两机位撞的正是这条设计口径，**它们没错，漏的是「非超时的中途失败」这一类**。

**建议修复口径**（三选一，推荐 A）：

- **A（推荐，最小面）**：在 `model-request.service` 的重试判定里引入「本次 attempt 是否已产出」的信号。
  给 `ModelRequestOptions.onStream` 包一层 attempt 级探针（收到任意 `text-delta`/`thinking-delta`/`tool-use`
  即置 `emitted = true`），重试前若 `emitted === true` 则不重试，直接上抛走既有失败收尾链
  （`[生成失败]` 占位 + `EVENT_AGENT_RUN_FAILED`）。语义与 `LlmStreamTimeoutError.idle` 完全对齐，
  用户口径统一为「流断了就失败，不偷偷重发」。**同时它天然解决重复计费**（同一 prompt 打两次）。
- **B**：在 `agent-runner` 每 step 起一个 attempt 计数器，retry 时向 eventBus 发一个
  `reset-stream` 类控制消息让双端清 partial。改动面更大（要动 port + 双端协议），但保留了
  「网络抖动自动恢复」的产品价值。**注意**：LLM 采样不可复现，attempt2 的正文与 attempt1 不一定相同，
  拼接后的正文是「两段不同回答」，观感比重复更糟。
- **C**：传输层把中途失败统一包成 `LlmStreamTimeoutError("idle", …)`。只解决 A 的一个子集
  （XHR/native 的 network 错误），fetch 的 `TypeError` 仍漏；不推荐单独做。

无论选哪个，都应在 `packages/core/test/provider/model-request-retry.test.ts` 补一条
「attempt1 产出后失败 → 断言 onStream 未被二次驱动 / 不重试」的回归用例（现有 6 条用例全部
只覆盖「无输出失败」，`model-request-retry.test.ts:68-166 / 175 / 201 / 229 / 257`）。

置信：**confirmed（实跑）**

---

### F-xc-proto-02 | P1 | openai-sse-parser.ts:70 / anthropic-sse-parser.ts:206 / gemini-sse-parser.ts:199 | `data: ` 硬编码带空格，非规范形态静默丢整条流

三 parser 同一行模式：

```ts
  if (!line.startsWith("data: ")) {   // openai:70 / anthropic:206 / gemini:199
    return;
  }
  const payload = line.slice(6).trim();
```

**规范事实**：SSE（WHATWG HTML Living Standard，"Interpreting an event stream"）规定字段行是
`field-name ":" [space] value`，**空格是可选的**，解析器应「去掉冒号后至多一个 U+0020」。
`data:{...}`（无空格）是完全合法的 wire 形态，多见于 Go 网关 / 部分中转站的转发实现与
`curl -N` 手工重放。

**实跑证据**（三 parser 各跑 5 种 wire 形态，探针跑完已删）：

```
[sse/openai]    canonical        text="A" malformed=0
[sse/openai]    data-no-space    text=""  malformed=0   ← 静默丢弃
[sse/openai]    crlf             text="A" malformed=0   ← 兼容（slice(6).trim() 吃掉 \r）
[sse/openai]    bom              text=""  malformed=0   ← 静默丢弃
[sse/openai]    event-line       text="A" malformed=0   ← 兼容（event: 行走 startsWith 早退）
[sse/openai]    two-spaces       text="A" malformed=0   ← 兼容（trim 吃掉多空格）
[sse/anthropic] data-no-space    text=""  malformed=0   ← 同上
[sse/gemini]    data-no-space    text=""  malformed=0   ← 同上
```

**为什么是 P1 而不是 P3**：`data:` 无空格时**每一行都被 `startsWith` 早退**，
`recordMalformedSseLine` 一次都不进（`malformed=0`），于是
`assertSseParseSucceededOrThrow(state, blocks, kind)`（`sse-parse-errors.ts:39-48`，
判据是 `blocks.length === 0 && malformedLineCount > 0`）**不抛错**。
结果是：整轮生成对用户表现为「秒回一条空消息」——`agent-runner` 的 B-2 占位分支
（`agent-runner.ts:743-748`）落一条「（本次生成无内容输出）」，run 以 `completed` 收尾。
无错误、无日志、无重试、无诊断计数。BOM 前缀同理（某些代理会加 UTF-8 BOM）。

**建议**：
1. 把三处 `startsWith("data: ")` 换成规范读法——`/^data:[ ]?/` 或
   `line.startsWith("data:")` 后再 `slice(5).replace(/^ /, "")`（**只去一个空格**，
   保留 payload 内前导空格语义）；`line.slice(6)` 的偏移要跟着改。
   建议在 `sse-line-buffer.ts` 旁新增一个共享的 `parseSseDataLine(line): string | null`，
   三 parser 共用（当前 `:70 / :206 / :199` 是三份同款复制）。
2. 在 `feedSseLines` 的行回调里**剥掉首块 chunk 的 UTF-8 BOM**（只在 `buffer` 为空且 chunk 以 `\uFEFF` 开头时）。
3. 补一条诊断：把「非空行但既不是 `data:` 也不是已知字段（`event:`/`id:`/`retry:`/注释行 `:`）的
   跳过」计入 `malformedLineCount` 或新增 `unrecognizedLineCount`，让
   `assertSseParseSucceededOrThrow` 在「整流零内容 + 有无法识别的行」时抛 `MALFORMED_SSE`
   （现有诊断只覆盖 JSON 解析失败，形态不匹配是盲区）。
4. 测试口径：`packages/core/test/infra/llm-protocol/{openai,anthropic,gemini}-sse-parser.test.ts`
   各补 `data:`（无空格）、CRLF、BOM 三组用例。

CRLF 已被 `slice(6).trim()` 兼容，**不是缺陷**，记录在此只为免得 W5 重复排查。

置信：**confirmed（实跑）**

---

### F-xc-proto-03 | P2 | llm-sse-transport.ts:399 / :513 / :611 | abort 监听器三处泄漏（`once:true` 只在 abort 触发时自摘）

三处同一模式（native / xhr / fetch 分支各一）：

```ts
      signal.addEventListener(
        "abort",
        () => { controller.abort(); },   // native:401 / fetch:613
        { once: true }
      );
```

`{ once: true }` 只保证「触发一次后自摘」，**不保证「settle 后自摘」**。`postSse` 的
`resolveOnce` / `rejectOnce`（`:312-327`）只清 `wholeCallTimer`，**没有任何 removeEventListener**。
三个分支的闭包各自把 `controller`（native/fetch）或 `xhr` + `emitter` + `dispatchState`（xhr）
钉在调用方的 signal 上，直到该 signal 被 GC。

**实跑证据**（对 `addEventListener`/`removeEventListener` 打桩，5 次成功请求后）：

```
[abort] added=5 removed=0 leaked=5
```

**同仓已有正确写法作为修复先例**（两处）：
- `packages/llm-sse-native/src/transport.ts:168-178` 的 `finish()` 里
  `signal.removeEventListener("abort", onAbort)`；
- `model-request.service.ts:119-144` 的 `delayWithSignal` 在 timer 回调里
  `signal?.removeEventListener("abort", onAbort)`。

**严重度定 P2 而非 P1 的依据**：生产里 `signal` 是 `runAgentTurn` 入口自建的
`internalController.signal`（`run-agent-turn.ts:329`），随 run 生命周期消亡，
泄漏量被「单 run 内的请求数」封顶（每 step 1 次 + 每次重试 1 次 + 每个子 agent 若干次）。
但边界不是零：一次 30 步 + 多子 agent 的大 run 可以累积数百个 listener，
每个都持有一份 `AbortController` / XHR / emitter 闭包；且 mobile 是常驻进程，
同一会话反复重开会持续叠加。**同一模式在 `run-agent-turn.ts:335`（callerSignal）与
`:1091`（parentSignal → childController）也各有一份**，后者的 parentSignal 是父 run 的
长命 signal，一次父 run 内每次 `task` 工具派发都加一个。

**建议**：
1. `postSse` 内把 abort 转发抽成一个具名 handler，在 `resolveOnce` / `rejectOnce` /
   `handleWholeCallTimeout` 三处统一 `signal.removeEventListener("abort", forwardAbort)`。
2. `run-agent-turn.ts:335` / `:1091` 同样在 finally 里摘除（目前两处都是 `once:true` 无摘除）。
3. 补一条回归：对同一 signal 连发 N 次 `postSse` 全部成功后，断言
   `signal` 上 listener 数为 0（可参考我用的打桩法）。

置信：**confirmed（实跑）**

---

### F-xc-proto-04 | P2 | stream-partial-blocks.ts:49 / anthropic-sse-parser.ts:414 / gemini-sse-parser.ts:391 | anthropic/gemini partial 路径 tool_use 双 emit，违反 port 契约

**契约原文**（`infra/llm-protocol/ports/adapter.port.ts:31-36`）：

```
   * 流式对话中，当某次 tool call 的 input 对象已完整且 JSON 解析成功时 emit，
   * 每种协议每个 tool call 至多一次。
```

**openai 是对的**（`logic/openai-content-mapper.ts:494-502`，partial 路径复用
`state.emittedToolIndices` 去重）：

```ts
    if (!state.emittedToolIndices.has(index)) {
      state.emittedToolIndices.add(index);
      onStream?.({ type: "tool-use", id: acc.id, name: acc.name, input });
    }
```

**anthropic / gemini 漏了**：`buildStreamPartialBlocks` 无条件 emit
（`stream-partial-blocks.ts:42-55`），而两个 partial finish 都把「已 emit 过」的 toolUse
重新喂进它——anthropic 从 `state.blocks` 里过滤（`anthropic-sse-parser.ts:404-409`），
gemini 从 `functionCallsToToolUses` 重新物化（`gemini-sse-parser.ts:390`），
两者都没有像 openai 那样带 emitted-key 集合。

**实跑证据**：

```
[tool-use/anthropic] after feed : tool-use,text-delta
[tool-use/anthropic] after finish: tool-use,text-delta,tool-use      ← emit count = 2
[tool-use/gemini]    after feed : tool-use,text-delta
[tool-use/gemini]    after finish: tool-use,text-delta,tool-use      ← emit count = 2
```

**当前影响：潜伏。** `EVENT_AGENT_STREAM_TOOL_USE` 目前唯一的消费方 desktop
`useAgentStream.ts:211-217` 收了直接 `return`（空实现），mobile 的 manager 根本没订阅该事件
（`session-stream-unit-manager.service.ts:415-465` 只订 TEXT/THINKING/STEP_COMMITTED/USAGE）。
所以今天不产生用户可见故障——但这是一颗**已上膛的枪**：任何一端接上 tool_use 事件的渲染
（工具调用卡片实时点亮本来就是 roadmap 上的形态）都会立刻变成「同一工具闪两次」。

**建议**：照抄 openai 的形态。给 `AnthropicSseParserState` 加
`emittedToolUseIds: Set<string>`（在 `flushActiveBlock` 的 tool_use 分支写），
给 `buildStreamPartialBlocks` 加一个可选 `emittedKeys?: Set<string>` 参数
（与 gemini 侧 `emitToolUsesFromAccumulators` 已有的 `emittedKeys` 形参同款），
两个 partial finish 传入各自集合。同时把 `buildStreamPartialBlocks` 的无条件 emit
收进 `if (emittedKeys == null || !emittedKeys.has(tu.id))` 守卫（保持 openai 现有语义不变）。

置信：**confirmed（实跑）**

---

### F-xc-proto-05 | P3 | anthropic-sse-parser.ts:414-425 / gemini-sse-parser.ts:391-405 | partial 路径的次生信息丢失（thinkingSignature / degradedToolCalls / 块序）

与 F-xc-proto-04 同源、但可独立修的三处：

1. **thinkingSignature 被丢**：`buildStreamPartialBlocks` 只吐 `{type:"thinking", text}`
   （`stream-partial-blocks.ts:37`），不带 `thinkingSignature`。而 `flushActiveBlock` 的正常路径
   是带 signature 的（`anthropic-sse-parser.ts:114-118`）。用户中断一轮带 thinking 的 Anthropic
   对话后，落库的 thinking 块没有 signature，下一轮把这段历史回喂给 Anthropic 时会被 API 拒绝
   （Anthropic 要求 thinking 块必须带 signature）。
2. **degradedToolCalls 被硬编码成 `[]`**：`anthropic-sse-parser.ts:425` 与
   `gemini-sse-parser.ts:405` 都是 `degradedToolCalls: []`，而 `flushActiveBlock` 明明已经
   往 `state.degradedToolCalls` 里收了 `INVALID_TOOL_ARGUMENTS` 记录
   （`anthropic-sse-parser.ts:142-148`）。中断恰好落在「arguments JSON 损坏」的 tool call 上时，
   `rawArguments` 全丢，`tool_result` 里没有任何可诊断信息。
3. **块序被重排**（anthropic）：partial 路径按 `[thinking, text, ...toolUses, ...other]` 重建
   （`anthropic-sse-parser.ts:391-418`），与原始交错顺序脱钩。实跑里 stream 是
   `[tool_use, text]` 而 partial blocks 变成 `[text, tool_use]`。常见形态（text 先、tool_use 后）
   下无感，属低危。

**建议**：把 `buildStreamPartialBlocks` 的 thinking 分支补 `thinkingSignature` 透传；
两个 partial finish 改为 `degradedToolCalls: state.degradedToolCalls`（gemini 侧对应
`functionCallsToToolUses(state, /*strict*/ true)` 的结果）；块序若要保真，改成从
`state.blocks` 顺序过滤而非重排。

置信：**confirmed（实跑 + 读码）**

---

### F-xc-proto-06 | P2 | apps/mobile/src/web/tsconfig.json:7 + `packages/llm-sse-native/src/transport.ts:225` | es2018 纪律的 TS 侧是装饰性的；native 路径绕过 HTTP 状态码分类

**(a) `lib: ["ES2018","DOM"]` 拦不住任何东西（@types 放空）**
`apps/mobile/src/web/tsconfig.json:7` 声明 `"lib": ["ES2018", "DOM"]`，注释与
`docs/apm/RULE.md:73`（webview JS 零 lookbehind，es2018 target 不转译正则）都把它当纪律闸门。
但该 tsconfig **没有设 `"types": []`**，TS 于是自动注入 `node_modules/@types` 下的全部包，
`@types/node` 的全局增强把 ES2019+ 内建方法全补齐了。

**实跑证据**：往 `apps/mobile/src/web/shared/`（在 include 内）丢一个探针文件，
用到 `replaceAll`(ES2021) / `Object.hasOwn`(ES2022) / `Promise.any`(ES2021) / `flatMap`(ES2019)
/ lookbehind 正则，`npx tsc --noEmit -p src/web/tsconfig.json` **零报错**（探针已删）。
同一次运行的其它报错只有 3 条 `@novel-master/core/*` 找不到 dist 的既有噪声。

后果：纪律从「typecheck 拦得住」退化为「靠人自觉 + 一条 4 文件的字符串断言测试」。

现状盘点（web 层实际用到的越界项，全部 ≤3 处）：

| 位置 | 用法 | 需要的运行时 |
|---|---|---|
| `apps/mobile/src/web/rich-document/webview/runtime/annotate-collect.ts:132-133` | `trimStart()` / `trimEnd()` | ES2019（Chrome 66+） |
| `apps/mobile/src/web/chat-transcript/stream/block-split.ts:42` | `trimStart()` | 同上 |

`(?<` / `\p{` / dotAll 在 web 层**零出现**（只有 `RefTokenText.tsx:12,15` 的注释里提到
「不能用 lookbehind」），所以纪律的**核心目标目前是守住的**。
风险面在 `minSdkVersion = 26`（`apps/mobile/android/build.gradle:4`，Android 8.0，
出厂 WebView 约 Chromium 58-60，且国内 OEM 的 WebView 更新常滞后）：
遇到未更新的 WebView，`trimStart` 是运行时 `TypeError`（不是解析期 SyntaxError，
所以不会在加载时炸、而是走到 rich-document 的划词/批注路径才炸），
lookbehind 才会是加载期 SyntaxError（整页白）。

自动化守卫的覆盖缺口：唯一的守卫测试
`apps/mobile/__tests__/chat-transcript-stream-block.test.ts:215-227`
只断言 **4 个文件**不含 `(?<` / `\p{` / `s})`，`rich-document/`、`code-editor/`、
`composer-input/`、`shared/`（含 vendored 的 `mermaid-core.ts`）**全不在内**。

**建议**：
1. `apps/mobile/src/web/tsconfig.json` 补 `"types": []`（该 tsconfig 本就不该看到 Node 全局），
   恢复 `lib` 的拦截力；先确认 `shared/` 下的代码没在用 Node 全局。
2. 把 `annotate-collect.ts:132-133` / `block-split.ts:42` 的 `trimStart/trimEnd` 换成
   手写 `replace(/^\s+/, "")` / `replace(/\s+$/, "")`（或抽一个 `trimStartCompat` 放 `shared/`）。
3. 把守卫测试的 `files` 数组从 4 个扩到整个 `apps/mobile/src/web`（递归扫源码文本），
   并加一条 `trimStart|trimEnd|replaceAll|Object\.fromEntries|matchAll|Promise\.any` 的禁用断言；
   断言写成「扫目录」而不是列文件，避免新增文件绕过。

**(b) native 传输绕过状态码分类（顺带记录，同族不同面）**
`llm-sse-transport.ts:438` 的 `isTransportTimeoutError` 只认 `kind === "timeout"`；
`NativeSseTransportError{kind:"http"}`（`llm-sse-native/src/transport.ts:211-221`，
消息形如 `HTTP 401: …`）既不是 `LlmStreamTimeoutError` 也不是 `ProviderError`，
落到 `model-request.service.ts:81-84` 的 `!(error instanceof ProviderError) → true`。
结果：native 路径上 **401/403/400 也被判可重试**，白等 2 次退避（默认 200ms→400ms + jitter）
才报错，而 XHR/fetch 路径的同状态码立即失败。属口径分裂，非功能故障。

**建议**：(b) 在 `isRetryableError` 里给非 ProviderError 补一个 `/HTTP\s+(\d{3})/` 兜底解析，
与 `parseHttpStatusFromProviderError` 复用同一函数即可（native 消息已经是同款形态）。

置信：**confirmed（实跑）**

---

### F-xc-proto-07 | P3 | sse-line-buffer.ts:19 / llm-sse-transport.ts:582-595 | 传输层的两处小面

1. `feedSseLines` 只按 `"\n"` 切行（`sse-line-buffer.ts:19`），`\r` 靠各 parser 的
   `slice(6).trim()` 侥幸吃掉。CRLF 实测兼容（见 F-02 表），但这是**三处 parser 各自
   兜住了共享层该兜的事**：按 SSE 规范，CRLF/LF/CR 三种换行都合法，当前形态下
   纯 `\r`（老 Mac 风格）换行的流会被当成一整行 → 全部丢弃。建议在 `feedSseLines` 里
   统一按 `/\r\n|\n|\r/` 切，parser 侧不再依赖 trim。
2. XHR 分支若在 `xhr.send()` 之前抛错（如 `applyXhrHeaders` 遇到非预期 headers 形态，
   `:582`），`cleanupBranch`（`:476`）已挂上但没人调，emitter 的 32ms `setInterval` 永久泄漏。
   概率低（`applyXhrHeaders` 三形态都覆盖了），但建议 `runXhr` 整体包一层 try/catch 调
   `cleanupBranch()` 后 rethrow。

置信：**suspected**（第 1 点实跑兼容、未构造纯 `\r` 流验证；第 2 点纯静态推理）

---

### 记为 intentional（不作为发现上报）

- `stream-watchdog.ts` / `STREAM_IDLE_TIMEOUT_MS`：**已按产品拍板退役**
  （文件头 `:2-12` 明确写「流式现无任何空闲自动超时，死流由用户手动终止」，
  `llm-sse-transport.ts:37-39` 有对应淘汰记录）。仍从 `public/provider.ts:133` 导出是因为
  public 导出面 allowlist 冻结（`packages/core/test/package-exports/snapshots/`），
  文件注释 `:11-12` 已写明这是有意保留。**不是死代码缺陷。**
- `LlmStreamTimeoutError` 只按「是否已收到响应数据」分级、idle 不自动重试：设计注释
  `llm-stream-timeout-error.ts:12-14` 写明动机是「避免重复输出/计费」。F-01 是这条设计
  **未覆盖到的错误类别**，不是这条设计错了。
- `openAi` 的 `stream_options: {include_usage: true}`（`openai.adapter.ts:133`）：
  部分 OpenAI 兼容网关不认这个字段会直接 400，但这是「拿到真实 usage」的既定代价，
  且用户可在 provider 的自定义 body params 里覆盖（`Object.assign(body, req.extraBody)`，
  `:144`）。** intentional。**

## 争议与存疑

1. **F-01 的修复口径 A vs B 是产品决策，不是技术决策。** A（不重试、让流断就失败）实现最简、
   与 idle 超时口径统一，代价是丢掉「网络抖一下自动恢复」；B（发 reset-stream 让双端清 partial 后
   重试）保留自动恢复，但要动 event 协议 + 双端渲染，且**拼接后的两段正文来自两次独立采样**，
   LLM 不保证复现，观感可能比直接失败更糟。**我不替这个拍板**，建议由主代理在 W7 裁决时
   把两条口径的用户影响写清（"网络抖动重试是否曾被当作产品特性宣传过" 我在本仓未找到相关文案）。
2. **F-01 在 native 路径上的可达性我只有静态推理，没有真机证据。** native 的
   `NativeSseTransportError{kind:"network"}` 由 Kotlin 侧 OkHttp 抛错经 bridge 上来，
   我无法在无 Android 环境里构造「已吐 chunk 后断连」。fetch 路径是**实跑复现**的，
   XHR 路径是**读码确认**的（`onerror` 必在部分 `deliverNewText()` 之后才可能触发）。
   三条路径的代码形态完全同款，W6 验证时建议真机补 native 那一路。
3. **F-06(a) 的 `trimStart` 实际炸不炸，取决于设备 WebView 版本，我没有设备矩阵数据。**
   RULE.md 记录过 2026-08-20「第一版把 lookbehind 正则点炸了老 WebView（Android 12 实锤
   收报），改掉也没收到 0940da2」——那次是 SyntaxError 整页白，用户反馈链路清晰。
   `trimStart` 是 TypeError、只影响 rich-document 一条路径，**可观测性差得多**。
   我倾向按 P2 修（成本 2 行），但如果主代理认为 WebView 早已全部 ≥Chrome 66，可降 P3。
4. **W2 两机位的"流中断被当可重试"撞车与我结论一致但侧重不同。** 它们大概率是从
   `isRetryableError` 的代码读出的「口径不严」；我这边补的是**实跑证据 + 精确到
   「用户看到的是 attempt1 残段 + attempt2 全量」这个具体形态 + 落库侧其实是对的**。
   W6 验证时不必重复造 probe，直接引用本报告附录的复现脚本即可。
5. **`sse-line-buffer` 的纯 `\r` 换行**（F-07 第 1 点）我标 suspected 而非 confirmed：
   `split("\n")` 对纯 `\r` 流的行为是「整流合成一行」，推论清晰但没跑；
   且现实中几乎没有 SSE 服务端发纯 `\r`。建议 W5 合并时按 P3 处理或直接并入 F-02 的规范读法改造。

## 附录：F-01 / F-02 / F-03 / F-04 的复现方式

四个探针都是临时文件，置于 gitignored 的 `packages/core/tmp/`（`.gitignore:33` 的 `tmp/` 规则），
用仓内既有的 runner 跑，**跑完全部删除，未留在工作树**：

```
cd packages/core
npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test tmp/<probe>.test.ts
```

复现要点（W6 可直接照抄）：

- **F-01**：`DefaultModelRequestService` + 真 `OpenAiProtocolAdapter` + 假 `fetchFn`。
  关键细节：假 stream 必须用 `pull(controller)` 而不是 `start(controller)`——
  `start` 里 `controller.enqueue()` 后紧接 `controller.error()` 会**丢弃已入队的数据**，
  第一次跑就踩了这个坑（delta 一个都没发出去，误以为没有 bug）。
  `pull` 下 HWM=1 保证 enqueue 后不再被拉，第二次 `pull` 才 error，才复现出「已吐 2 个 delta 再断」。
  断言口径：同时观测 `createAgentStreamRegistry().get()` 的 partial 与 onStream 拼出的串，二者都会重复。
- **F-02**：直接调三个 `feed*SseChunk` + `finish*Sse`，把 `data: ` 替换成 `data:` 再看
  `blocks` 与 `state.malformedLineCount`（后者保持 0 即证明「无诊断」）。
- **F-03**：把 `signal.addEventListener` / `removeEventListener` 打成计数 spy，跑 5 次成功的
  `postSse`，读 `added - removed`。
- **F-04**：`feed*SseChunk` 喂一段「tool_use 块已 `content_block_stop` + 后续 text 未 stop」的流，
  再调 `finish*SsePartial`，数 `seen.filter(e => e.type === "tool-use").length`。
