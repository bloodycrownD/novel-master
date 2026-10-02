---
zone: w8-ds-llmproto-a
agent: ds-independent-double-scan-A（独立双扫 A 机位）
files_scanned: 30（impl 3 / logic 26 / ports 1），另读 8 个直接消费方文件与 6 个 domain 依赖文件做交叉验证
probes: 8 轮临时探针（已全部删除，git 工作树无源码改动）
---

# w8-ds-llmproto-a —— packages/core/src/infra/llm-protocol/ 全量测绘

## 摘要

三家 LLM 厂商协议（OpenAI Chat Completions / Anthropic Messages / Gemini generateContent）的
唯一出站实现层。对上承接 `model-request.service` 的重试与取消，对下经 `postSse` 三分支传输
（registered native → RN XHR → fetch）投递流式请求；内部含消息双向 mapper、增量 SSE 行缓冲、
三套 SSE parser、abort 期 partial blocks 组装、token usage 归一、tool 名 wire 编码与工具注册
表投影。零业务规则、零持久化——全部是「领域块 ↔ 厂商 wire」的纯转换与传输。

## 职责与边界

**做**：①把 `ChatMessage[]` + tools + system + sampling + thinking 序列化成三家 wire body；
②把三家流式响应增量解析回 `ContentBlock[]` 并 emit `text-delta`/`thinking-delta`/`tool-use`/`usage`/`done`；
③传输层择优与整调用预算（`SSE_WHOLE_CALL_TIMEOUT_MS` = 600s，按「是否已收到字节」分级 first-chunk/idle）；
④用户 abort 时把已收到的部分组装成 partial blocks 当作正常结果返回（不抛错）。

**不做**：不重试（`model-request.service.ts:232`）、不落库、不做 doom-loop 判定、不做 token 计数
（`infra/tokenizer` 另有一套序列化）、不装配 transport（由 app 层 `registerSseTransport` /
`configureLlmFetch` 注入）。core 不 import 任何原生包——SSE transport 是鸭子类型 port。

**纪律相关**：`docs/apm/RULE.md:95`（2026-09-26 产品拍板「LLM 流式不设固定空闲超时」）已把
`stream-watchdog.ts` 整个原语退役，`STREAM_IDLE_TIMEOUT_MS` 只作为 allowlist 冻结面从
`public/provider.ts:133` 继续导出。**标 intentional，不当问题报。**

## 对外接口

### ports/adapter.port.ts（唯一 port，三 adapter 的实现契约）
- `LlmProtocolKind = "openai" | "anthropic" | "gemini"`
- `LlmStreamEvent` 判别联合：`text-delta` | `thinking-delta` | `tool-use` | `usage` | `done`
- `LlmChatRequest`：baseUrl / apiKey / vendorModelId / userContent / extraHeaders / history /
  toolUseLookupMessages / system / tools / stream / onStream / sampling / thinking / extraBody / signal
- `LlmChatResult`：assistantText / blocks / raw / usage? / degradedToolCalls?
- `DegradedToolCall`：`reason` 恒为 `"INVALID_TOOL_ARGUMENTS"`
- `LlmToolDefinition` / `LlmTokenUsage`（= domain `MessageUsage`，类型别名共用）
- `FetchFn = typeof globalThis.fetch`

### logic/registry.ts
- `getProtocolAdapter(kind, fetchFn?)`（`model-request.service.ts:204`、
  `provider-model.service.ts:73` 是唯二消费方）
- `configureLlmFetch(fetchFn)`（desktop main / mobile runtime 装配期调用）
- `clearProtocolAdapters()`（仅 `apps/cli/src/test/e2e-llm-fetch.ts:14` 测试用）

### logic/llm-sse-transport.ts
- `postSse(url, init, onChunk, providerId?, options?)`（三个 adapter 唯一流式出口）
- `SseTransport` port + `registerSseTransport(transport|undefined)`（`public/provider.ts:136`）
- `SSE_WHOLE_CALL_TIMEOUT_MS`（未从 public 面导出，内部单点）
- 测试钩子：`setSseTransportOverrideForTests` / `resetShouldUseXhrForSseCacheForTests` /
  `setShouldUseXhrForSseOverrideForTests`

### logic/tool-definitions.ts
- `toolsFromRegistry(registry, ctx)`（`public/provider.ts:117`；
  `agent-runner.ts:273` 是仓内唯一消费方）——把 `ToolRegistry` 的
  `(ctx) => string` description 在装配期求值成 string。

### public/provider.ts 转出的其余符号
`createLoggingFetch` / `isLlmFetchDebugEnabled`（debug-fetch.ts）、`STREAM_IDLE_TIMEOUT_MS`（冻结面）。

## 数据访问

**零持久化。** 本区不碰任何 SQL 表、KKV 域、文件路径、缓存。全域唯一副作用面是：

| 出口 | 位置 | 说明 |
|---|---|---|
| HTTP 出站 | `openai.adapter.ts:76,165,186`；`anthropic.adapter.ts:81,160`；`gemini.adapter.ts:45,118` | fetchJson |
| HTTP 出站（流式） | 三个 adapter 的 `chatStream` → `postSse` | 三分支传输 |
| console | `llm-sse-transport.ts:229-242`（logSse）、`sse-parse-errors.ts:37`、`debug-fetch.ts:158-188` | 受 `NM_DEBUG_LLM_FETCH` / `__DEV__` 门控 |
| 全局可变单例 | `registry.ts:19` adapters Map、`llm-sse-transport.ts:100-101` 两个 transport 槽位 | 进程级 |

环境变量读取（本区全部 5 处）：`NM_DEBUG_LLM_FETCH`（llm-sse-transport.ts:195、debug-fetch.ts:20、
sse-parse-errors.ts:23）、`NM_DEBUG_LLM_SSE`（sse-parse-errors.ts:20）、
`OPENAI_TOOL_CHOICE_REQUIRED`（openai.adapter.ts:117）。
`globalThis.__NM_DEBUG_LLM_FETCH__` / `__DEV__` 作为无 env 环境的门（llm-sse-transport.ts:202、
debug-fetch.ts:27）。
**实测**：`node_modules/react-native/Libraries/Core/setUpGlobals.js:30-35` 保证 RN 侧
`global.process.env = {}` 存在，故这些 `process.env.X` 在 Hermes 上不会 ReferenceError。**非问题。**

## 依赖关系

### import 了谁
```
@/domain/chat/model/{content-block,message,message-usage}   三 mapper 的类型源
@/domain/chat/content/{message-body-text,text-blocks}       assistantText / userContent 组装
@/domain/provider/model/{model-sampling-params,model-thinking-params}
@/domain/tool/logic/tool-registry                           toolsFromRegistry
@/infra/serialization/zod-to-json-schema                    tool inputSchema
@/errors/provider-errors                                     ProviderError
```
无 import 任何原生包 / 无 import 任何 app 层（transport 与 fetch 均靠注入）。

