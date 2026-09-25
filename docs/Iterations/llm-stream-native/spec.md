---
date: 2026-09-25
---

# LLM 流式原生传输与渲染丝滑化 技术规格（SPEC）

需求来源：`docs/Iterations/llm-stream-native/prd.md`。
证据链：⑤ 回炉实验与源码研究（`docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/spec.md` 回炉版）、2026-09-24 JS 侧现状摸底（本文引用锚点均来自本轮源码精读）、2026-09-24 社区调研（Mattermost / okhttp-sse / streaming-markdown / Chrome 官方流式渲染指南）。注：`llm-sse-transport.ts` 的行号锚点基于主仓 iteration-docs-20260924 当前 HEAD（不含 5826d19e）；⑤ 分支合入后行号会漂移，实施时**按符号定位**（postSse / postSseViaXhr / Empty body 防御 / Connection: close 头）。

## 根因与现状锚点（决定设计）

### P1 成本热点精确定位（按贡献排序）

1. **RN 侧每帧全量 markdown 渲染**：`ChatTranscriptWebView.tsx` 的 RAF flush（`flushPendingStreamDeltas` :463-505 / `flushPendingStreamBatch` :507-552）每次对**全量累积文本**跑 `prepareStreamTailHtml`（:484-491/:531-538 → `prepare-transcript-rich-html.ts:98-103`，markdown-it + sanitize）——O(n) per frame，n 随流增长。
2. **webview richText 路径整段替换**：RN 渲染出的全量 html 随 payload 下发（`ChatTranscriptBridge.ts:144-163` 的 `html` 字段），webview `applyTrustedHtml(body, html)` 整段替换 body innerHTML（`runtime/stream/stream.ts:243/:266`）——O(n) DOM per frame。**纯文本路径已是增量 append**（`appendEscapedDelta` :73-76，insertAdjacentHTML beforeend），且 webview 侧已有轻量 markdown（`stream-markdown.ts:28-77`）做 350ms 升级——病灶只在 rich 全量链。
3. **RN XHR 管线的原生事件风暴 + `_response +=` 累积**：native 每 chunk 一事件（`NetworkingModule.readWithProgress`），XHR JS 侧每事件 `this._response += responseText`（O(n²) + GC 垃圾）；我们 JS 侧的 32/64ms 三级合并（`session-stream-unit.ts:61-64`、`stream-apply-buffer.ts:26-27`）**够不到这一层**（合并在事件到达 JS 之后）——这是原生管子存在的根本理由：合批必须发生在过桥之前。
4. **字符串 `+=` 残留**：`create-agent-stream-registry.ts:46-59`（registry per-delta 拼接重建）、`session-stream-unit.ts:908`（`partialTextValue += seg.delta`，64ms 节拍）、webview `stream.ts:313/:320`（显示态累积）。注：**三家 SSE parser 已是数组 push + 终态 join**（`openai-sse-parser.ts:36-45`、`anthropic-sse-parser.ts:229-251`、`gemini-sse-parser.ts:143-151`），无需改。
5. **run_state 全量覆盖写**：250ms 节拍全量 `partial_text` 快照落库（`run-state-writethrough.ts:23-32`，>1MB 降频 1s）——写入量线性于文本长度×次数，大文本下的序列化成本与 4 叠加。

### 环境事实

- mobile 含 iOS 工程但发布面仅 Android（`release.yml` 无 iOS job）——原生管子按 Kotlin-only 设计，iOS 若将来发布则 port 自动回落 XHR。
- webview 构建：esbuild IIFE、`target: es2018`、minify:false（`build-webview.mjs:97-118`）——**禁新正则特性（lookbehind 等）**，引入任何 webview 侧库须过此约束。
- 原生桥接先例：tokenizer/tdbc-op-sqlite 走 NativeModules + bridgeless interop，本模块同款（无需 turbo codegen 重构）。
- ⑤ 回炉已留过渡态：XHR SSE 请求带 `Connection: close`（5826d19e）——本迭代 Step 7 **条件化撤除**（native 分支不设；回落 XHR 保留，见第 7 节）。

## 总体方案（分层）

