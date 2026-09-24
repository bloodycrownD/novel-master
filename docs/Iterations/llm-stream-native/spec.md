---
date: 2026-09-25
---

# LLM 流式原生传输与渲染丝滑化 技术规格（SPEC）

需求来源：`docs/Iterations/llm-stream-native/prd.md`。
证据链：⑤ 回炉实验与源码研究（`docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/spec.md` 回炉版）、2026-09-24 JS 侧现状摸底（本文引用锚点均来自本轮源码精读）、2026-09-24 社区调研（Mattermost / okhttp-sse / streaming-markdown / Chrome 官方流式渲染指南）。

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
- ⑤ 回炉已留过渡态：XHR SSE 请求带 `Connection: close`（5826d19e）——本迭代 Step 7 撤除。

## 总体方案（分层）

```
[Kotlin] llm-sse-native：自有 OkHttpClient（读超时/callTimeout/独立池）+ native 合批（100ms | 64KB）+ postJson
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
  - `postJson(url, headersKv[], body, callTimeoutMs) → Promise<{status, contentType, body}>`
  - 事件：`LlmSseHeaders {requestId, status, contentType}` → `LlmSseChunk {requestId, text}`（合批后）→ `LlmSseDone {requestId}` / `LlmSseError {requestId, kind: "network"|"timeout"|"http", message}`
- JS 包装（~百行）：typed wrapper + `createNativeSseTransport(): SseTransport`，jest 用 mock NativeModules 直测（先例：tokenizer 包测试形态）。

### 3. core port 注入（`llm-sse-transport.ts`）

- `interface SseTransport { post(url, init, onChunk, opts): Promise<{status, contentType}>; }`（形状与 postSse 对齐，AbortSignal 走 opts）。
- `registerSseTransport(transport)` + 模块级持有；`postSse` 择优：registered native → XHR → fetch。watchdog / 整调用超时分级 / abort 语义（⑤ 回炉语义）**在三分支之上统一生效**——native 分支的 callTimeout 传 `SSE_WHOLE_CALL_TIMEOUT_MS`，ontimeout 语义由 native `LlmSseError(kind:"timeout")` 承接并映射同一 `LlmStreamTimeoutError` 分级（`processedLength>0 → idle`）。
- mobile 装配：runtime 初始化处注册（与驱动注册同址）；desktop/CLI 不注册、零变化。
- 测试：`setSseTransportOverrideForTests` 强制位（沿用 XHR override 模式），假 port 跑全量传输语义测试。

### 4. 非流式收编（用户已拍板）

- mobile 侧注册一个 **fetch shim**（native postJson 底座，实现标准 fetch Response 形状）经 `configureLlmFetch` 注入——`listModels` / `chatNonStream` 等一切非流式 fetch 零改动获得 callTimeout 与连接池；desktop 保持 undici（自带 headers/body 默认超时，登记不改）。

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
- mermaid/批注兼容：块提交 html 走既有 `prepareTranscriptRichHtml` 同一 sanitize 管线，mermaid 懒加载与批注锚点语义不变（`mermaid-core.ts` 只在 commit/历史路径触发，现状保持）。

### 7. 过渡态回收（撤 `Connection: close`）

前置条件：native 分支默认启用 + 读超时 30s 生效。撤除后回归实验（模拟器）：r1/r2 健康复用恢复（服务端日志同连接多请求）+ 死连接实验（杀服务器再发）在读超时窗口内收敛为可重试错误、无永久黑洞。任一不过则保留 close 并登记。

## 最终项目结构

```
packages/llm-sse-native/                  # 新：Kotlin 模块 + JS 包装 + register（先例三件套同构）
packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts   # port + 三分支 + 注册点
packages/core/src/service/agent/create-agent-stream-registry.ts   # 累积数组化
apps/mobile/src/services/session-stream-unit.ts                   # partialText 数组化
apps/mobile/src/components/chat/ChatTranscriptWebView.tsx         # 块感知渲染
apps/mobile/src/components/chat/ChatTranscriptBridge.ts           # streamBlockCommit 协议
apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts  # 块提交 append
apps/mobile/src/web/chat-transcript/webview/runtime/stream/block-split.ts  # 新：块边界纯函数
apps/mobile/src/services/                                  # native 装配 + fetch shim
```

## 变更点清单

| # | 文件/包 | 变更 |
|---|---|---|
| 1 | `decision.md`（新） | Step 1 评估门决策记录 |
| 2 | `packages/llm-sse-native`（新） | Kotlin 模块（sseConnect/postJson/合批/超时）+ JS 包装 + 测试 |
| 3 | `llm-sse-transport.ts` | SseTransport port + 注册 + 三分支 + native 错误映射 LlmStreamTimeoutError |
| 4 | mobile 装配 | runtime 注册 native transport + configureLlmFetch 注入 fetch shim |
| 5 | `create-agent-stream-registry.ts` / `session-stream-unit.ts` | 累积数组化（物化点收敛） |
| 6 | Bridge / ChatTranscriptWebView / stream.ts / block-split（新） | 块级渲染协议与实现 |
| 7 | `llm-sse-transport.ts`（XHR 分支） | 撤 `Connection: close`（Step 7 条件满足后） |
| 8 | release.yml | Android job 构建清单补 llm-sse-native（RULE 前科防再犯） |
| 9 | 测试/文档 | T-N 系列 + CHANGELOG + 本 spec |

## 详细实现步骤

- Step 1 — eval-gate — blocking: yes — qa: manual_agent + auto：mattermost PoC（模拟器 + mock：SSE POST/chunk 事件/abort/版本冲突核验）→ decision.md；不过即自建。
- Step 2 — native-module — blocking: yes — qa: auto：Kotlin 模块 + JS 包装（合批/超时/abort/postJson）+ mock 直测。
- Step 3 — core-port — blocking: yes — qa: auto：SseTransport port + 三分支 + 超时分级映射 + 假 port 全量传输测试。
- Step 4 — mobile-wiring — blocking: yes — qa: auto：装配注册 + fetch shim + 非流式超时收敛测试。
- Step 5 — accumulation — blocking: yes — qa: auto：registry/unit 数组化 + 物化点测试（大文本基准：10 万字符模拟流，断言无 O(n²) 时间曲线）。
- Step 6 — block-render — blocking: yes — qa: auto：block-split 纯函数单测 + webview jest（提交块 append/活跃块升级/mermaid 不回归）+ 双端手查。
- Step 7 — pool-restore — blocking: yes — qa: manual_agent：撤 Connection: close + 复用/死连接回归实验（模拟器）。
- Step 8 — e2e-hard-gates — blocking: no — qa: manual_user + manual_agent：AC-1~AC-5 硬指标验收（mock-fast 12000 丝滑 / 10 万字长文 / mock-dead 收敛 / 复用回归）+ CHANGELOG。

## 测试策略

- T-N1 — blocking — native 合批：native 层 100ms/64KB flush（fake timer/缓冲注入）；事件率上界断言（合批后 ≤ ~12/s @ 高速源）。
- T-N2 — blocking — native 超时：读超时触发 `LlmSseError(kind:"timeout")` → core 映射 `LlmStreamTimeoutError` 分级（0 数据→first-chunk 可重试）。
- T-N3 — blocking — port 三分支：registered > XHR > fetch 择优；未注册平台零变化（现有 XHR/fetch 测试全绿即证）。
- T-N4 — blocking — fetch shim：非流式请求经 postJson 底座获得 callTimeout；服务端死亡场景有限收敛。
- T-N5 — blocking — 累积数组化：registry/unit 读数正确；10 万字符模拟流的耗时曲线线性断言（性能护栏测试）。
- T-N6 — blocking — block-split 纯函数：段落/代码块/表格边界判定用例集（含未闭合语法）。
- T-N7 — blocking — webview：块提交只 append 不重渲已完成块；活跃块 350ms 升级不破坏增量岛；mermaid 懒加载仍只在 commit 触发。
- T-N8 — blocking — e2e 三幕复跑 + 硬指标（AC-1/2/4）。
- T-N9 — manual_user：真机高速模型长流体验验收。

## 风险与回滚

- **新架构兼容**：NativeModules interop（tokenizer 同款）在 bridgeless 下已验证可用；若 0.8x 升级移除 interop，届时迁 codegen（登记）。
- **块边界误判**：未闭合语法（流中代码块）误提交 → 提交块游标回退机制（commit 前校验块完整性，不完整则留在活跃块）。
- **行为回归**：渲染块级化动 richText 主链——保留全量路径开关（`streamCommit` 兜底 + feature flag 一版）。
- **回滚**：port 注册不启用即回 XHR（含 Connection: close 过渡态）；渲染改造按 commit 协议独立开关；累积数组化纯内部等价改造。

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
  - 撤 Connection: close 以 Step 7 回归实验为前置
blocking_steps: [1, 2, 3, 4, 5, 6, 7]
```
