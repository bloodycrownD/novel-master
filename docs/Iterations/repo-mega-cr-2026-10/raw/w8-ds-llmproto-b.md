---
zone: w8-ds-llmproto-b
agent: 独立双扫机位 B（domain-survey 全量测绘）
files_scanned: 30
lines_scanned: 4813
branch_base: feat/repo-mega-cr @ main 9ca5f5ad
scan_date: 2026-10-01
---

# w8-ds-llmproto-b — LLM 协议适配层测绘报告

## 摘要

`packages/core/src/infra/llm-protocol/` 是 NM 唯一与 LLM 厂商协议打交道的层：把领域层的
`ChatMessage` / `ContentBlock` 序列化成 OpenAI-Chat-Completions、Anthropic-Messages、
Gemini-generateContent 三种 wire 格式，并把 SSE 流式响应反解回统一的 `LlmStreamEvent` /
`ContentBlock`。30 个文件 4813 行，分 `ports`（1 个 port 类型）/ `impl`（三个 adapter 薄壳）/
`logic`（三套 content mapper、三套 SSE parser、SSE 传输与整流、公共小工具）。三协议共用
`postSse` 传输、`feedSseLines` 行缓冲、`buildStreamPartialBlocks` 中断快照、
`usage-parser`、`sse-parse-errors`。本报告重点核三协议之间的一致性。

## 职责与边界

**做**：请求体组装（model/messages/contents/system/tools/sampling/thinking/extraBody）、
出站合并（anthropic `mergeAdjacentUserTurns` / gemini `mergeAdjacentUserContents`，
见 RULE.md「出站合并」条目，intentional）、入站块映射、SSE 增量解析、
流中 `text-delta` / `thinking-delta` / `tool-use` / `usage` 事件发射、
用户中断时的 partial blocks 快照、HTTP/SSE 传输三分支（native → XHR → fetch）、
整调用预算超时分级、debug 日志。

**不做**：重试（`model-request.service.ts` 持有策略）、提示词拼装与 thinking 剥离
（`service/prompt/apply-thinking-context-for-llm.ts`）、token 计数、
tool 执行、消息落库、模型档位解析（`domain/provider/logic/*`）。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `LlmProtocolAdapter` / `LlmChatRequest` / `LlmStreamEvent` / `LlmChatResult` / `LlmToolDefinition` / `LlmTokenUsage` / `DegradedToolCall` | `ports/adapter.port.ts:12-121` | 端口契约；`LlmTokenUsage` 直接复用 domain `MessageUsage` |
| `getProtocolAdapter` / `configureLlmFetch` / `clearProtocolAdapters` | `logic/registry.ts:34-58` | 三 adapter 单例表 |
| `toolsFromRegistry` | `logic/tool-definitions.ts:17` | ToolRegistry → LLM 工具定义（zod→json schema） |
| `createLoggingFetch` / `redactUrl` / `isLlmFetchDebugEnabled` | `logic/debug-fetch.ts:19-144` | 装配层用 |
| `postSse` / `registerSseTransport` / `SseTransport` / `SSE_WHOLE_CALL_TIMEOUT_MS` | `logic/llm-sse-transport.ts:100-264` | 传输 port + 整调用预算 |
| `LlmStreamTimeoutError` / `LlmStreamTimeoutPhase` | `logic/llm-stream-timeout-error.ts:25-43` | 超时分级错误 |
| `STREAM_IDLE_TIMEOUT_MS` | `logic/stream-watchdog.ts:22` | **已退役**，仅 allowlist 冻结面导出（RULE.md:95） |

出口集中在 `packages/core/src/public/provider.ts:116-136`。

## 数据访问

- **表 / KKV**：无。本区不碰 SQLite、不碰 session KKV。
- **环境变量**：`OPENAI_TOOL_CHOICE_REQUIRED`（`impl/openai.adapter.ts:117`）、
  `NM_DEBUG_LLM_SSE` / `NM_DEBUG_LLM_FETCH`（`logic/sse-parse-errors.ts:20-26`、
  `logic/debug-fetch.ts:20`、`logic/llm-sse-transport.ts:195`）。