```
[Kotlin] llm-sse-native：自有 OkHttpClient（读超时/callTimeout/独立池）+ native 合批（100ms | 64KB）+ request（非流式请求-响应，GET/POST）
    ↓ NativeEventEmitter（合批后 ~10 事件/s）
[JS wrapper] packages/llm-sse-native JS 面：requestId 匹配 → core port 回调
    ↓ 注册（先例：configureLlmFetch / registerOpSqliteDriver）
[core] llm-sse-transport 三分支择优：registered native > XHR > fetch
    ↓ 批次直喂（无整串物化）
SSE parser（增量，已就绪）→ runner（microtask 合并）→ unit 三级缓冲（32/64ms，保留）
    ↓
[累积改造点] registry 数组化 / partialTextValue 数组化（物化收敛到写库与快照）
    ↓
[渲染块级化] RN 只渲活跃尾块 → 块完成即 markdown-it 渲一次 → webview append 提交块（活跃块维持现有增量文本 + 350ms 轻量升级）
```

### 1. 买 vs 建评估门（Step 1，spike）

| 候选 | 核验项 | 已知风险 |
|---|---|---|
| `@mattermost/react-native-network-client` | POST+headers+body；响应 chunk 事件流（README 未载，须查源码 `streamRequest`/poll API）；合批可配；读超时粒度；abort；bridgeless 兼容 | 要求全局强制 OkHttp 5.3.2 + Kotlin 2.2.21（与 RN 0.85 自带 OkHttp 4.9.2 冲突风险）；iOS pod 仪式（无用但难免） |
| `expo/fetch` | 流式响应体（fetch 兼容，可直接进 fetchFn 注入位） | 无读超时/callTimeout 旋钮、chunk 粒度不可控——只解决「没有流」 |
| `react-native-sse`（binaryminds） | —— | 纯 JS 走同管线，**排除**（issue #68 Android 事件不触发） |
| **自建**（默认方向） | —— | 边界可控、三包先例（sksp/tokenizer/tdbc）；仅 Android 需求使自建面更小 |

**决策规则**：spike 用模拟器 + mock 服务器对 mattermost 客户端跑 PoC（SSE POST + chunk 事件 + abort 三项硬核验）；任一不满足或全局版本强制验证有冲突 → 自建。决策记录写入本迭代 `decision.md`。

### 2. 自建原生管子设计（Kotlin，`packages/llm-sse-native/`）

- **不用 okhttp-sse**：port 纪律是「只搬字节不认协议」——SSE 帧解析留在 core JS（三家 parser 已就绪）；raw `response.body().source()` 读循环即可，零新增依赖。
- 自有 `OkHttpClient`（独立 `ConnectionPool`；读超时默认 30s、callTimeout 默认 600s，均可 per-request 覆盖——OkHttp 克隆 builder 成本极低，RN 官方同款手法）。
- **合批**：native 读循环 append 进 StringBuilder 缓冲，100ms 定时器或 64KB 阈值先到者 flush 一次事件；flush 同时携带 `(requestId, text)`。
- Native API 面（对齐 tokenizer 的 NativeModules 模式）：
  - `sseConnect(requestId, url, headersKv[], body, readTimeoutMs, callTimeoutMs)`；`sseAbort(requestId)`
  - `request(method, url, headersKv[], body?, callTimeoutMs) → Promise<{status, contentType, body}>`——非流式请求-响应方法，`method` 取 `"GET" | "POST"`（原草案名 `postJson`，因 `listModels` 为 GET 且无 body，改名 `request` 并补 method 参数）。GET 调用不传 body（三家 `listModels` 均为 `method: "GET"` 经 `fetchJson(fetchFn, url, init)` 发出：`openai.adapter.ts:77` / `gemini.adapter.ts:46` / `anthropic.adapter.ts:85`）；POST 携带 JSON body（`chatNonStream`）。
  - 事件：`LlmSseHeaders {requestId, status, contentType}` → `LlmSseChunk {requestId, text}`（合批后）→ `LlmSseDone {requestId}` / `LlmSseError {requestId, kind: "network"|"timeout"|"http", message}`
