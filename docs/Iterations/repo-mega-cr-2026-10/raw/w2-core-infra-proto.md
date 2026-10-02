---
zone: core-infra-proto
agent: domain-survey
files_scanned: 37
---

# W2 测绘：core-infra-proto（`packages/core/src/infra/` llm-protocol / nmtp / prompt-template）

## 摘要

LLM 协议适配层。三家协议（anthropic / gemini / openai）各自把 NM 的 `ChatMessage`/`ContentBlock`
映射成线上 wire 格式、把 SSE 响应流增量解析回 `LlmStreamEvent`；传输由 `llm-sse-transport`
统一三分支（registered native → RN XHR → fetch）。另有 `nmtp`（tokenizer 驱动注册表）与
`prompt-template`（`{{ }}` 宏扫描/渲染）两个小模块。**全区域零持久化访问**——不碰表、不碰
KKV、不碰文件系统，是纯转换层。

规模：37 个源文件 / 5118 行；对应测试 30 个文件 / 5336 行（`packages/core/test/infra/llm-protocol/`，
已被 `packages/core/package.json:121` 的 `-O globstar` 纳入默认全量）。

## 职责与边界

**在边界内**：请求体组装（system/tools/sampling/thinking/extraBody）、历史消息 → wire 的
出站合并（出站合并规则）、SSE 帧增量解析、content block 双向映射、token usage 归一、
HTTP/SSE 传输与整调用超时、工具名 wire 编码、debug 日志脱敏、宏展开。

**不在边界内**：重试/退避策略（`service/provider/impl/model-request.service.ts`）、
run 编排与事件分发（`service/agent/`）、token 计数与缓存（`infra/tokenizer/`）、
native SSE 管子实现（`packages/llm-sse-native/`）、app 侧装配（`apps/*/src/runtime/setup-llm-fetch.ts`）。

边界纪律良好：本区**不 import** 任何原生包、不 import 数据库/仓储层。transport 通过
`registerSseTransport` 鸭子类型注入，与 TDBC 驱动同款解耦先例。

## 对外接口

`packages/core/src/public/provider.ts` 出站：

| 符号 | 位置 | 备注 |
|---|---|---|
| `LlmProtocolKind` / `LlmToolDefinition` / `LlmStreamEvent` / `LlmTokenUsage` / `LlmChatResult` | `ports/adapter.port.ts` | 类型面 |
| `getProtocolAdapter` / `configureLlmFetch` / `clearProtocolAdapters` | `logic/registry.ts:34,43,56` | 适配器注册表 |
| `createLoggingFetch` / `isLlmFetchDebugEnabled` | `logic/debug-fetch.ts:144,19` | app 装配层包装 fetch |
| `LlmStreamTimeoutError` / `LlmStreamTimeoutPhase` / `LLM_STREAM_TIMEOUT_ERROR_NAME` | `logic/llm-stream-timeout-error.ts` | 超时分级 |
| `SSE_WHOLE_CALL_TIMEOUT_MS` | `logic/llm-sse-transport.ts:129` | 600_000 |
| `SseTransport` / `registerSseTransport` | `logic/llm-sse-transport.ts:85,109` | native 注入口 |
| `STREAM_IDLE_TIMEOUT_MS` | `logic/stream-watchdog.ts:22` | **冻结面导出，原语无接入方** |
| `toolsFromRegistry` | `logic/tool-definitions.ts:17` | registry → LLM 工具定义 |
| `resolveTokenizerDriver` / `TokenizerError` | `infra/nmtp/` | tokenizer 驱动解析 |

内部关键符号（不出 core）：`chatMessagesToAnthropic` / `chatMessagesToGeminiContents` /
`chatMessagesToOpenAi`、`feed* SseChunk` / `finish*Sse(Partial)`、`postSse`。

## 数据访问

**无。** 证据：`grep -rn 'sqlite|repository|fs\.|readFile|writeFile|kkv|KKV'` 在三个目录下
零命中。本区不触碰任何表 / KKV 域 / 文件路径——请求体的全部输入来自 `LlmChatRequest`
（已由 service 层装配），输出的 `LlmChatResult` 由调用方落库。