- **全局量**：`globalThis.__NM_DEBUG_LLM_FETCH__` / `__DEV__` / `XMLHttpRequest` /
  `navigator.product === "ReactNative"`（`llm-sse-transport.ts:186-203`）。
- **网络端点**（硬编码版本段，见 `http-util.ts:16` joinUrl）：
  openai `/models` `/chat/completions`（`openai.adapter.ts:75,149,185`）；
  anthropic `/v1/models` `/v1/messages`（`anthropic.adapter.ts:82,159`）；
  gemini `/models`、`/models/{id}:generateContent|:streamGenerateContent?key=…&alt=sse`
  （`gemini.adapter.ts:42,105-114`）——**gemini 的 apiKey 走 query string**。

## 依赖关系

- **import 谁**：`@/domain/chat/model/{content-block,message,message-usage}`、
  `@/domain/provider/model/{model-sampling-params,model-thinking-params}`、
  `@/domain/chat/content/{message-body-text,text-blocks}`、
  `@/domain/tool/logic/tool-registry`、`@/infra/serialization/zod-to-json-schema`、
  `@/errors/provider-errors`。区内互引：`ports ← impl ← logic`，`impl` 只做薄壳装配。
- **被谁消费**：`service/provider/impl/model-request.service.ts:16`（`getProtocolAdapter`）、
  `provider-model.service.ts:28`、`service/agent/impl/agent-runner.ts`（`toolsFromRegistry`、
  `LlmStreamEvent` 消费与补发 openai 的 usage）、`public/provider.ts` 对外导出、
  `apps/*/src/runtime/setup-llm-fetch.ts`（`configureLlmFetch` + `registerSseTransport`）、
  `packages/llm-sse-native`（`SseTransport` 契约的原生侧实现）。
- **区内共享原语**：`feedSseLines`（三 parser）、`buildStreamPartialBlocks`（三协议中断）、
  `dispatchSseChunk` + `createSseChunkEmitter`（XHR 32ms 整流）、
  `assertSseParseSucceededOrThrow` / `recordMalformedSseLine`（三 parser 共用诊断）。

## 发现清单

### F-w8-ds-llmproto-b-1 | P1 | `impl/anthropic.adapter.ts:134` + `logic/apply-thinking-to-body.ts:22`
```
      max_tokens: 4096,
...
  body.thinking = { type: ..., budget_tokens: thinking.anthropic.budget_tokens };
```
默认配置（新建已保存模型 `sampling:{enabled:false}` + `thinkingLevel:"high"`，
见 `domain/provider/model/default-saved-model-settings.ts:27-28`）下，
adapter 硬编码 `max_tokens: 4096`，而上游钳制算出
`budget_tokens = min(16384, max(1, 4096-1)) = 4095`
（`domain/provider/logic/thinking-level-presets.ts:58-62`，常量
`ANTHROPIC_BODY_DEFAULT_MAX_TOKENS=4096` 见 `resolve-thinking-wire.ts:18`）。
Anthropic 的 `max_tokens` 含 thinking 占用 → 4095/4096 只给可见正文剩 1 token；
且 low 档 preset 也是 4096，钳制后同样是 4095（三档无差别）。
建议：把 budget 定义为 max_tokens 的一部分（如 `min(preset, floor(max*0.8))`），
或 adapter 侧把默认 `max_tokens` 抬到 `budget + 输出余量`，并同步改
`resolve-thinking-wire.ts` 的镜像常量。
置信：**confirmed（算术与调用链）**；产品意图**已知为待办**——
`docs/Iterations/thinking-default-high/prd.md:66` 明确写
「修复 Anthropic 默认 `max_tokens` 下 low/medium/high 钳制相同的问题（另开迭代）」，
但该 PRD 只描述「三档钳制相同」这一症状，**未覆盖「可见输出仅剩 1 token」这个后果**，
且 `packages/core/test/provider/thinking-level-presets.test.ts:60` 把 4095 锁成了期望值。