- JS 包装（~百行）：typed wrapper + `createNativeSseTransport(): SseTransport`。
- **测试落点与先例（口径修正）**：JS 测试落在新包 `packages/llm-sse-native/test/`——wrapper 纯逻辑直测沿用 `tdbc-driver-rn/test/` 形态（`tsx --test test/**/*.test.ts`，纯逻辑、零原生依赖）；涉及 NativeEventEmitter mock 的集成形态挂 `apps/mobile` jest（`@react-native/jest-preset`，`jest.config.js:9`）。原稿「先例：tokenizer 包测试形态」失实——`tokenizer-driver-rn` 包根无任何 JS 测试文件，撤回该引用。
- **Kotlin 单测基建不为本期引入（登记）**：合批定时逻辑在 Kotlin 读循环内，`fake timer` 是 JS 概念够不到该层；现有三包中 `tdbc-driver-rn` 为纯 JS 包无 android 模块、`sksp-android` 无 `src/test`，`tokenizer-driver-rn` 的 android 模块虽带 `src/test` Kotlin 测试与 junit 依赖（`build.gradle:43-46`）但未挂载任何脚本/CI（`release.yml:128-129` 仅跑 `:app:assembleRelease`，包 `package.json` 无 gradle test 任务）。llm-sse-native 的 Kotlin 侧正确性本期以 wrapper 级 JS 测试 + Step 7/8 manual 核验覆盖（合批事件率等精度指标归 T-N8/验收），Kotlin 单测基建如需另立。

### 3. core port 注入（`llm-sse-transport.ts`）

- port 形状与 `postSse` 现签名逐参对齐（`llm-sse-transport.ts:327-333`）：
  ```ts
  interface SseTransport {
    post(url: string, init: RequestInit, onChunk: SseByteHandler,
         opts?: { providerId?: string; signal?: AbortSignal; logTag?: string })
      : Promise<{ status: number; contentType: string | null }>;
  }
  ```
  （`postSse` 的第五参 `options.fetchFn` 不进 port——port 自带传输；providerId/signal/logTag 语义与现 `PostSseOptions` 一致。）
- `registerSseTransport(transport)` + 模块级持有；`postSse` 择优：registered native → XHR → fetch，**逐请求运行时判定**（每次调用时检查注册位，非进程启动时定死——native 未注册/加载失败时同进程内自动回落 XHR，这是第 7 节条件化撤除 close 的前提）。
- **watchdog / 整调用超时上移的重构边界（一句话）**：⑤ 回炉版把 watchdog、whole-call 定时器、`rejectOnce` settle 守卫分别内嵌在 XHR 分支（`createStreamWatchdog` 装配 / `xhr.timeout = SSE_WHOLE_CALL_TIMEOUT_MS` / `Connection: close`）与 fetch 分支（controller + whole-call `setTimeout`）里，两份时序逻辑同构重复；本迭代将其**上移到 `postSse` 公共层**（三分支共用同一 watchdog 实例与 settle 守卫，分支内只留传输专属清理——XHR abort / fetch reader.cancel / native sseAbort）。既有 T-T 系列用例（依赖迭代 `llm-stream-timeout` spec 的 T-T1~T-T9，含 watchdog 原语级与双分支集成级）随上移迁至 port 公共层测试，断言语义不变，并为 native 分支补同一套时序用例；native 分支的 callTimeout 传 `SSE_WHOLE_CALL_TIMEOUT_MS`，ontimeout 语义由 native `LlmSseError(kind:"timeout")` 承接并映射同一 `LlmStreamTimeoutError` 分级（`processedLength>0 → idle`）。
- mobile 装配：runtime 初始化处注册（与驱动注册同址）；desktop/CLI 不注册、零变化。
- 测试：`setSseTransportOverrideForTests` 强制位（沿用 XHR override 模式），假 port 跑全量传输语义测试。

### 4. 非流式收编（用户已拍板）