### 被谁消费（按调用点数）
| 消费方 | 引用符号 | 位置 |
|---|---|---|
| `service/provider/impl/model-request.service.ts` | `getProtocolAdapter`、`createAbortError`、`isAbortLikeError`、`LlmStreamTimeoutError` | :16,:32,:35,:204 |
| `service/provider/impl/provider-model.service.ts` | `getProtocolAdapter` | :73 |
| `service/provider/impl/provider.service.ts` | `normalizeBaseUrl` | :80,:159 |
| `service/agent/impl/agent-runner.ts` | `toolsFromRegistry` | :273 |
| `apps/desktop/src/main/runtime/setup-llm-fetch.ts` | `configureLlmFetch`、`createLoggingFetch` | :22 |
| `apps/mobile/src/runtime/setup-llm-fetch.ts` | `registerSseTransport`、`configureLlmFetch`、`createLoggingFetch` | :32-36 |
| `apps/cli/src/test/e2e-llm-fetch.ts` | `clearProtocolAdapters`、`getProtocolAdapter` | :14-15 |
| `domain/provider/logic/resolve-thinking-wire.ts` | `LlmProtocolKind`（类型） | :7 |

**依赖倒挂观察**：`domain/provider/model/*` 反向 import 了 `infra/llm-protocol/ports/adapter.port.ts`
的 `LlmProtocolKind`（`model-thinking-params.ts:7`、`model-sampling-params.ts:7`、
`protocol-sampling-defaults.ts:7`）。domain → infra 的类型依赖，是 infra 侧唯一被反向污染的口子。
纯类型 import（`import type`），运行期零环，但会让 infra 新增导出时被动扩张 domain 依赖面。P3。

---

## 发现清单

### F-w8-llmproto-a-01 | P1 | gemini-sse-parser.ts:122
```ts
const key = typeof fc.id === "string" && fc.id !== "" ? fc.id : fc.name;
```
**描述**：Gemini 流式 functionCall 累加器以 `id ?? name` 为 Map key。Gemini 在
`functionCall.id` 缺席时（API 明确允许省略）退化为按**函数名**归并。于是**并行的两个同名
工具调用被压成一个累加器**：第二个 chunk 的 `args` 整体覆盖第一个（`:133-136` 是赋值不是累加），
最终 `blocks` 只剩一条 tool_use，且携带的是**最后一次**调用的参数。

**实测**（探针 P3）：喂入两个无 id 的 `read_file`（args 分别 `{path:"a.md"}` / `{path:"b.md"}`），
```
blocks = [{"type":"tool_use","id":"read_file","name":"read_file","input":{"path":"b.md"}}]
emitted tool-use = [{id:"read_file",input:{path:"a.md"}}, {id:"read_file",input:{path:"b.md"}}]
```
即：**流事件发了两次（id 相同），最终 blocks 只有一条**。agent-runner 侧
（`agent-runner.ts:763` filter toolUses → `:807` degradedById）只会执行一次，
第一次的真实参数在 UI 上闪现后被吞掉——工具调用**静默丢失 + 参数串味**。

**对照**：openai 用 `delta.tool_calls[].index`（`openai-content-mapper.ts:385`）做 key，
天然区分并行；anthropic 用数组下标（`anthropic-sse-parser.ts:234` push）。**三家唯一一处
key 选取不当，且只有它会静默错参**。

非流式路径反而是对的：`geminiPartsToBlocks` 在 id 缺席时合成 `${name}-${blocks.length}`
（`gemini-content-mapper.ts:262-265`，探针 P12 实测得 `["ls-0","ls-1"]`）。所以
**同一条响应在流式与非流式下产出的 tool_use id 与条数都不同**——这是本区最严重的一致性缺口。

**建议**：key 改为 `fc.id ?? \`${fc.name}#${ordinal}\``（ordinal 用 state 上的
`functionCallOrdinal` 计数器，跨 chunk 保持稳定）；或在 `mergeFunctionCallPart` 入口检测
「key 已存在且本次 args 与已存不同」时不覆盖而另起新 key。同时补一条
「流式/非流式同响应 id 序列一致」的回归用例。

**置信**：confirmed（探针实跑复现）

---

### F-w8-llmproto-a-02 | P1 | gemini-sse-parser.ts:362-372
```ts
if (blocks.length === 0 && state.streamRaw != null) {
  const parts = raw.candidates?.[0]?.content?.parts ?? [];
  return { blocks: geminiPartsToBlocks(parts), ... };
}
```
**描述**：blocks 为空时的兜底只重解析 **`state.streamRaw` 这一个 chunk**——而 `streamRaw`
在 `:150` 每次 `processGeminiResponseChunk` 都被**覆盖**成当前 payload，即它恒等于**最后一个**
chunk。前面 N-1 个 chunk 的内容被彻底丢弃。

**实测**（探针 P21）：两个 chunk 各带一个 `functionResponse`（name x / y），
```
blocks = [{"type":"tool_result","toolUseId":"y","content":"p"}]   // x 消失
```

**触发面**：只有「解析器自己认不出的 part 类型」才会让 blocks 全空而落进兜底——
即 Gemini 新增 part 形态（如 `executableCode`、`videoMetadata`、未来的多模态 part）时，
**整条响应被静默截成最后一个 chunk**，且不抛错、不计数（`malformedLineCount` 不增，
`assertSseParseSucceededOrThrow` 在 `:360` 已在其**之前**执行、此时 blocks 为空但
malformed=0 所以也不抛）。用户看到的是「模型只回答了最后一句」。

**建议**：兜底应基于「累计 parts」而非最后一个 chunk——在 `processGeminiResponseChunk`
里维护 `state.allParts: unknown[]` 累积，兜底时对 `allParts` 跑 `geminiPartsToBlocks`。
或至少在兜底触发且丢弃了非空历史 chunk 时抛 `ProviderError("MALFORMED_SSE")`。

**置信**：confirmed（探针实跑复现）

---

### F-w8-llmproto-a-03 | P1 | llm-sse-transport.ts:285
```ts
logSse(logTag, "→", { method, url, transport: kind });
```
**描述**：`postSse` 的第一条调试日志把**完整 URL 原样**打出去。Gemini 的 URL 形态是
`.../models/{model}:streamGenerateContent?key=<APIKEY>&alt=sse`（`gemini.adapter.ts:109-113`
拼装，`encodeURIComponent` 编码 key）——**API key 明文进 console**。

同目录的 `debug-fetch.ts:31` 已经写好了 `redactUrl()`（专门注释「Redact sensitive query
params (e.g. Gemini `?key=`)」），但 `llm-sse-transport.ts` 的 logSse **完全不调它**。
两条日志路径对同一个泄漏点给出了相反的处理。