唯一"隐式数据面"是**出站**：`chatMessagesToAnthropic` / `chatMessagesToGeminiContents` 会把
完整的隐藏历史（含 tool_result、thinking）喂给 provider。这是设计意图（RULE「出站合并」
条目：合并不落库，只影响 wire 格式），不是缺陷。

## 依赖关系

**import 了谁**（本区 → 外部）：

- `@/domain/chat/model/{content-block,message,message-usage}` — 领域模型
- `@/domain/provider/model/{model-sampling-params,model-thinking-params}` — 采样/思考参数
- `@/domain/chat/content/{message-body-text,text-blocks}` — 正文提取
- `@/domain/tool/logic/tool-registry` + `@/infra/serialization/zod-to-json-schema` — `tool-definitions.ts`
- `@/errors/{provider-errors,prompt-errors}` — 错误类型
- `../../errors/prompt-errors`（prompt-template 用了相对路径，与 llm-protocol 段的 `@/` 别名混用，
  见 F-13）
- `infra/nmtp/ports/tokenizer-driver.port.ts` → **反向 import** `infra/tokenizer/logic/count-prompt-llm-input.js`（F-14）
- 零运行时三方依赖（无 zod 校验、无 HTTP 库）

**被谁消费**（生产侧，27 个文件命中 `llm-protocol`）：

- `service/provider/impl/model-request.service.ts:205` — `getProtocolAdapter` + `adapter.chat`（唯一生产调用点）
- `service/provider/impl/provider-model.service.ts:73` — `listModels`
- `service/agent/impl/agent-runner.ts:628` — 经 modelRequests 间接消费
- `domain/provider/logic/*`（`infer-llm-protocol-from-model-id` / `resolve-thinking-wire` / `builtin-providers`）
- `infra/tokenizer/logic/{count-prompt-llm-input,serialize-tools-for-token-count}`
- app 装配：`apps/desktop/src/main/runtime/setup-llm-fetch.ts:22`、`apps/mobile/src/runtime/setup-llm-fetch.ts:32-38`
- native 契约对端：`packages/llm-sse-native/src/{transport,types}.ts`（消费 `SseTransport` 与 `wholeCallTimeoutMs`）

**跨包契约面**：`SseTransport.post` 的 4 参形状 + 超时错误形态（`name === "LlmSseTimeoutError"`
或 `kind === "timeout"`）是 core↔native 的手工约定，两侧各写一份文档、无共享类型强制
（`llm-sse-transport.ts:249-255` 靠鸭子类型识别）。契约漂移只能在真机暴露。

## 发现清单