### F-w8-ds-llmproto-b-2 | P1 | `logic/llm-sse-transport.ts:285`
```
  logSse(logTag, "→", { method, url, transport: kind });
```
Gemini 的 key 在 URL query（`gemini.adapter.ts:110`），此处**明文整条 URL 进 console**。
`isSseDebugEnabled()`（同文件 194-203）在 `__DEV__ === true` 时即返回 true —— RN debug 包
默认命中，于是 api key 落 logcat。同仓的 `logic/debug-fetch.ts:31-41 redactUrl()` 专门把
`key` 打成 `***`，两条 debug 路径口径不一致。
建议：`logSse` 走 `redactUrl(url)`，或把 gemini key 迁到 `x-goog-api-key` 头。
置信：confirmed。

### F-w8-ds-llmproto-b-3 | P1 | `logic/stream-partial-blocks.ts:36-55`
```
  if (thinking.trim() !== "") { blocks.push({ type: "thinking", text: thinking }); }
  ... blocks.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
```
中断快照把 `thinkingSignature` 全丢了：`StreamPartialToolUse` 类型里根本没有该字段
（同文件 13-17），gemini 那边 `functionCallsToToolUses` 明明把 `thinkingSignature` 带出来
（`gemini-sse-parser.ts:268-275`）却被这里静默丢弃。
实跑探针（`npx tsx --tsconfig tsconfig.test.json`）：

```
partial: [{"type":"thinking","text":"thinking..."},{"type":"tool_use","id":"f1","name":"read","input":{"path":"a.md"}}]
normal : [{"type":"thinking","text":"thinking...","thinkingSignature":"SIG"},{"type":"tool_use","id":"f1",...}]
```

同一份输入，正常收尾带签名、中断收尾不带。thinking 红档开启且偏好为「全量保留」时
（`service/prompt/apply-thinking-context-for-llm.ts:95-100`）这条 partial 消息会被原样回传，
gemini/anthropic 对无签名的 thought/thinking 块会 400。
建议：`StreamPartialInput` / `StreamPartialToolUse` 增 `thinkingSignature?`，
三个 partial 收尾函数一并透传。
置信：confirmed（行为）+ suspected（服务端是否必 400 未实测）。

### F-w8-ds-llmproto-b-4 | P2 | `logic/anthropic-sse-parser.ts:389,404-417` / `logic/gemini-sse-parser.ts:390-398`
`finishAnthropicSsePartial` 先 `flushActiveBlock`（内部已 emit 一次 tool-use，:155-160），
再把 `state.blocks` 里的 tool_use 交给 `buildStreamPartialBlocks` 又 emit 一次；
`finishGeminiSsePartial` 同样把 `functionCalls` 全量交给 `buildStreamPartialBlocks`，
**没有像正常收尾那样传 `state.emittedFunctionCallKeys`**（对比 `:352-357`）。
openai 的 partial 用 `emittedToolIndices` 守住了（`openai-content-mapper.ts:494`）。
实跑探针：

```
anthropic-mid:tool-use / anthropic-finish:tool-use
gemini-mid:tool-use   / gemini-finish:tool-use
```

违反 `ports/adapter.port.ts:32-36` 明写的「每种协议每个 tool call 至多一次」。
消费侧 `agent-runner.ts:1078-1087` 只是再发一次 `EVENT_AGENT_STREAM_TOOL_USE`
（UI 提示，不触发执行），所以后果是**中断时工具卡重复一次**而非重复执行。
建议：partial 路径复用与正常收尾相同的 emittedKeys 去重。
置信：confirmed（探针实测）。