**实测**（探针 P5，native 分支 + `__NM_DEBUG_LLM_FETCH__=true`）：
```
LEAK CONFIRMED in object arg:
{"method":"POST","url":"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?key=SECRET-API-KEY-123&alt=sse","transport":"native"}
```

**触发条件**：`isSseDebugEnabled()`（`:194-203`）在 `NM_DEBUG_LLM_FETCH=1` **或**
`globalThis.__NM_DEBUG_LLM_FETCH__===true` **或** `__DEV__===true` 时为真。
RN dev build 的 `__DEV__` 恒为 true，desktop 装配期
（`setup-llm-fetch.ts:18-22`）也会把 env 翻成该全局位。**即 dev 环境下每次 Gemini 流式请求
都泄漏一次 key 到 logcat / 终端**，且 RN 的 logcat 会被开发者贴进 issue。

**建议**：`logSse` 统一接 `redactUrl`（从 debug-fetch 提到共享位置，或直接在 logSse 内联
`key=[^&]*` → `key=***` 的兜底替换——注意 logSse 也被 native/xhr/fetch 三分支共用，
不能只改一条）。

**置信**：confirmed（探针实跑复现 + 引用 debug-fetch.ts:31 已有的正确实现作对照）

---

### F-w8-llmproto-a-04 | P2 | anthropic-sse-parser.ts:220-226
```ts
const type = event.type;
if (type === "message_start") { ... } else if (type === "message_delta") { ... }
```
**描述**：Anthropic SSE 有独立的 `{"type":"error", ...}` 事件（`overloaded_error` /
`rate_limit_error` / API 内部错误），本 parser **不识别、不记录、不抛错**，只当噪声丢掉。
后果是：流已经建立、正文可能已吐了一半，服务端报错中断——上层收到的是一个
**看起来成功的正常结果**。

**实测**（探针 E1/E2）：
```
E1 anthropic error event        => {"blocks":[]}
E2 anthropic error after text   => {"blocks":[{"type":"text","text":"partial"}]}
```
两条路径都**不抛错**。E1 走到 `assertSseParseSucceededOrThrow`（`:367`）时
`blocks.length===0 && malformedLineCount===0` → 不抛 → 返回空 blocks 的「成功」结果。
agent-runner 侧 `:733-748` 会走「（本次生成无内容输出）」占位分支并以 **FINISHED** 收尾——
**用户看不到任何错误提示，只看到一句莫名其妙的占位**。E2 则是静默截断。

对照：`openai` 的等价错误载荷（`{"error":{...}}`）同样被丢（探针 E4：
`blocks=[] raw={"error":{...}}`），Gemini 的 `promptFeedback.blockReason:"SAFETY"` 也只
留在 raw 里（探针 E3）。**三家一致地「不识别流内错误语义」**——但 Anthropic 的
`type:"error"` 是**协议定义的错误事件**，不是可选元数据，缺失处理更严重。

**建议**：`processAnthropicSseLine` 增加 `type === "error"` 分支，把 `event.error` 存入
`state.streamError`；`finishAnthropicSse` 在 blocks 为空（或仅部分）时按 streamError 抛
`ProviderError("HTTP_ERROR", ...)`，让 `model-request.service.isRetryableError` 拿到
可重试的 5xx 语义。openai/gemini 同理（至少把 `error` / `blockReason` 提升为可见信号）。

**置信**：confirmed（探针实跑复现；「上层如何呈现」一段为基于 agent-runner.ts:733-748
代码路径的推断，未跑端到端）

---

### F-w8-llmproto-a-05 | P2 | anthropic-sse-parser.ts:220-226（同段）
**描述**：三家 parser 都**只把 stop_reason / finish_reason 留在 raw 里，不参与任何判定**，
截断与完整回复对上层完全不可区分。

**实测**（探针 E5/E6/E7）：
```
E5 openai finish_reason=content_filter => blocks=[]  （空回复被当正常）
E6 anthropic stop_reason=max_tokens     => blocks=[{text:"trun"}]  raw 带 max_tokens
E7 gemini  finishReason=SAFETY          => blocks=[{text:"partial ans"}]
```
E5 最严重：`content_filter` 意味着内容被**安全策略拦下**，但上层看到的是「空回复 + FINISHED」，
用户以为模型没话说，实际是被拦。E6/E7 则是「被 max_tokens 截断的半截回复」被当作
完整回复落库并可能直接进入下一轮 tool 循环。

**建议**：在 `LlmChatResult` 上加一个可选 `finish?: { stopReason?: string; truncated?: boolean }`，
三家 parser 在 finish 时填；agent-runner 侧对 `truncated` 打标、对 `content_filter`/SAFETY
走可见提示。这一改动跨 zone（需 `LlmChatResult` 契约 + runner），本条仅登记协议侧缺口。

**置信**：confirmed（探针实跑复现）

---

### F-w8-llmproto-a-06 | P2 | anthropic-sse-parser.ts:389-418
```ts
flushActiveBlock(state, onStream, toolNames);   // ← 这里已经 emit 了一次 tool-use
...
const toolUses = state.blocks.filter(b => b.type === "tool_use").map(...);
const blocks = buildStreamPartialBlocks({ text, thinking, toolUses }, onStream);
```
**描述**：`finishAnthropicSsePartial` 先 `flushActiveBlock`（`:389`）——它对 tool_use 分支
会 `onStream?.({type:"tool-use", ...})`（`:155-160`）；随后又把同一批 tool_use 从
`state.blocks` 里捡出来喂给 `buildStreamPartialBlocks`，后者**无条件再 emit 一次**
（`stream-partial-blocks.ts:49-54`，无 emitted 集合守卫）。

**实测**（探针 PROBE2）：
```
PROBE2 anthropic partial tool-use count = 2
blocks= [{"type":"tool_use","id":"tu1","name":"read_file","input":{}}]
```

**Gemini 侧同病**：`finishGeminiSsePartial`（`:390`）走 `buildStreamPartialBlocks`，
而 `tryEmitGeminiToolUseIfComplete`（`:91-111`）在流中已 emit 过——探针 P11 实测
`gemini partial emitted tool-use = 2`。

**OpenAI 侧是对的**：`openAiStreamAccumulatorsToPartialBlocks` 用 `emittedToolIndices`
做了去重（`openai-content-mapper.ts:494`），探针 P10 实测 `= 1`。

**影响**：`tool-use` 事件经 `agent-runner.ts:1080` 转成 `EVENT_AGENT_STREAM_TOOL_USE`
广播到双端。当前两个订阅者都不因此产生重复副作用（desktop
`useAgentStream.ts:211-217` 收了即丢；mobile 无订阅者），所以**今天不炸**——但这是
一份**契约与实现不符**的埋雷：port 上 `tool-use` 的文档注释（`adapter.port.ts:33`
「每种协议每个 tool call 至多一次」）明确承诺了幂等，一旦任一端开始消费该事件做
实时渲染/计数，就会立刻出现重复项。