- mobile 侧注册一个 **fetch shim**（native `request` 底座，实现标准 fetch Response 形状）经 `configureLlmFetch` 注入——`listModels` / `chatNonStream` 等一切非流式 fetch 零改动获得 callTimeout 与连接池；desktop 保持 undici（自带 headers/body 默认超时，登记不改）。
- **method 分发**：shim 按 `init.method` 分发到 native `request(method, ...)`——GET 不传 body（`listModels` 三家均为 GET：`openai.adapter.ts:77` / `gemini.adapter.ts:46` / `anthropic.adapter.ts:85`），POST 携带 JSON body（`chatNonStream` 走 `fetchJson` 的请求-响应形态，不引入流式语义）。
- **装配点与 dev logging 组合（写死）**：现状 `setup-llm-fetch.ts:19-21` 仅 `__DEV__` 下 `configureLlmFetch(createLoggingFetch(globalThis.fetch))`（`registry.ts` 注释亦载明 configureLlmFetch 只包装非流式 fetch 面）。本迭代改为**生产/开发统一注册 shim**：`ensureLlmFetchConfigured` 无条件 `configureLlmFetch(shim)`；`__DEV__` 下组合顺序定为 **logging 最外层包 shim**（`createLoggingFetch(shim)`——dev 日志覆盖全部非流式流量，包括走 native 底座的请求；shim 内部保持零组合逻辑）。生产构建 logging 不参与。
- **流式消费边界（登记）**：`configureLlmFetch` 重建三家 adapter 时注入的 fn 会成为 adapter 的 `this.fetchFn`，而 `chatStream` 调 `postSse` 时把它经 `options.fetchFn` 传入（`openai.adapter.ts:222`，gemini/anthropic 同构）——理论上 shim 可流入 fetch 分支（`postSseViaFetch:280` 取 `options?.fetchFn ?? globalThis.fetch`）。shim **不承载流式**：返回的 Response 不提供 body 流（body 置 null），一旦被流式消费误用即命中既有「Empty streaming response body」防御（`llm-sse-transport.ts:286-293`）抛明确 ProviderError，不做静默挂起；且 mobile 上 transport 择优 native > XHR > fetch，XHR 分支常驻可用，fetch 分支正常不会被选中。

### 5. 累积改造（锚点精确）

| 位置 | 现状 | 改法 |
|---|---|---|
| `create-agent-stream-registry.ts:46-59` | per-delta `text + delta` 重建 entry | parts 数组 push；`getPartial` 物化 join（读频低） |
| `session-stream-unit.ts:908` | `partialTextValue += seg.delta`（64ms） | segments 数组追加；物化点收敛到 writethrough/快照 |
| `stream.ts:313/:320`（webview 显示态） | `+=` per delta | 数组追加，块提交/升级时物化（低优先） |
| run_state writethrough | 250ms 全量覆盖（>1MB 已降 1s） | 保持节拍；载荷从数组物化（join 一次），大文本下垃圾量下降；全量覆盖语义不变（水合依赖） |

parser 三家不动（已数组化）；`streamTextAccumRef`（RN 侧全量累积，供 rich 渲染）随第 6 节块级化自然退役为「当前活跃块累积」。

### 6. 渲染块级化（richText 病灶根治）