### F-w8-ds-llmproto-b-5 | P2 | `logic/anthropic-content-mapper.ts:24-25,66-68`
```
      case "text":
        return { type: "text", text: block.text };      // 空串不设防
...
      default:
        return { type: "text", text: "" };              // 未知类型 → 空 text 块
```
另两个协议都过滤空 text：openai `openai-content-mapper.ts:103-105`、
gemini `gemini-content-mapper.ts:187-189`。Anthropic Messages API 拒收空 text 块
（400 invalid_request_error）。历史消息里若出现空 text 块（DB JSON 反序列化不做
schema 校验、`blocks` 恒非空串但元素可空），或将来新增块类型落进 `default`，
就会把空 text 发上线。另外本文件是三协议里唯一用「空 text 兜底」而非「跳过/抛错」的。
建议：`text !== ""` 才产出；`default` 改抛 `UNSUPPORTED_CONTENT`。
置信：confirmed（代码）+ suspected（空 text 的实际可达性）。

### F-w8-ds-llmproto-b-6 | P2 | `logic/gemini-sse-parser.ts:150` + `impl/gemini.adapter.ts:171`
`state.streamRaw = payload` 每块覆盖，只留最后一块；终态 usage 取
`parseGeminiUsage(streamRaw)`。末块若无 `usageMetadata`（收尾块形态多变），
整段流式 usage 全丢。对照：anthropic 双槽合并（`anthropic-sse-parser.ts:306-349`）、
openai 独立 `lastUsageEvent` 槽（`openai-sse-parser.ts:44,85-87,119`）。
建议：gemini 也留「最后一块带 usage 的 payload」槽。
置信：suspected（未构造出真实丢 usage 的 chunk 序列）。

### F-w8-ds-llmproto-b-7 | P2 | `logic/anthropic-tool-names.ts:19-24,30-33`
`canonical.replace(/\./g, "_")` 非单射：同时存在 `a.b` 与 `a_b` 时两者 wire 名都是 `a_b`
（Anthropic 侧重复工具名 → 400 或静默合并）；`wireToCanonical` 又是后写覆盖，
回程解析可能把响应里的 `a_b` 归到错误的工具上。`anthropicToolsNeedWireEncoding`
只判「有没有非法名」，不判冲突。
建议：建映射时检测 wire 名碰撞，冲突则抛错或加稳定后缀。
置信：confirmed（代码）/ suspected（触发需自定义工具名带点）。

### F-w8-ds-llmproto-b-8 | P2 | `logic/openai-content-mapper.ts:460-505`
`openAiStreamAccumulatorsToPartialBlocks` 与 `openAiStreamAccumulatorsToBlocks`（:408-457）
的 tool_use 循环几乎逐行重复，只差 degraded 记录与 `tryParseToolArgumentsJson` vs `JSON.parse`。
同文件还有一处口径不一致：`blocksFromReplyStrings:41` 用 `textRaw.trim() !== ""`，
而 `buildStreamPartialBlocks:39` 用 `text.length > 0` —— 纯空白回复在正常收尾丢块、
中断收尾留块。
建议：合并为一个带 `mode` 参数的实现，统一空判定。
置信：confirmed。

### F-w8-ds-llmproto-b-9 | P3 | 三个 adapter 的 `postSse` 调用
`anthropic.adapter.ts:198`、`gemini.adapter.ts:157`、`openai.adapter.ts:222` 第 4 参一律
`undefined`；非流式 `fetchJson(...)`（如 `anthropic.adapter.ts:160`）也没传 `providerId`。
`LlmChatRequest` 本身没有 providerId 字段，于是所有 LLM 侧 `ProviderError` 都丢 providerId。
建议：`LlmChatRequest` 增 `providerId?`，三 adapter 透传。
置信：confirmed。