**建议**：`buildStreamPartialBlocks` 增加可选 `emittedKeys?: Set<string>` 参数
（gemini 侧已有同形状的 `emitToolUsesFromAccumulators` 实现可抄），或在
`finishAnthropicSsePartial` / `finishGeminiSsePartial` 里把 `state.blocks` 中已 emit 的
tool_use 剔除后再传入。

**置信**：confirmed（探针实跑复现）

---

### F-w8-llmproto-a-07 | P2 | gemini-sse-parser.ts:150
```ts
state.streamRaw = payload;   // 每个 chunk 覆盖
```
**描述**：Gemini 侧的终值 usage 取自 `streamRaw`（`gemini.adapter.ts:171`
`parseGeminiUsage(streamRaw)`）。而 `streamRaw` 恒等于最后一个 chunk——**若最后一个
chunk 不带 `usageMetadata`，本次调用的 usage 就整个丢失**（返回 undefined）。

**实测**（探针 P20）：
```
P20 gemini final streamRaw usage = undefined
blocks= [{"type":"text","text":"hi there"}]     // 正文正常，但 usage 没了
```
即：**正文成功、token 统计静默丢失**（agent-runner.ts:709 `usage: {...result.usage, ...}`
落库时缺失，token 统计页少一行）。

**对照**：Anthropic 用 `mergeAnthropicStreamRaw` 双槽合并（`anthropic-sse-parser.ts:306-349`，
探针 P24 实测正确拿到 `{input_tokens:100, output_tokens:42, cache_read:20}`）；
OpenAI 用 `lastUsageEvent ?? lastEvent` 双槽择优（`openai-sse-parser.ts:119`，探针 P23
实测正确）。**只有 Gemini 是单槽覆盖。**

**建议**：`processGeminiResponseChunk` 里只在 `parseGeminiUsage(payload) != null` 时才覆盖
`state.streamRaw`，否则保留上一个带 usage 的 payload；或引入与 anthropic 同形的
`lastUsageRaw` 槽位。

**置信**：confirmed（探针实跑复现）

---

### F-w8-llmproto-a-08 | P2 | gemini-content-mapper.ts:220-224
```ts
case "image":
  throw new ProviderError("UNSUPPORTED_CONTENT",
    "Gemini outbound messages do not support image blocks in this iteration");
```
**描述**：Gemini 出站**硬抛** image block。而 Gemini API 本身是支持图片的
（`inlineData`/`inline_data`），且本仓 mapper 的**入站**方向已经在处理 Gemini 的
多模态返回。更关键的是对比另两家：**openai 支持**（`image_url` data-URI 内联，
`openai-content-mapper.ts:108-111` + `imageUrlFromBlock` `:76-83`），
**anthropic 支持**（`anthropic-content-mapper.ts:26-40`，base64 与 url 双形态）。
于是「会话历史里存在一张图片」这件事：**openai/anthropic 正常跑，gemini 整个请求炸**。

抛的是 `ProviderError`，`isRetryableError`（`model-request.service.ts:96`）
对 `code !== "HTTP_ERROR"` 直接 `return false` → 不重试 → run 直接 FAILED。
用户在 gemini 模型上**永远无法使用任何带图的会话**，且错误文案是「this iteration」
这种内部口吻。

**建议**：要么本轮补 `inlineData`（`{inlineData:{mimeType, data}}`）映射，
要么把文案改成用户可懂的中文并降级为「剥离 image 块 + 提示」而不是整请求失败。
至少应与另两家对齐成同一档能力声明。

**置信**：confirmed（代码直读；「用户会遇到」为推断——未验证是否存在带图历史进 gemini 的实际路径）

---

### F-w8-llmproto-a-09 | P2 | anthropic-content-mapper.ts:67
```ts
default:
  return { type: "text", text: "" };
```
**描述**：`blocksToAnthropicContent` 的 default 分支把未知块类型映射成
**空 text 块**。Anthropic Messages API 对 `text` 块有非空校验
（`text: ""` 会被 400 拒绝）——本仓自己知道这件事：`stream-partial-blocks.ts:5`
的注释就写着「content_json 拒绝 `text: ""`」。

**实测**（探针 P16）：
```
P16 anthropic empty-text = [{"role":"user","content":[{"type":"text","text":""}]}]
```
即：一条 text 块 `text` 为空串的消息，出站就是 `{type:"text", text:""}`。

**对照三家**：
- openai `blocksToOpenAiMessageContent`：空 text 被跳过（`:103-104`），全空则返回 `""`
  再由 `chatMessagesToOpenAi:189` 跳过该字段；探针 P16 实测 openai 输出 `[]`（消息被丢弃）。
- gemini `blocksToGeminiParts`：空 text 被跳过（`:187`）；探针 P16 实测 `parts: []`
  ——**但 parts 为空数组同样会被 Gemini 拒绝**，只是没有 anthropic 那样直接可见。
- anthropic：原样发出 `text:""`。

三家对「空块」的处理各不相同，且**没有一家在出站前做最终的空 parts / 空 content 清理**。

**建议**：三家统一在出站 mapper 末尾做一次剪枝——过滤掉空 text 块，若结果为空数组则
整个 content/parts 输出 `null` 或跳过该消息（对齐 openai 已有的丢弃语义）。
至少把 anthropic 的 default 改成透传 skip 而非造假 text。

**置信**：confirmed（探针实跑复现；「API 会 400」为依据本仓自身注释的推断，未对真实 API 验证）

---

### F-w8-llmproto-a-10 | P2 | sse-parse-errors.ts:47
```ts
if (blocks.length === 0 && diag.malformedLineCount > 0) { throw ... }
```
**描述**：畸形行只有在「**一个块都没解析出来**」时才升级为 `MALFORMED_SSE` 抛错。
只要解析出了 ≥1 个块，后续再多的畸形行都被静默吞掉，流以「正常截断」收尾。

**实测**（探针 P22）：先送一段合法 text（"partial"），再送一行 `data: {BROKEN`，
```
P22 anthropic no-throw blocks = [{"type":"text","text":"partial"}] malformed= 1
```
→ 不抛错，返回半截正文当成功结果。

这本身可能是**有意的**（流已经出了有效内容，硬抛会丢掉用户可见的正文），
但代码里没有留下这个取舍的注释，而 `malformedLineCount` 被统计出来又只在
「零块」时使用，`recordMalformedSseLine` 的 warn 也被 `NM_DEBUG_LLM_SSE` 门控
（生产环境恒不打印）——**结果是生产环境里「流中途解析失败」完全不可观测**。