- **协议扩展**（`ChatTranscriptBridge.ts`）：新增 `streamBlockCommit {kind, html}`——某 markdown 块完成时由 RN 渲染一次并下发；`streamDelta/streamBatch` 保留但 `html` 字段**只在活跃尾块范围内**（不再全量）。
- **RN 侧**：`prepareStreamTailHtml` 改造为块感知——维护「已提交块游标」，每帧只对活跃尾块跑 markdown-it；块边界判定（空行/代码块闭合/表格闭合）收敛为纯函数可单测。全量渲染仅发生在 `streamCommit`（收尾兜底）。
- **webview 侧**：`applyTrustedHtml` 的整段替换退役为「块提交 append」（`insertAdjacentHTML` 到 body 容器尾）；活跃块维持现有纯文本增量 append + 350ms 轻量 markdown 升级（已就绪，`stream-markdown.ts`）。已完成消息零重渲（现有增量岛机制不变，`stream.ts:14-17` 注释约束继续有效）。
- `streaming-markdown`（thetarnav，3kB gzip）登记为**备选**：现有自研轻量 markdown + 块提交模式已覆盖其核心价值；仅当块判定/尾块渲染实现遇阻时评估引入（须过 es2018/无 lookbehind 约束）。
- **超限判定块级化语义（与既有 `RICH_CONTENT_MAX_CHARS` 的交互）**：现状 `prepareStreamTailHtml` 对**全量累积文本**判定超限（`isRichContentOverLimit`：`content.length > 12_000`，`rich-content-limits.ts:2/:13`；超限返回 `undefined` 整体降级纯文本，`prepare-stream-tail-html.ts:13`）。若块级化后维持全量判定，AC-2 的 10 万字场景在累计越过 12k 那一刻起全程纯文本——块级 rich 改造对主场景不生效。因此超限判定改为**按块**：流中每帧只对活跃尾块判定（`prepareStreamTailHtml` 的输入从全量累积改为活跃块文本），**单块超限仅该块降级纯文本**，已提交块的 html 不受影响；块边界（空行/代码块/表格闭合）天然限制单块长度，正常块远低于 12k，无空行超长段落整块降级可接受。一致性口径：
  - `streamCommit` 收尾：payload 仍是 `{rows, scrollIntent}`（`ChatTranscriptWebView.tsx:865-869`），终态行经 snapshot/append 管线按**历史路径**渲染；
  - 历史路径**全量 12k 语义同步不改**（`MessageList.tsx:109` 与 snapshot 路径共用 `isRichContentOverLimit` 全量判定）：10 万字终态行整体降级纯文本——避免终态（冷启动/翻页/回读）一次性 10 万字 markdown 渲染成本，且历史路径零改动；流中已渲染块由 webview 增量岛保护（已完成消息零重渲，`stream.ts:14-17` 约束），收尾不发生「rich 回退纯文本」的视觉跳变；
  - 换言之：**流中按块判定（主场景 rich 生效），终态重渲路径维持全量降级既有语义**——两条判定共存，改面收敛在流式链路内。
- mermaid/批注兼容：块提交 html 走既有 `prepareTranscriptRichHtml` 同一 sanitize 管线，mermaid 懒加载与批注锚点语义不变（`mermaid-core.ts` 只在 commit/历史路径触发，现状保持）。

### 7. 过渡态回收（`Connection: close` 条件化撤除）

- **撤除形态是条件化的，不是全局删除**：`postSse` 逐请求运行时判定传输分支（第 3 节）——本次请求实际走 native 分支时不设 `Connection: close`（native 管子自带读超时 30s + callTimeout，首字与流中黑洞均有界）；运行时判定 **native transport 未注册/加载失败回落 XHR 时仍设 close**。理由：idle watchdog 构造时不武装、首个响应数据到达才启动空闲 deadline（`stream-watchdog.ts`——缓冲型模型首字可远超阈值的 ⑤ 回炉拍板），首字阶段的黑洞在 XHR 分支唯一兜底是 `xhr.timeout = SSE_WHOLE_CALL_TIMEOUT_MS`（600s）——若无 close 头，「高速流后死连接复用」黑洞会以 **10 分钟形态**回归，比过渡态前的永久挂起更隐蔽。close 头的设置从 XHR 分支无条件语句改为「XHR 分支且 native 未注册」条件语句。
- 前置条件与回归实验（模拟器）：native 分支默认启用 + 读超时 30s 生效后，跑两组实验——native 注册路径：r1/r2 健康复用恢复（服务端日志同连接多请求）+ 死连接实验（杀服务器再发）在读超时窗口内收敛为可重试错误、无永久黑洞；回落路径（注销 native 模拟未注册）：请求头仍带 close（T-N3 断言），死连接场景由 close + xhr.timeout 兜底不回归。任一不过则整体保留 close 并登记。

## 最终项目结构

```
packages/llm-sse-native/                  # 新：Kotlin 模块 + JS 包装 + register（先例三件套同构）
packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts   # port + 三分支 + 注册点
packages/core/src/service/agent/create-agent-stream-registry.ts   # 累积数组化
apps/mobile/src/services/session-stream-unit.ts                   # partialText 数组化
apps/mobile/src/components/chat/ChatTranscriptWebView.tsx         # 块感知渲染
apps/mobile/src/components/chat/ChatTranscriptBridge.ts           # streamBlockCommit 协议
apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts  # 块提交 append
apps/mobile/src/web/chat-transcript/stream/block-split.ts  # 新：块边界纯函数（实施位置自 webview/runtime/stream/ 上移一级——tsconfig.build.json composite 工程排除 src/web/**/webview/**，RN 侧引用该目录必 TS6307；webview esbuild 侧不引用它）
apps/mobile/src/services/                                  # native 装配 + fetch shim
```