| # | 级别 | 位置 | 描述 | 建议 | 置信 |
|---|---|---|---|---|---|
| F-1 | **P1** | `logic/llm-sse-transport.ts:679-681` | fetch 分支把流中网络错误（`reader.read()` 抛的 `TypeError: fetch failed`）**原样** reject，不包成类型化错误。`model-request.service.ts:81-83` 的 `isRetryableError` 对「非 ProviderError」默认返回 `true`，于是流中断会被自动重试（`maxRetries: 2`）；而重试复用同一个 `onStream`，`agent-runner.ts:1061` 的 `streamRegistry.append` 与 UI 已渲染的 attempt-1 delta **不会被清**——`streamRegistry.reset` 只在成功 append 之后（`agent-runner.ts:724`）。用户看到同一 step 的正文重复两遍。 | 流中断（`processedLength > 0`）的错误应在协议层定级为「不可重试」（与 `LlmStreamTimeoutError` 的 `idle` 语义同款），或让重试路径先 `streamRegistry.reset` 并给 UI 一个「重新生成中」信号。**注意修复点跨到 `service/provider` 与 `service/agent` 两区。** | suspected |
| F-2 | P2 | `logic/anthropic-sse-parser.ts:155-160` + `:404-417`；`logic/gemini-sse-parser.ts:110` + `:390-397`；`logic/stream-partial-blocks.ts:49-54` | **abort 路径上 `tool-use` 事件重复 emit，违反 port 的显式契约。** `ports/adapter.port.ts:33-35` 写明「每种协议每个 tool call **至多一次**」。Anthropic：`flushActiveBlock` 在 content block 关闭时已 emit 一次并把 tool_use 放进 `state.blocks`；`finishAnthropicSsePartial` 又从 `state.blocks` 滤出 toolUses 交给 `buildStreamPartialBlocks`，后者**无条件**再 emit 一次。Gemini 同构（`tryEmitGeminiToolUseIfComplete` emit 过 → partial 再 emit）。OpenAI 是对的——`openai-content-mapper.ts:494-502` 用 `emittedToolIndices` 挡了。三家口径不一致。 | 让 `buildStreamPartialBlocks` 接受一个可选 `emittedKeys`（对齐 OpenAI 口径），或把 anthropic/gemini 的 partial 改为复用各自的 `emitToolUsesFromAccumulators` 式去重。**当前无可见影响**：desktop `useAgentStream.ts:211-216` 对 `EVENT_AGENT_STREAM_TOOL_USE` 是空 handler，mobile 完全不订阅；但契约已破，新接消费者即中招。 | confirmed |
| F-3 | P2 | `logic/llm-sse-transport.ts:399-406`、`:513-519`、`:611-618` | 三条传输分支都 `signal.addEventListener("abort", …, { once: true })` 且**全程无 `removeEventListener`**。`{once:true}` 只在事件真的触发时自摘；请求正常完成时监听器永久挂在 run 级 signal 上。signal 来自 `run-agent-turn.ts:329` 的 `internalController`（**每个 run 一个，非每 step**），一个多步 run 会累积 N 个闭包，每个闭包持有自己的 `AbortController`。Node 侧 >10 个监听器会打 `MaxListenersExceededWarning`；Hermes 侧是普通 EventTarget，静默增长。 | settle 路径（`resolveOnce` / `rejectOnce`）里摘监听器；或用 `{ signal }` + `AbortSignal.any` 一次性组合（Node 20+ / RN 均支持）。 | confirmed |
| F-4 | P2 | `logic/anthropic-sse-parser.ts:206`、`logic/gemini-sse-parser.ts:199`、`logic/openai-sse-parser.ts:70` | 三个 parser 都硬编码 `line.startsWith("data: ")`（**必须带一个空格**）。SSE 规范允许 `data:{…}` 无空格形态，部分 OpenAI 兼容网关/中转站确实这么发。此时所有行被静默跳过 → `malformedLineCount` 保持 0 → `sse-parse-errors.ts:47` 的 `assertSseParseSucceededOrThrow` **不抛** → 返回零 blocks → `agent-runner.ts:750-753` 落一条「（本次生成无内容输出）」占位。用户看到的是"模型什么都没说"而不是报错，**排障时完全无线索**。 | 放宽为 `line === "data:" \|\| line.startsWith("data: ")`，并把"收到 data 行但解析不出内容"也计入诊断（让 `assertSseParseSucceededOrThrow` 有牙）。 | confirmed |
| F-5 | P2 | `logic/gemini-content-mapper.ts:220-224` | `blocksToGeminiParts` 遇 `image` 块直接 `throw new ProviderError("UNSUPPORTED_CONTENT")`。`chatMessagesToGeminiContents:376-381` 会把历史里的任意非 tool_result 块喂进来——**只要历史里存在一个 image 块，整轮 run 直接抛错**，而不是降级为纯文本。当前产品路径基本到不了（RULE：attach 的图片"只给文件名不喂正文"，`parse-message-content.ts:140` 的 image 块只从入站响应产生），所以是潜伏态；但它是**硬失败**而非降级，且 `gemini-content-mapper.test.ts` / `protocol-gemini.test.ts` 里零 image 用例（已实测 grep 无命中）。 | 与 `blocksToTextOnly`（`text-only-content.ts:19`）口径对齐：明确决定是"跳过并记日志"还是"硬失败"，并补一条锁定用例。 | suspected |
| F-6 | P2 | `logic/openai-content-mapper.ts:385` | `const index = typeof tc.index === "number" ? tc.index : 0;` —— provider 省略 `index` 时，**所有 tool_calls 全部塌进 index 0**：`argumentsJson` 被顺序拼接、`name` 被后写覆盖、`id` 被后写覆盖。多个并行工具调用会退化成 1 个（多半 JSON 非法 → 走 `degradedToolCalls` 降级成 `input={}`，工具静默不执行）。OpenAI 规范保证 `index` 必带，但兼容网关不守规矩。 | 缺失 `index` 时退化为「按出现顺序分配下一个未占用槽位」；至少要能区分两个并行调用。 | suspected |
| F-7 | P2 | `logic/gemini-sse-parser.ts:122` | `const key = typeof fc.id === "string" && fc.id !== "" ? fc.id : fc.name;` —— Gemini 未回 `functionCall.id` 时，**同名函数的并行调用塌成一个累加器**（`argsJson` 被后者整体覆盖，见 `:132-137`）。与 F-6 同类。附带：`:132-137` 用 `acc.argsJson = newJson` **覆盖**而非追加——Gemini 官方是整对象下发所以正确，但若某网关改成分片对象下发会丢键。 | 同 F-6；覆盖改追加需先确认 Gemini 语义（建议保留覆盖 + 注释锁定，追加另走 key-merge）。 | suspected |
| F-8 | P2 | `impl/anthropic.adapter.ts:198`、`impl/openai.adapter.ts:221`、`impl/gemini.adapter.ts:156` | **协议层拿不到 `providerId`。** `postSse` 的第 4 参（`providerId`）三家 adapter 一律传字面量 `undefined`；`fetchJson(...)` 的第 4 参同样从不传（`anthropic.adapter.ts:81,160`；`openai.adapter.ts:76,165,186`；`gemini.adapter.ts:45,118`）。后果：本区抛出的每一个 `ProviderError`（`HTTP_ERROR` / `UNSUPPORTED_CONTENT` / `MALFORMED_SSE` / `INVALID_TOOL_ARGUMENTS`）`providerId` 字段都是 `undefined`——而 `LlmChatRequest`（`ports/adapter.port.ts:55-76`）根本没有这个字段可传。同时 `SseTransport.post` 的 `opts.providerId`（`llm-sse-transport.ts:92`）与 native 侧 `types.ts:97` 声明的字段**永远是 undefined**，是纯死参数。 | 把 `providerId` 加进 `LlmChatRequest`（`model-request.service.ts:214-230` 手上就有），adapter 透传给 `postSse` / `fetchJson`。属可观测性缺口，不影响功能。 | confirmed |
| F-9 | P3 | `logic/registry.ts:21-29`（尤其 `:22-24`） | `getProtocolAdapter(kind, fetchFn)` 的 `fetchFn` 形参**在注册表已被填充后被静默忽略**——`ensureDefaults` 首行 `if (adapters.size > 0) return;`。唯一用它做覆盖的调用方 `apps/cli/src/test/e2e-llm-fetch.ts:14-15` 靠先调 `clearProtocolAdapters()` 侥幸成立；任何人调整顺序或提前触发一次 `getProtocolAdapter` 就会静默走 `globalThis.fetch`。另 `:25-28` 与 `:36-39` 的三行注册是逐字重复。 | `ensureDefaults` 里带 `fetchFn` 调用时走 `adapters.clear()` + 全量重建；或直接把 `ensureDefaults` 抽成 `configureLlmFetch` 的实现，`ensureDefaults` 只做"空才填"。 | confirmed |
| F-10 | P3 | `logic/llm-stream-timeout-error.ts:38` | `idle` 相位的错误文案是 `"LLM stream idle for ${timeoutMs}ms **after the last chunk**"`。但按 RULE「流式不设空闲超时」拍板，idle 相位**已经没有空闲阈值了**——它是整调用预算（600s）耗尽且已有输出。文案会让排障者去找一个不存在的"最后一块之后 600 秒"的语义。 | 改为「整调用预算 600s 耗尽（已有部分输出）」之类表述。 | confirmed |
| F-11 | P3 | `logic/tool-arguments-parse.ts:36`、`logic/openai-sse-parser.ts:125`、`logic/openai-content-mapper.ts:89` | 三个导出**无生产消费方**（只有各自单测）：`parseToolArgumentsJson`（抛错版；全仓只有 tool-arguments-parse.test.ts 引用）、`parseOpenAiSseStream`（fetch body 直读版，已被 `postSse` 取代）、`blocksToOpenAiMessageContent`（只在同文件 `openai-content-mapper.ts:188` 内部调用）。三者均**未**出现在 `public/provider.ts`。 | 降为文件内私有，或在 W3「死路径狩猎」里统一裁决。`parseOpenAiSseStream` 是历史双实现残留，最值得删。 | confirmed |
| F-12 | P3 | `logic/sse-line-buffer.ts:8` 与 `:24` | `SseLineBufferState` 声明为 `{ readonly buffer: string }`，写入靠 `(state as { buffer: string }).buffer = trailing` 强转绕过 readonly。三个 parser 的 state 字段实际是可变的，类型层面却承诺不可变——类型谎言 + 一个共用的 cast 抑制点。另外 `state.buffer` 无上限：若上游发来一条不含 `\n` 的超长行（超大 base64 图片内联），缓冲会无界增长。 | 让 state 类型直接持有可变 `buffer`（或改成 class / 返回新状态的纯函数），去掉 cast；给缓冲加一个上限诊断。 | confirmed |
| F-13 | P3 | `infra/prompt-template/macro-render.ts:7`、`macro-scan.ts:7` | prompt-template 段用**相对路径** `../../errors/prompt-errors.js`，而同目录的 llm-protocol 全段用 `@/` 别名。同一 zone 内两套 import 风格。 | 统一为 `@/errors/prompt-errors.js`。 | confirmed |
| F-14 | P3 | `infra/nmtp/ports/tokenizer-driver.port.ts:7-10` | **分层倒置**：port（抽象）反向 import 了 `infra/tokenizer/logic/count-prompt-llm-input.js`（实现层的具体函数）。tokenizer 段的 `index.ts:128` 又把 `nmtp` 的东西 re-export 出去——`nmtp`（协议抽象）↔ `tokenizer`（实现）互为依赖，实为同一件事被切成了两半。 | 把 `CountPromptLlmInputParams` / `PromptTokenCountResult` 提到 nmtp 自己的 `model/`，tokenizer 段反向依赖 nmtp。 | confirmed |
| F-15 | P3 | `impl/openai.adapter.ts:44-54`、`:148-153` | `useTextOnlyShortcut` 命中时把**整段多轮历史塌成一条 user 消息**，每条前面拼 `"user: "` / `"assistant: "`（`text-only-content.ts:47`），角色结构彻底丢失。触发条件：无 tools + 无 system + 非流式 + 纯文本历史。生产唯一调用点 `agent-runner.ts:628` 恒传 system 与 tools，故**实际不可达**；但 CLI `nm model request`（`apps/cli/src/model/commands.ts:79`）走的就是这条路。 | 明确该 shortcut 的定位（本地调试/单发探测）并在 docstring 写死"仅单轮有效"，或直接对多轮历史禁用。 | suspected |
| F-16 | P3 | `logic/anthropic-content-mapper.ts:66-68` | `default:` 分支返回 `{ type: "text", text: "" }`。`ContentBlock`（`domain/chat/model/content-block.ts:8-13`）是闭合联合，此分支不可达；真不可达时也不该静默产出空 text 块（同仓 `stream-partial-blocks.ts:5` 注释明写「content_json 拒绝空 text」）。 | 改 `default: throw new ProviderError(...)` 或收窄为 `never` 断言。 | confirmed |
| F-17 | P3 | `logic/anthropic-content-mapper.ts:227` | `chatMessagesToAnthropic` 不保证首条 wire 消息是 `role: "user"`。Anthropic API 对首条 assistant 消息会 400。回滚到 assistant 消息处的场景（`resolve-rollback-anchor`）理论上能构造出这种历史（正常路径下首条必是 user，所以风险低）。同理 gemini 侧首条必须是 `user`/`model`，RULE「压缩」条目保证了压缩后可见历史以 user 开头，但回滚路径没同等保证。 | 出站前断言/规范化首条角色（补一条占位 user 或丢弃前导 assistant）。 | suspected |
| F-18 | P3 | `logic/debug-fetch.ts:31-41` | `redactUrl` 只脱敏 `key` 查询参数（Gemini）。用户自配 baseUrl 里带的其它形态凭据（`?token=` / `?access_token=` / path 段里的 key）会原样进 `console.log`——`isLlmFetchDebugEnabled` 在 RN `__DEV__` 下恒真（`:27`），每个非流式请求都打。header 侧 `redactHeaders:50-56` 覆盖了 `authorization` / `x-api-key`，是完整的。 | 脱敏改为白名单式（只打 origin + path，不打 query），或把常见凭据参数名一并纳入。 | suspected |
| F-19 | P3 | `logic/anthropic-sse-parser.ts:272-279` | `input_json_delta` 在 `state.active?.type !== "tool_use"` 时**静默丢弃**（不进 malformed 计数、不告警）。`signature_delta` 落到 `ensureActiveThinking()`——若模型先发 signature 再开 text block，会凭空造出一个空 thinking 块。同理 `citations` / `input_json` 等 delta 类型整体无处理。 | 未知 delta 类型记一条诊断计数（复用 `malformedLineCount` 的姊妹字段），让 finish 断言有牙。 | confirmed |
| F-20 | P3 | `logic/llm-sse-transport.ts:662` | fetch 分支 `decoder.decode(value, { stream: true })` 后**从不 flush**（`done` 时不调 `decoder.decode()`）。流末尾被截断的多字节字符会丢。`openai-sse-parser.ts:140` 的 `parseOpenAiSseStream` 同款（虽然该函数已无调用方，见 F-11）。 | `done` 时补一次 `decoder.decode()` 并把残余交给 `dispatchSseChunk`（该函数已忽略空串，安全）。 | confirmed |
| F-21 | P3 | `logic/gemini-sse-parser.ts:360-372` | `finishGeminiSse` 先 `assertSseParseSucceededOrThrow`，**之后**才走「blocks 为空 → 从最后一个 raw chunk 重新 `geminiPartsToBlocks`」的兜底。兜底产出的 blocks **绕过了断言**——即「零 blocks + N 条畸形行」本该抛 `MALFORMED_SSE`，却可能被兜底救回来（用最后一帧的残片）。 | 把兜底放在断言之前，或对兜底结果补一次断言。 | confirmed |
| F-22 | P3 | `impl/anthropic.adapter.ts:207`、`impl/openai.adapter.ts:230`、`impl/gemini.adapter.ts:165` | `const aborted = req.signal?.aborted === true;` —— `postSse` resolve 之后到这一行之间若 abort 落地（microtask 竞态），会走 partial 分支（丢弃已 flush 的 tool_use / 降级 usage），而不是正常 finish。窗口极窄但存在。 | 记录 `postSse` 的 settle 原因（resolve vs abort）并据此选分支，而不是事后读 signal。 | suspected |
| F-23 | P3 | `logic/anthropic-sse-parser.ts:425`、`logic/gemini-sse-parser.ts:405` | 三家 partial 路径**一致地**丢弃 `degradedToolCalls`（恒返回 `[]`，OpenAI 走的是另一条分支同样不带）。即"abort 时已 flush 的 tool_use 参数非法"这一降级信息完全消失，ToolRunner 会拿着 `input={}` 去执行一个参数缺失的工具。因为 abort 后 run 直接 `break` 不执行工具（`agent-runner.ts:729-731`），**当前无实际影响**。 | 记为已知口径；或把 partial 路径的非法参数 tool_use 直接从 blocks 里剔除（比"带着空 input 落库"更诚实）。 | intentional（口径一致，但建议在 `adapter.port.ts` 的 `degradedToolCalls` 字段注释里写明「partial 路径不产出」） |