**建议**：要么在 `assertSseParseSucceededOrThrow` 里对「有块但有畸形行」也发一次
结构化诊断（独立于 debug 开关），要么在文件头注释里明确写出「有内容则容忍畸形行」
是刻意取舍，避免后来者当 bug 改。

**置信**：confirmed（探针实跑复现）

---

### F-w8-llmproto-a-11 | P2 | gemini-sse-parser.ts:390-398（partial 路径丢失降级标记）
**描述**：`finishGeminiSsePartial` 调 `functionCallsToToolUses(state)` 时
**不传 strict**（默认 `false`，`:228`），走 `JSON.parse` + catch 吞成 `input: {}`
（`:261-265`），且返回的 `degradedToolCalls` 恒为 `[]`（`:405`）。
于是**用户中途取消时，一个参数只收到一半的 tool call 会以 `input: {}` 的形式进入 blocks**，
既没有降级标记、也不会被 `agent-runner.ts:807-826` 的 `degradedById` 拦下——
**会以空参数真实执行工具**。

**实测**（探针 P13 / PROBE2）：
```
P13 anthropic partial blocks= [{"type":"tool_use","id":"t1","name":"write_file","input":{}}] degraded= 0
```
Anthropic 侧成因不同但结果一样：`finishAnthropicSsePartial` 的
`flushActiveBlock`（`:389`）确实会把坏参数推进 `state.degradedToolCalls`，
但该函数 `:425` **硬返回 `degradedToolCalls: []`**，把刚记下的降级项扔了。
OpenAI 侧 `openAiStreamAccumulatorsToPartialBlocks`（`:480-487`）同样 catch 吞成 `{}`
且由 adapter `:238` 硬写 `degradedToolCalls: []`。

**三家一致地把「abort 期的坏参数 tool call」降级为可执行的空参调用。**
对 `write_file` / `bash` 这类工具，空参执行意味着**对文件系统产生副作用**
（写空文件、跑空命令）。

**缓解事实**（必须一并记录）：`agent-runner.ts:682-684, 729-731` 在 abort 时
`handleAbort("post_model")` 后**直接 break，不执行工具**。所以当前**不会**真的执行。
但这是 runner 的时序保证，不是协议层的保证——协议层返回的语义（一个 input={} 的
合法 tool_use）是错的，任何未来「abort 后仍处理已收工具」的改动都会立刻变成事故。

**建议**：三个 partial finish 都应 `degradedToolCalls: state.degradedToolCalls`
（anthropic）/ 用 strict 解析（gemini）/ 复用 `tryParseToolArgumentsJson`（openai）。
abort 期的 tool call 宁可不产出 block，也不要产出 `input:{}` 的合法 block。

**置信**：confirmed（探针实跑复现；「当前不执行」已核对 agent-runner.ts:682-731）

---

### F-w8-llmproto-a-12 | P3 | anthropic-content-mapper.ts:45 / anthropic.adapter.ts:47
```ts
return { type: "tool_use", id: block.id, name: toolNames?.toWire(block.name) ?? block.name, input: block.input };
```
**描述**：`AnthropicToolNameWire` 把不合法的工具名（`.` → `_`）编码上网。
`createAnthropicToolNameWire` 的反向表是 `Map<wire, canonical>`（`:30-33`），
**后写覆盖先写**。若注册表同时存在 `a.b` 与 `a_b` 两个工具，二者 wire 名都是 `a_b`，
`fromWire("a_b")` 只会还原成**后遍历到的那个**——出站编码正确、回程解码**张冠李戴**，
模型调 `a_b` 会被还原成 `a.b` 并执行错工具。

**现状**：`resolveAnthropicToolNameWire`（`anthropic.adapter.ts:53-71`）只在
`anthropicToolsNeedWireEncoding` 为真时才建表，即**必须存在至少一个含非法字符的名字**。
当前内置工具名（`BUILTIN_SKILL_NAMES` 等）未见冲突，故**未触发**。
但自定义/未来工具名无命名约束，属于真实可触发的埋雷。

**建议**：`createAnthropicToolNameWire` 检测到 wire 名碰撞时抛错（或对冲突方追加
短哈希后缀），宁可让启动失败也不要静默错映射。

**置信**：suspected（机理确凿，当前工具集未触发）

---

### F-w8-llmproto-a-13 | P3 | tool-arguments-parse.ts:36
```ts
export function parseToolArgumentsJson(raw: string, protocol: LlmProtocolKind): Record<string, unknown>
```
**描述**：`parseToolArgumentsJson`（抛错版）与 `tryParseToolArgumentsJson`（返回
`{ok}` 版）并存，**前者全仓零生产消费方**——三个 adapter 与三个 parser 全部只用
`try` 版本，降级逻辑各自手写 `input = {}`（openai-content-mapper.ts:304,:484；
gemini-sse-parser.ts:262；anthropic 侧走 try 版）。
`parseToolArgumentsJson` 的错误文案 `invalid tool arguments JSON (…)` 与
`agent-runner.ts:818-824` 手工拼的文案**逐字重复**。

同区其他零消费导出：`parseOpenAiSseStream`（openai-sse-parser.ts:125）、
`createStreamWatchdog`（stream-watchdog.ts:45，已知 intentional）、
`ANTHROPIC_WIRE_TOOL_NAME_PATTERN` / `toAnthropicWireToolName`（仅同文件内部用）、
`isLlmFetchDebugEnabled`（同文件内部用，却从 public 面导出）、
`normalizeBaseUrl` 有外部消费（provider.service.ts）故不算。

**建议**：`parseToolArgumentsJson` 与 `parseOpenAiSseStream` 进删除批次；
`agent-runner.ts` 的降级文案改为复用共享构造，避免两处漂移。

**置信**：confirmed（rg 全仓扫描：`parseToolArgumentsJson` 除定义处外仅出现在
本文件 `:40` 的自调用；`parseOpenAiSseStream` 除定义处外无引用）

---

### F-w8-llmproto-a-14 | P3 | anthropic-sse-parser.ts:306-349（mergeAnthropicStreamRaw 字段口径）
```ts
const inputSideKeys = ["input_tokens","cache_read_input_tokens","cache_creation_input_tokens","cache_creation"];
```
**描述**：`mergeAnthropicStreamRaw` 只把 `delta` 顶层的 `usage.output_tokens` 合进
`merged.usage`（`:342-344`），`message_start` 侧的 cache 字段按上表逐个搬运。
两处口径不齐：
① `cache_creation` 整对象被搬进 merged.usage，但 `parseAnthropicUsage`
（usage-parser.ts:91-93）只在 `isRecord(usage.cache_creation)` 时读 `.input_tokens`——
新版形态 OK，旧版扁平形态 OK，**但若供应商同时给了两处且值不同，无仲裁规则**；
② `merged` 以 `{...delta}` 为基底，delta 上任何非 usage 字段（含供应商自造的
`type:"message_delta"`、`event:...`）都会进最终 raw 并**原样落库**
（`agent-runner.ts:706` `raw: result.raw`）。