## 变更点清单

| # | 文件/包 | 变更 |
|---|---|---|
| 1 | `decision.md`（新） | Step 1 评估门决策记录 |
| 2 | `packages/llm-sse-native`（新） | Kotlin 模块（sseConnect/request(GET/POST)/合批/超时）+ JS 包装 + 测试（包内 test/ 直测 + apps/mobile jest 集成） |
| 3 | `llm-sse-transport.ts` | SseTransport port + 注册 + 三分支 + native 错误映射 LlmStreamTimeoutError |
| 4 | mobile 装配 | runtime 注册 native transport + configureLlmFetch 注入 fetch shim（生产也注册；__DEV__ 下 logging 最外层包 shim，见 §4） |
| 5 | `create-agent-stream-registry.ts` / `session-stream-unit.ts` | 累积数组化（物化点收敛） |
| 6 | Bridge / ChatTranscriptWebView / stream.ts / block-split（新） | 块级渲染协议与实现（含超限判定按块，见 §6） |
| 7 | `llm-sse-transport.ts`（XHR 分支） | `Connection: close` 条件化撤除：native 分支不设；运行时判定 native 未注册回落 XHR 时保留（Step 7 双路径回归实验） |
| 8 | release.yml | Android job 构建清单补 llm-sse-native（RULE 前科防再犯） |
| 9 | 测试/文档 | T-N 系列 + CHANGELOG + 本 spec |

## 详细实现步骤

- Step 1 — eval-gate — blocking: yes — qa: manual_agent + auto：mattermost PoC（模拟器 + mock：SSE POST/chunk 事件/abort/版本冲突核验）→ decision.md；不过即自建。
- Step 2 — native-module — blocking: yes — qa: auto：Kotlin 模块 + JS 包装（合批/超时/abort/request(GET/POST)）+ mock 直测（包内 test/ + apps/mobile jest）。
- Step 3 — core-port — blocking: yes — qa: auto：SseTransport port + 三分支 + watchdog/whole-call 上移 + 超时分级映射 + 假 port 全量传输测试。
- Step 4 — mobile-wiring — blocking: yes — qa: auto：装配注册（native transport + fetch shim 生产注册、__DEV__ logging 最外层）+ 非流式超时收敛测试。
- Step 5 — accumulation — blocking: yes — qa: auto：registry/unit 数组化 + 物化点测试（大文本基准：10 万字符模拟流，断言无 O(n²) 时间曲线）。
- Step 6 — block-render — blocking: yes — qa: auto：block-split 纯函数单测 + webview jest（提交块 append/活跃块升级/mermaid 不回归）+ 双端手查。
- Step 7 — pool-restore — blocking: yes — qa: manual_agent：`Connection: close` 条件化撤除 + 复用/死连接双路径回归实验（模拟器：native 注册路径 + 未注册回落 XHR 路径）。
- Step 8 — e2e-hard-gates — blocking: no — qa: manual_user + manual_agent：AC-1~AC-5 硬指标验收（mock-fast 12000 丝滑 / 10 万字长文 / mock-dead 收敛 / 复用回归）+ CHANGELOG。

## 测试策略