## 争议与存疑

1. **F-1（流中断重试导致正文重复）的修复归属跨界。** 协议层只能做"把流中错误定级为不可重试"，
   彻底解还需要 `model-request.service` 在重试前通知 runner 清流式累积。我在本区只能确认
   根因的一半（错误未定级 + `streamRegistry.reset` 不在重试路径上）。**争议点**：也可能产品
   侧本来就想要"网络抖动自动重发"这个体验，那正确修法是 UI 层的"重新生成中"覆盖态而非禁重试。
   这需要用户/主代理拍板，我不单方面定。

2. **F-2（tool-use 重复 emit）算 P2 还是 P1？** 我判 P2，理由是当前**零功能消费方**
   （desktop 空 handler、mobile 不订阅）。判 P1 的理由是 `adapter.port.ts:33-35` 把它写成了
   显式契约，实现已破。留给 reduce 阶段按"契约破坏 vs 用户可见"的口径裁决。

3. **F-5（gemini image 硬失败）的可达性。** 我按 RULE 判定产品路径不可达（attach 图片不喂
   正文），但**没有实测**端到端确认。若有 fixture / 导入路径能把 image 块写进历史，它就是 P1。

4. **`data: ` 无空格（F-4）到底是"没见过的形态"还是"真有网关这么发"**——我手上没有真实
   抓包证据，只有规范层面的判断（`eventsource` 规范允许无空格）。判 P2 而非 P1 就是因为
   触发前提未证实。