### F-w8-ds-llmproto-b-10 | P3 | `logic/tool-definitions.ts:2,11-16`
文件头注释已提交乱码：字节实测 `...registry 20 efbfbd 3f 4c4c4d...`，即 U+FFFD 替换字符
+ `?`，且全文 43 处 `&#NNNN;` HTML 实体（`&#25226;` = 将）。同区其余 29 个文件扫描为 0 乱码。
建议：按 RULE「PowerShell 管道改写 UTF-8 中文文件必毁编码」重写这段注释。
置信：confirmed（字节级证据）。

### F-w8-ds-llmproto-b-11 | P3 | 死代码
- `parseOpenAiSseStream`（`openai-sse-parser.ts:125-146`）：`git grep -ln` 只有自身 +
  `test/infra/llm-protocol/openai-sse-parser.test.ts`，无生产调用方。
- `parseToolArgumentsJson`（抛错版，`tool-arguments-parse.ts:36-48`）：只有自身 + 单测，
  finish 路径全用 `tryParseToolArgumentsJson`。
- `createStreamWatchdog`：同样只有单测，但文件头已明写「已退役、无接入方」且 RULE.md:95
  记录了产品拍板 → **intentional，不当问题**。
建议：前两者删除或标注 `@internal`。

### F-w8-ds-llmproto-b-12 | P3 | `logic/registry.ts:21-29,47`
`getProtocolAdapter(kind, fetchFn)` 的 `fetchFn` 只在 `adapters.size === 0` 的首次建默认时
生效，之后换 fetch 会被静默忽略（`ensureDefaults` 首行即 return）。另 `registry.ts:4-5`
的模块注释「`configureLlmFetch` only wraps non-streaming fetch」已过期——
`openai.adapter.ts:222` 明确把 `this.fetchFn` 作为 `postSse` 的 `fetchFn` 传了下去，
流式也走被包装的 fetch。
建议：文档订正；`fetchFn` 参数改名或直接去掉（装配层已用 `configureLlmFetch`）。

### F-w8-ds-llmproto-b-13 | P3 | 三 parser 的行首判定
`anthropic-sse-parser.ts:206`、`gemini-sse-parser.ts:199`、`openai-sse-parser.ts:70`
一律 `line.startsWith("data: ")`。SSE 规范允许 `data:{...}` 无空格，此时整条响应被静默
丢弃；而 `assertSseParseSucceededOrThrow`（`sse-parse-errors.ts:47`）要求
`blocks.length === 0 && malformedLineCount > 0` 才抛 —— 无空格这种「零畸形行 + 零块」
会**静默返回空结果**，用户看到「生成成功但没有内容」。另 SSE 规范的多行 `data:` 拼接
也不支持。
建议：改成 `line.startsWith("data:")` 后 `trimStart`，并在 finish 处对
「零块且零畸形行」也给出可诊断信号。

### F-w8-ds-llmproto-b-14 | P3 | `logic/llm-sse-transport.ts:662` / `logic/openai-sse-parser.ts:140`
`decoder.decode(value, { stream: true })` 之后从未做收尾 `decoder.decode()` 冲刷，
流末尾不完整的多字节序列被丢弃。实测影响极小（只会丢半个字符），但属同一类编码尾巴问题。
建议：循环结束后补一次无参 `decode()` 并按需投递。

### F-w8-ds-llmproto-b-15 | P3 | `logic/request-abort.ts:43-48`
```
error.code === "HTTP_ERROR" && error.message.toLowerCase().includes("abort")
```
中断判定靠错误文案子串，而文案由传输层写死（`llm-sse-transport.ts:509,578,587` 的
"Request aborted"）。改文案即静默改变「中断吞成 partial vs 上抛失败」的行为。
建议：传输层抛带 `kind: "abort"` 字段的错误（契约已有先例，见 timeout 的 `kind === "timeout"`）。

### F-w8-ds-llmproto-b-16 | P3 | `logic/sse-line-buffer.ts:18-24`
`buffer` 无上限：对端若长时间不发 `\n`，字符串无界增长（本区未见任何分片上限保护）。
建议：加一个保守的分片长度上限并在超限时记诊断。