- T-N1 — blocking — wrapper 传输链路（可测性路径，见 §2 登记）：mock NativeModules/NativeEventEmitter 高速注入 `LlmSseChunk` 事件（fake timer 驱动 JS 侧时间），断言 requestId 匹配、事件 1:1 透传到 port `onChunk`（无丢失/重复/放大）、`LlmSseError` → transport 错误映射。native 合批精度（100ms/64KB 阈值、事件率 ~10/s）**不在 JS 侧断言**——归 Step 7/8 manual 核验并写入 T-N8 与 AC-1 验收（mock-fast 高速流下观测事件率）。
- T-N2 — blocking — native 超时：读超时触发 `LlmSseError(kind:"timeout")` → core 映射 `LlmStreamTimeoutError` 分级（0 数据→first-chunk 可重试）。
- T-N3 — blocking — port 三分支：registered > XHR > fetch 择优；未注册平台零变化（现有 XHR/fetch 测试全绿即证）；**条件化撤除断言**——native 分支请求不带 `Connection: close`；注销 native（模拟未注册/加载失败）回落 XHR 时该头**保留**（首字黑洞仍由 close + `xhr.timeout` 兜底，见 §7）。
- T-N4 — blocking — fetch shim：非流式请求经 native `request` 底座获得 callTimeout；GET 分发（listModels 无 body）与 POST 分发各一例；服务端死亡场景有限收敛；shim 被流式误用时命中 Empty body 防御抛错（§4 边界）。
- T-N5 — blocking — 累积数组化：registry/unit 读数正确；10 万字符模拟流的耗时曲线线性断言（性能护栏测试）。
- T-N6 — blocking — block-split 纯函数：段落/代码块/表格边界判定用例集（含未闭合语法）；**超限判定按块**——单块 >12k 仅该块 html 降级（undefined）、已提交块不受影响；<12k 多块流各块均 rich；终态/历史行全量 >12k 仍整体降级（既有语义回归断言）。
- T-N7 — blocking — webview：块提交只 append 不重渲已完成块；活跃块 350ms 升级不破坏增量岛；mermaid 懒加载仍只在 commit 触发。
- T-N8 — blocking — e2e 三幕复跑 + 硬指标（AC-1/2/4）；native 合批精度 manual 核验：mock-fast 高速流下事件率观测（合批后 ~10 事件/s 量级，T-N1 不在 JS 侧断言的部分在此收口）。
- T-N9 — manual_user：真机高速模型长流体验验收。

## 风险与回滚

- **新架构兼容**：NativeModules interop（tokenizer 同款）在 bridgeless 下已验证可用；若 0.8x 升级移除 interop，届时迁 codegen（登记）。
- **块边界误判**：未闭合语法（流中代码块）误提交 → 提交块游标回退机制（commit 前校验块完整性，不完整则留在活跃块）。
- **行为回归**：渲染块级化动 richText 主链——保留全量路径开关（`streamCommit` 兜底 + feature flag 一版）。
- **回滚**：port 注册不启用即回 XHR（条件化撤除保证回落路径 `Connection: close` 自动恢复，见 §7）；渲染改造按 commit 协议独立开关；累积数组化纯内部等价改造。

## Context Bundle

```yaml
iteration_name: llm-stream-native
requirement_path: docs/Iterations/llm-stream-native/prd.md
spec_path: docs/Iterations/llm-stream-native/spec.md
dependency: [mobile-perf-2026-09]
evidence:
  p2_fixed_by: mobile-perf-2026-09/llm-stream-timeout 回炉版（5826d19e，Connection:close 过渡态）
  p1_hotspots: RN 每帧全量 markdown-it（ChatTranscriptWebView.tsx:484-491/:531-538）+ webview rich 整段 innerHTML（stream.ts:243/:266）+ XHR 事件风暴（readWithProgress per chunk，JS 合批够不到）
  accumulators: registry（:46-59）/ unit partialTextValue（:908）/ webview state.stream（:313）；parser 三家已数组化无需改
  community: Mattermost 同动机自建网络层；okhttp-sse 官方库；Chrome 官方流式渲染指南（append-only 块渲染）；streaming-markdown 3kB 备选
constraints:
  - port 只搬字节不认协议（SSE 帧解析留 core）；不用 okhttp-sse 的帧解析
  - Kotlin-only（发布面 Android）；iOS 工程存在但不发布，port 回落 XHR
  - webview es2018/无 lookbehind；mermaid/批注兼容
  - desktop/CLI 零行为变化；非流式 desktop 不收编（undici 自带有界超时）
  - 撤 Connection: close 为条件化（仅 native 分支不设；回落 XHR 保留），以 Step 7 双路径回归实验为前置
blocking_steps: [1, 2, 3, 4, 5, 6, 7]
```