探针 P24 实测合并结果正确（`{input_tokens:100, cache_read:20, output_tokens:42, model:"claude-x"}`），
功能无缺陷；此处记的是**raw 落库面的大小与敏感度**：raw 是供应商原始响应的宽松子集，
没有字段白名单。

**建议**：`mergeAnthropicStreamRaw` 收敛为白名单输出（type/id/model/role/stop_reason/usage），
避免供应商新增字段把噪音甚至敏感内容带进 DB。

**置信**：suspected（合并功能正确；raw 落库的敏感面为推断）

---

### F-w8-llmproto-a-15 | P3 | model-*.ts ← infra 反向类型依赖
**描述**：`domain/provider/model/{model-thinking-params,model-sampling-params,protocol-sampling-defaults}.ts`
各有一行 `import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js"`。
纯类型 import，运行期零环（与 `docs/apm/RULE.md:92` 记录的「模块级 import 的 require-cycle
在依赖解析顺序变化时才暴露」不同，此处是 type-only，Metro/babel 会擦除）。
但它把 infra 的 `ports/` 目录抬成 domain 的编译期依赖——**infra 新增/移动导出时，
domain 会被动牵连**，与仓库其余部分「domain 不认 infra」的依赖方向相反。

**建议**：`LlmProtocolKind` 是纯字符串联合，下沉到 `domain/provider/model/`（或
`domain/shared/`），infra 反向 import。三个文件的改动量各 1 行。

**置信**：confirmed

---

### F-w8-llmproto-a-16 | P3 | tool-definitions.ts:1-16
```
Tool registry �?LLM tool definitions.
&#25226; registry &#37324;&#25152;&#26377;&#24037;&#33021;&#26144;&#23548;&#25104; LLM &#20391;&#23450;&#20041;&#12290;
```
**描述**：文件头注释是**双重编码损坏**——中文被转成了 HTML 数字实体
（`&#25226;` = 「将」），且第 2 行有一个 U+FFFD 替换字符（`�?`，原字符已不可恢复）。
同区 `sse-parse-errors.ts:1` 与 `tool-arguments-parse.ts:1` 带 UTF-8 BOM（`﻿/**`），
而本区其余 27 个文件无 BOM——**文件编码约定不统一**。

（`docs/apm/RULE.md` 的移动端 WebView 条目提到过「防再犯闸需同时拦 U+FFFD 与
invalid-utf8 字节」，说明仓内对 U+FFFD 有既定敏感度。）

**建议**：修 tool-definitions.ts 的注释为正常中文或英文；统一去 BOM。
（属 `docs/apm/RULE.md` 提到的编码防再犯范畴，但源文件本身仍需修。）

**置信**：confirmed（直读文件字节可见）

---

### F-w8-llmproto-a-17 | P3 | registry.ts:21-29
```ts
function ensureDefaults(fetchFn?: FetchFn): void {
  if (adapters.size > 0) { return; }   // ← 传进来的 fetchFn 被静默丢弃
```
**描述**：`getProtocolAdapter(kind, fetchFn)` 带 fetchFn 调用时，只有在
**adapter Map 为空**（进程内首次）才生效；之后任何带 fetchFn 的调用都被
`adapters.size > 0` 早退吞掉。测试里靠 `clearProtocolAdapters()` 先清
（`apps/cli/src/test/e2e-llm-fetch.ts:14`）绕过——说明这个陷阱已经被实践发现过一次，
但接口本身没做防护。

同时 `configureLlmFetch`（`:34-40`）用 `adapters.clear()` + 重建实现「替换」，
语义正确；两条路径的差异只体现在 `ensureDefaults`。

**建议**：`getProtocolAdapter` 在 `fetchFn != null && adapters.size > 0` 时按
`configureLlmFetch` 的方式重建（或直接抛错提示调用方改用 configureLlmFetch），
消除「传了没生效」的静默面。

**置信**：confirmed

---

### F-w8-llmproto-a-18 | P3 | anthropic.adapter.ts:132-134 + resolve-thinking-wire.ts:18
```ts
// anthropic.adapter.ts
max_tokens: 4096,
// resolve-thinking-wire.ts
const ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = 4096;
```
**描述**：Anthropic 的默认 `max_tokens` 常量在**两个模块各写一份 4096**
（infra adapter body 组装 / domain 预算钳制）。二者必须一致，否则
`thinking-level-presets.ts:58-62` 的
`budget = Math.min(PRESET, Math.max(1, effectiveMax - 1))` 会在
Anthropic 拒绝 `budget_tokens >= max_tokens` 时产出非法请求——
而 `effectiveMax` 取自 domain 那份，与 adapter 真正发出的 body 值之间**没有编译期或运行期关联**。

同时 `protocol-sampling-defaults.ts:25` 的 `ANTHROPIC_SAMPLING_DEFAULTS.max_tokens = 16_000`
是**第三份**「Anthropic 输出上限」语义（UI 展示/预算提示用）。
三处 4096/4096/16000 各司其职但无单一真源。

**当前一致性**：`resolveEffectiveMaxTokens`（resolve-thinking-wire.ts:40-47）在
sampling 未启用时返回 `ANTHROPIC_BODY_DEFAULT_MAX_TOKENS`(4096)，启用时取
`params.anthropic.max_tokens`；adapter 的 4096 是 sampling 未启用时的兜底。
**当前两条路径确实对齐**（未启用 → 都是 4096；启用 → 都用 params 值），
所以是**维护性风险而非现存缺陷**。

**建议**：把默认 max_tokens 收敛到 domain 一处，adapter 从
`resolveEffectiveMaxTokens` 读（或至少在 adapter 侧 import 该常量并加注释指向）。

**置信**：confirmed（当前无 bug；三处常量的漂移风险为代码事实）

---

### F-w8-llmproto-a-19 | P3 | dispatch-sse-chunk.ts:49
```ts
if (chunk.length === 0) { return; }
emit(chunk);
if (!state.firstChunkDelivered) { state.firstChunkDelivered = true; onFirstChunk?.(chunk.length); }
```
**描述**：`firstChunkDelivered` 的语义是「已投递过至少一个**非空** chunk」，
但名字与 `noteActivity`/`processedLength`（llm-sse-transport.ts:337-340）的口径不同：
后者在 XHR 分支的 `onprogress` 里会以 `noteActivity(0)` 更新（`:528`），
**即使本次没有任何新文本**。于是「首包时刻」与「首字节时刻」在 XHR 分支上可能
相差一个 progress 事件——`logSse(logTag, "xhr first chunk", {bytes})` 打的是
dispatch 层的口径，而 `stream timeout` 日志里的 `processedLength` 打的是传输层的口径，
**两个调试字段在 XHR 分支上不同源**，排查黑洞问题时容易误读。