### F-w8-ds-llmproto-b-17 | P3 | `logic/gemini-content-mapper.ts:220-224`
Gemini 双向都没有图片能力：出站 `image` 块直接抛 `UNSUPPORTED_CONTENT`，
入站 `geminiPartsToBlocks`（:233-302）**完全不解析 `inlineData`**（模型返回图片时静默丢块）；
而 anthropic / openai 双向都支持图片（`anthropic-content-mapper.ts:26-40`、
`openai-content-mapper.ts:107-112,258-280`）。注释「in this iteration」像是有意为之，
但入站静默丢弃不像有意——若是有意，建议至少记一条诊断。
置信：suspected（出站抛错 intentional，入站静默丢疑似遗漏）。

### F-w8-ds-llmproto-b-18 | P3 | `logic/gemini-sse-parser.ts:122`
```
  const key = typeof fc.id === "string" && fc.id !== "" ? fc.id : fc.name;
```
Gemini 不回 `functionCall.id` 时以**函数名**做累加器 key：同一 assistant 消息里对同一
工具的两次并行调用会并进一个累加器，`argsJson` 被后一次整体覆盖（:132-137），
一次调用凭空丢失。anthropic / openai 均按 index/id 归集。
建议：无 id 时改用「同名计数器 + 出现序号」做 key。
置信：confirmed（代码）/ suspected（Gemini 是否总是回 id）。

## 争议与存疑

1. **F-1 的定级**：算术与调用链我已逐行确认，但 `thinking-default-high/prd.md:66` 把
   「Anthropic 默认 max_tokens 下三档钳制相同」列为**另开迭代的已知待办**。按 PLAN §3 我本
   应标 intentional——但那份 PRD 描述的症状（钳制相同）与代码实际产生的后果（可见输出
   仅剩 1 token）不是同一件事，后者不在任何已知待办里，且被一条单测锁死成期望值。
   我按 P1 报出并标注「产品意图已知为部分待办」，请裁决时区分这两层。
2. **F-3 的服务端行为**：无签名 thinking/thought 块是否必然 400，我没有真实 provider 可打，
   只从 `apply-thinking-context-for-llm.ts:5-7` 的注释（「body.thinking 缺失时保留任何
   thinking 块都会触发 400」）推断协议对该字段敏感。P1 定级基于「本区正常路径保留、
   中断路径丢弃」的确定不一致，而非已实测的 400。
3. **F-6 是否真会丢 usage**：gemini 每块都带 `usageMetadata` 是常见形态，我没能构造出
   末块无 usage 的真实序列，故只报 suspected。
4. **`redacted_thinking` 的中断处理**：anthropic partial 把这类块塞进 `otherBlocks` 原样
   追加（`anthropic-sse-parser.ts:410-418`），保留了签名；而 thinking 块走
   `buildStreamPartialBlocks` 丢了签名。两条路不一致是有意还是顺手写的，我没找到出处，
   按 F-3 一起处理即可。
5. **未越界核查**：本区上游（`domain/provider/logic/*` 的 thinking 钳制、
   `service/prompt/apply-thinking-context-for-llm.ts`）我只做了取证性阅读，结论已注明出处，
   未对这些文件本身作独立机位判定——它们应由对应域的机位负责。

## 附：本轮实跑证据（探针脚本，临时目录已自清）

```
cd packages/core && npx tsx --tsconfig tsconfig.test.json <probe>
```
- 中断重复 emit：`anthropic-mid:tool-use / anthropic-finish:tool-use`、
  `gemini-mid:tool-use / gemini-finish:tool-use` → F-4。
- 签名丢失：`partial` 无 `thinkingSignature`、`normal` 有 → F-3。
- 乱码字节：`tool-definitions.ts` 偏移处 `ef bf bd 3f`（U+FFFD + `?`）→ F-10。

未做任何 git 写操作；未创建/修改 `docs/apm/` 下任何文件；未读取 `raw/`、`synth/` 下任何文件。