## 已核实为**故意设计**（不作为发现上报）

- **`stream-watchdog.ts` 全文件退役但保留导出** —— RULE 明确记载「模块内已退役件：
  `stream-watchdog.ts`（idle 原语，无接入方，导出保留）」，文件头 `:1-19` 有完整留档。
  `STREAM_IDLE_TIMEOUT_MS` 仍在 `public/provider.ts:133` 出站，注释标注为「allowlist 冻结面」。
  → `intentional`，不报。

- **无流式空闲超时、只有整调用预算 600s** —— RULE「LLM 流式请求不设固定空闲超时（产品拍板，
  2026-09-26）」。`llm-sse-transport.ts:329-334` 有完整淘汰记录，`SSE_WHOLE_CALL_TIMEOUT_MS`
  是唯一自动兜底，死流由用户 `sseAbort` 手动终止。→ `intentional`，不报。

- **相邻 user 合并（anthropic `mergeAdjacentUserTurns` / gemini `mergeAdjacentUserContents`）**
  —— RULE「出站合并」条目逐字对应：这两家协议不接受连续 user turn，合并不落库。
  实现与文档一致。→ `intentional`，不报。

- **协议层 usage 事件不节流**（`anthropic-sse-parser.ts:75-90` / `gemini-sse-parser.ts:73-89`）
  —— RULE「实时 token 指标语义」条目明写「协议层不节流（上层合批/节流吸收）」，且 gemini
  逐候选块 emit 是**被显式记录的依赖**（若协议层清窗会把速率反复清成 null）。→ `intentional`，不报。