**建议**：`noteActivity` 与 `dispatchSseChunk` 统一以「实际新增字符数」为唯一口径
（`noteActivity(0)` 保留但单独用 `lastProgressAt` 字段），或在日志里标明两字段来源。

**置信**：confirmed（代码直读；「导致误读」为推断）

---

### F-w8-llmproto-a-20 | P3 | openai.adapter.ts:148-182（textOnly 快捷路径）
```ts
private async chatTextOnly(req: LlmChatRequest): Promise<LlmChatResult> {
  ...
  const body = { model, stream: false, messages: [{role:"user", content: userText}],
                 ...(req.sampling?.protocol === "openai" ? req.sampling.openai : {}) };
```
**描述**：`useTextOnlyShortcut`（`:44-54`）在「非流式 + 无 tools + 无 system +
历史全 text」时走这条精简路径。三个可观测差异：
① **不写 `stream_options`**——非流式不需要，无影响；
② **不设 `tool_choice`**——快捷路径本就无 tools，无影响；
③ **history 被拍平成单条 user 消息**（`chatMessagesToTextOnly`，text-only-content.ts:47
   会给每条加 `${msg.role}: ` 前缀），role 结构丢失。这是**刻意的**（注释自称
   "legacy `nm model request` shortcut"），但 `nm model request` 这条 CLI 路径
   仍在（`apps/cli/src/test/e2e-llm-fetch.ts` 引用同族符号），**不是死代码**。

**已实测的边界**（探针 P34）：`extraBody.tools` 能在 textOnly 路径注入 tools
（`Object.assign(body, req.extraBody)` 在 `:163` 最后合并，覆盖一切），
但此时 `tool_choice` **不会被补上**（快捷路径不设，extraBody 也没给）——
服务端按 OpenAI 默认（`auto`）走，不算错，但 `OPENAI_TOOL_CHOICE_REQUIRED=1`
这个开关在 textOnly 路径下**完全失效**（`toolChoiceWhenToolsPresent` 只在
`buildBody` 里被调，`:137`）。

**建议**：`useTextOnlyShortcut` 增加 `req.extraBody?.tools == null` 判据，
或把 `tool_choice` 的设置提到两条路径共用的位置。

**置信**：confirmed（探针 P34 实跑；「CLI 路径仍在」由 e2e-llm-fetch.ts 引用佐证）

---

### F-w8-llmproto-a-21 | P3 | llm-sse-transport.ts:503 vs :129
```ts
xhr.timeout = SSE_WHOLE_CALL_TIMEOUT_MS;   // XHR 分支
export const SSE_WHOLE_CALL_TIMEOUT_MS = 600_000;   // 公共层 fetch 分支定时器
```
**描述**：XHR 分支靠原生 `xhr.timeout`（RN 0.85.3 → OkHttp callTimeout），
fetch 分支靠公共层 JS 定时器（`:374-379` `armWholeCallTimer`），
native 分支靠 transport 内部 callTimeout（`:426` 下发预算）。三条路径的**超时起点**
不一致：JS 定时器在 `fetchFn` 调用**之前**就 armed（`:626` 在 `:630` 之前），
而 `xhr.timeout` 是从 `send()` 起算——两者都覆盖 connect+读，语义大体对齐，
但 native 分支的起算点由 Kotlin 侧决定，core 无从校验。

**模块文档（`:20-35`）已把这一分层写清楚**，标 intentional（设计文档即如此）。
此处仅记一条维护提示：三个 600s 的实际起算点分散在三处（含 core 外的 Kotlin），
调整预算时需三处同改，`SSE_WHOLE_CALL_TIMEOUT_MS` 的「单点下发」只覆盖了**数值**，
没覆盖**起算点**。

**置信**：intentional（引用模块文档 :20-35 作为设计出处）

---

### F-w8-llmproto-a-22 | P3 | request-abort.ts:43-49
```ts
if (error instanceof ProviderError && error.code === "HTTP_ERROR" &&
    error.message.toLowerCase().includes("abort")) { return true; }
```
**描述**：`isRequestAborted` 的第三判据是**对错误消息做子串匹配**。
`llm-sse-transport.ts:577-580` 的 `xhr.onabort` 抛的正是
`ProviderError("HTTP_ERROR", "Request aborted")`，命中该子串——链路自洽。

风险面：任何**恰好包含 "abort" 子串**的 HTTP_ERROR 消息都会被误判为用户取消。
两个真实来源：
① `xhr.onload` 的非 2xx 分支（`:554-563`）把**响应体前 500 字符**拼进消息
   （`HTTP ${status}: ${snippet}`）——若供应商错误体里出现 "abort"（例如
   `{"error":"request aborted by upstream"}`），会被吞成 partial 正常完成。
② `http-util.assertOk:36-37` 有同样的 500 字符 body 拼接。

后果：`model-request.service.isRetryableError:90-95` 用**同一条子串规则**判不可重试，
两侧一致地把一次**真实的 HTTP 失败**判成「用户取消」→ 不重试 + 不报错 →
用户看到半截回复或静默失败。

**当前是否发生**：未构造出真实触发样例（三家供应商的错误文案未知），
故降为 P3 suspected。但这是**协议层把控制流决策建立在自由文本上**的结构性问题。

**建议**：把 abort 语义从消息文本提到结构化字段——`ProviderError` 加
`reason?: "aborted"`（或复用已有的 `code` 枚举新增 `ABORTED`），
`isRequestAborted` / `isRetryableError` 改判该字段，字符串匹配仅作旧数据兜底。

**置信**：suspected（机理确凿，未找到真实触发样例）

---

### F-w8-llmproto-a-23 | P3 | sse-line-buffer.ts:13-25（三处 parser 各自的 data: 前缀判定）
```ts
if (!line.startsWith("data: ")) { return; }   // openai:70 / anthropic:206 / gemini:199
```
**描述**：三家 parser 都要求 `data:` 后**恰好一个空格**。SSE 规范（WHATWG）
允许 `data:{...}`（无空格）。若某网关/代理输出无空格形态，该行被**整行丢弃**——
不是丢一个字段，是丢一整帧。

**实测**（探针 PROBE6）：
```
PROBE6 data-without-space blocks = []
```
三帧全丢，`assertSseParseSucceededOrThrow` 也不抛（`malformedLineCount===0`，
因为压根没进 JSON.parse 分支）→ 返回空 blocks 的「成功」结果。
这与 `docs/Iterations/repo-mega-cr-2026-10/registry.md:37` 记录的
`xc-proto` 机位 top 发现（「data: 无空格丢整流」）**指向同一处**——
本机位在**未读其报告**的前提下独立复现并定位到三个文件的同一行模式。