- **XHR 分支无条件 `Connection: close`**（`llm-sse-transport.ts:594`）—— `:583-593` 的注释把
  条件化推理写得很清楚（`runXhr` 只在 registered transport 缺席时执行，函数内判断恒真故简化）。
  → `intentional`，不报。

- **`blocksToOpenAiMessageContent` 对 thinking 块抛 `UNSUPPORTED_CONTENT`**（`openai-content-mapper.ts:113-117`）
  —— 该分支从 `chatMessagesToOpenAi` 走不到（`:167-172` 的 `other` 过滤器已排除 thinking），
  属防御性代码。已在 F-11 里作为"过度导出"提了一句，不单列。

## 覆盖率备注

- 传输层测试密度高：`llm-sse-transport.test.ts`（10 例）+ `llm-sse-transport-port.test.ts`（15 例）
  覆盖三分支择优、settle 竞态、超时分级、用户取消。RULE 记载的"空闲看门狗退役"用例
  `U-06: no stall abort after long idle` 与 `流中长静默不自动超时` 均在，防回退。
- 薄弱的正交轴：**content block 类型 × 协议**。gemini 的 image 分支、thinking 块的
  `redacted_thinking` 丢弃、openai 的 `reasoning_content` 回传，都只有 mapper 层单测，
  没有 adapter → wire body 的端到端断言。
- 三个 `*-partial-stream.test.ts` 全部**不测 `tool-use` 事件**（已实测 grep），这正是 F-2
  能长期存活的原因。