**对照**：CRLF 换行是**安全**的（探针 PROBE7 实测 `blocks=[{text:"hi"}]`），
因为 `payload = line.slice(6).trim()`（三处同）里的 `.trim()` 吃掉了 `\r`。
即：`\r\n` 有防护、`\n` 有防护，唯独 **`data:` 与 payload 之间的可选空格没有**。

**建议**：三处统一改成 `line.startsWith("data:")`，再 `slice(5).replace(/^ /, "").trim()`；
更好的做法是把这三行重复判定收进 `sse-line-buffer.ts`（`data:` 行的提取已经是
三份复制粘贴，抽成 `extractSseData(line): string | null` 一处修）。

**置信**：confirmed（探针实跑复现 + 与 registry 记录的既有发现独立撞车=双源印证）

---

### F-w8-llmproto-a-24 | P3 | 三个 adapter 的 chatStream 尾部结构重复
```ts
// openai:230-252 / anthropic:207-222 / gemini:165-180 —— 同一段 20 行逻辑三份复制
const aborted = req.signal?.aborted === true;
const finishResult = aborted ? <partialFn> : <normalFn>;
const { blocks, streamRaw, degradedToolCalls } = finishResult;
const assistantText = messageBodyTextFromContent({ blocks });
const usage = parse<X>Usage(streamRaw);
const result = { assistantText, blocks, raw: streamRaw ?? {streamed:true}, usage, ...(degraded.length>0?{degradedToolCalls:degraded}:{}) };
req.onStream?.({ type: "done", result });
```
**描述**：三份近乎逐字相同的收尾逻辑，差异只在 `parse*Usage` 与 partial 函数名。
这类复制是 F-01/F-06/F-07/F-11 这批「三家行为不一致」得以长期存在的**结构成因**——
每处不一致都要在三份副本里各改一次，漏改必然发生（事实上 openai 的
`degradedToolCalls: [] as const` 硬编码就与另两家的 `= []` 默认值写法不同源）。

**建议**：抽 `finalizeStreamResult(protocol, {blocks, streamRaw, degraded}, aborted)` 到
`logic/stream-finalize.ts`，三 adapter 各传自己的 usage parser；
或让 port 提供一个 adapter 基类/工厂收敛 `chatStream` 骨架。

**置信**：confirmed（三份代码并排可证）

---

## 争议与存疑

1. **F-04 / F-05（流内错误与 finish_reason 不参与判定）该定 P1 还是 P2？**
   我倾向 P2 的理由：错误确实被吞，但 Anthropic `type:"error"` 主要出现在
   建连阶段（此时 blocks 恒空 → 走 `assertSseParseSucceededOrThrow` 之外，
   仍不抛因为 malformed=0），实际上**空回复会以「无内容输出」占位 + FINISHED 收尾**——
   不是崩溃、不是数据损坏，是「静默失败」。定 P1 的理由：用户完全无法感知失败，
   且 `overloaded_error` 恰恰是**最该重试**的一类错误，现在既不重试也不报错。
   **保留争议，请裁决者按产品对「静默失败」的容忍度定档。**

2. **F-08（gemini image 硬抛）是否真能触达？**
   代码层面的能力缺口是确定的（另两家支持、gemini 抛错）。但我没有验证
   「存在带 image 块的 ChatMessage 历史」这一前提在当前产品里是否成立
   （本区不产 image 块，image 块的来源在别处）。若该前提不成立，本条应降 P3。
   **未解。**

3. **F-06（partial 重复 emit tool-use）的实际影响面。**
   当前两个订阅者都不消费该事件，**今天不产生用户可见缺陷**。
   我仍定 P2 而非 P3，理由是 port 契约（`adapter.port.ts:33`）明确承诺
   「每个 tool call 至多一次」，实现违反了自己写下的契约，且未来任一端开始消费
   即爆。若裁决者认为「无消费方 = 无缺陷」，可降 P3。**倾向保留 P2。**

4. **F-09（空 text 块出站）的严重度依赖外部事实。**
   「Anthropic/Gemini 会 400 拒绝空 text / 空 parts」是**依据本仓自身注释**
   （`stream-partial-blocks.ts:5`「content_json 拒绝 `text: ""`」）的推断，
   未对真实 API 验证。若实际宽松，则本条降为纯风格问题（P3）。
   另注：探针 P16 显示 gemini 空 text 产出 `parts: []`，与 anthropic 的
   `text:""` 是**同类不同形态**，我把它并入本条而非单列。

5. **`finishGeminiSse` 的兜底（:362）与 `assertSseParseSucceededOrThrow`（:360）的顺序。**
   兜底在断言**之后**，所以「全畸形 + 零块」会先抛 MALFORMED_SSE、到不了兜底；
   而「零块 + 零畸形」（F-02 的触发形态）会走兜底并静默截断。
   这个顺序本身可能是刻意的（畸形该抛、未知 part 类型该兜底），但代码无注释说明，
   **我不确定是设计还是巧合**，不列为发现，仅在此存疑。

6. **`F-23` 与既有 `xc-proto` 发现的撞车。**
   按独立性纪律我未读 `raw/w3-xc-proto.md`，仅从 `registry.md:37` 的一行摘要
   得知其 top 发现含「data: 无空格丢整流」。我的 F-23 是**先独立复现定位、
   后在写报告时查 registry 才发现撞车**。按 PLAN.md §二「一致性率：独立双扫重合的
   发现标高置信」，本条应升为高置信。**但请注意 F-23 的三文件定位与扩展
   （含 CRLF 对照、建议抽 `extractSseData` 一处修）是我这边新增的。**

7. **未覆盖的子域**：`debug-fetch.ts` 的 `summarizeBody` 只在 body 非空时返回摘要，
   但 `parsed.messages` 走 `array(n)` 脱敏、`parsed.contents` 走 partKinds 脱敏——
   唯独 `summary.model` / `summary.stream` / `summary.tool_choice` 是**原样输出**（`:83-86`）。
   `model` 不敏感，`tool_choice` 只有 "auto"/"required" 也不敏感。**判定无问题，不列发现。**

8. **`anthropicContentToBlocks` 对 `tool_use` 要求 `isRecord(item.input)`**
   （`:120`），input 非对象时**整块丢弃**（探针 P31：`blocks=[]`）。
   与 openai 的「input 缺失 → `{}`」（openai-content-mapper.ts:299）、gemini 的
   「args 非对象 → `{}`」（gemini-content-mapper.ts:261）**行为不一致**：
   anthropic 是丢弃、另两家是补空对象。同属 F-09 的「三家空/坏块处理各不相同」
   这一族，但因触发形态是「响应侧」而非「请求侧」，我未单列。**记此备查。**
