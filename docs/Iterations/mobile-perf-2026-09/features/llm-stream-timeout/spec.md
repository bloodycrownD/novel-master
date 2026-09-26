---
date: 2026-09-24
---

# LLM 流式黑洞挂死根治 技术规格（SPEC，回炉版）

需求来源：`docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/prd.md`（回炉版）。
证据链：2026-09-24 真机裁决实验（Honor EBG-AN00）+ 模拟器黑洞复现（AVD r1-r3）+ 三路源码研究（RN 0.85.3 本地 node_modules 源码精读，npm 包自带 ReactAndroid/ReactCommon 源）。

## 终版语义修订（2026-09-26，实施后回填）

本文以下正文是 2026-09-24 回炉版的初稿语义（watchdog idle 30s 生效、`Connection: close` 无条件）。终版实现按其上位的产品拍板做了两处语义修正，以本节为准；逐条差异见下文各节的「终版修订」标注。

- **流式不设任何固定空闲超时**（`docs/apm/RULE.md:85`，产品拍板 2026-09-26）：初版的「流中 30s idle 安全网」（watchdog）在真机被 GLM 工具调用停顿误杀（服务端憋生成期间零数据），已**退役**——`stream-watchdog.ts` 原语与导出保留但**无接入方**（仅原语级单测在跑），Kotlin `readTimeoutMs` 参数仅保留 JS 接口兼容与防御性错误文案位。详见 ⑥ `docs/Iterations/llm-stream-native/spec.md` §2「实施修正记录」。后果：**无固定空闲界；死流由用户手动终止（sseAbort 链），唯一自动兜底是整调用预算**——首字黑洞的自动上限 = 单次 callTimeout 600s × 重试次数（最多 3 次尝试）≈ 30 分钟。
- **`Connection: close` 是条件化的，不是无条件**（⑦ llm-stream-native §7）：初版在 XHR 分支无条件设置该头；终版改为「逐请求运行时判定：本次走 registered native transport 时**不设**（连接池复用恢复，黑洞由整调用 callTimeout 单层兜底）；native 未注册/加载失败回落 XHR 时**保留**」。T-D3 相应从「无条件设置」断言改为**条件化断言**，主覆盖迁至 ⑦ 的 T-N3（⑥ spec T-N3 亦承接同一断言）；T-D1/T-D2 降为**原语级**用例并注明无接入方。


## 根因模型（实证，决定设计）

### P2 黑洞挂死（用户 bug 本体，本期主修）

- **四超时全零**：RN 0.85.3 `OkHttpClientProvider.kt` L49-54——connect/read/write 超时全 0（注释自认 "No timeouts by default"），callTimeout 未设置（OkHttp 默认 0=无限）；连接池走 OkHttp 默认（5 条 / 5 分钟）。
- **死连接复用防不住**：OkHttp 4.9.2 `RealConnection.isHealthy`——HTTP/1.1 仅当 `空闲 ≥10s` 才做 1ms 非阻塞探测，**「上一条流刚结束立刻发下一条」连探测都不做**；对静默半开连接（无 FIN/RST）探测返回 SocketTimeoutException 误判健康 → 复用 → 请求写入本机 TCP 缓冲即「成功」（writeTimeout=0 不报错）→ 读永久阻塞（readTimeout=0）→ XHR 四回调一个不来 → `postSseViaXhr` 的 Promise 永不 settle → run 的 await 永挂。模拟器 r3 实测：受理 → 「生成中 · 3.4s · 0 字」冻结 → 服务器复活也不自愈。
- **「换模型/重启恢复」与机制精确吻合**：换 host = 池内无候选新建连接；重启 = 进程内连接池清空。
- **abort 误重试（r3 实测新病灶）**：`isRetryableError` 对 `ProviderError("HTTP_ERROR")` 且消息中无 HTTP 状态码（如 "Request aborted"）走 `status == null → true` 分支判**可重试**——用户停止（或任何 abort 形态错误逃离 adapter 吞错窗口）会触发自动重发，重发又进同一个黑洞，形成僵尸循环。
- **计时冻结（伴生现象）**：挂死态指标条秒数停摆——`ChatStreamMetricsBarLive` 本有 250ms tick（RN 定时器），挂死时定时器停摆（RN Android 定时器由 UI 线程 Choreographer 驱动）。计时冻结随黑洞根治而消失，不单独修。

### P1 增量停摆（并存病灶，非用户主诉，登记不修）

真机流式「前 ~37s 渐进 → 中途停摆 → 尾部一次性倾泻」：RN XHR 管线每事件超线性成本（`XMLHttpRequest.js:383` 的 `this._response += responseText` 在 Hermes 无 rope 字符串下累计 O(n²) + 字符串垃圾 GC 风暴；网络事件与定时器共用 RuntimeScheduler 队列，积压后渲染/计时全冻结；流结束队列突发排空 = 尾部倾泻）。**数据最终完整、onload 最终交付，不产生挂死**。`responseText` getter 只读 JS 侧累积值（native 无部分响应查询接口），**轮询绕行不可行**——已从源码定论。根治需原生 SSE 模块（Phase 2），本期登记。

## 设计目标

消灭「高速流结束后下一次请求落入死连接黑洞」的入口（初版：连接不复用；**终版：native 分支恢复复用、黑洞由整调用 callTimeout 单层兜底，回落 XHR 路径仍不复用**，见第 1 节终版修订）；万落入（h2 等残余场景）有限时间收敛且语义分级（终版上限 ≈ 3×600s≈30 分钟，死流以手动终止为快速路径）；abort 任何形态绝不自动重试；零误杀（终版由「不存在任何空闲阈值」保证——watchdog 已退役，缓冲型慢启动与工具调用憋生成段均不受限）。

## 总体方案（两层防御 + 一处语义修正 + 一层退役留档）

### 1. 传输层防复用：`Connection: close`（XHR 回落路径；终版为条件化）

> **终版修订（2026-09-26）**：本节初稿的「无条件设置」已被 ⑦ llm-stream-native 改为**条件化**——`postSse` 逐请求运行时判定传输分支，走 registered native transport 时不设该头（连接池复用恢复，黑洞由整调用 callTimeout 单层兜底），native 未注册/加载失败回落 XHR 时才设。下方「效果：mobile 的 SSE 流式请求永不复用池内连接」为初稿语义，终版仅对**回落 XHR 路径**成立；native 分支的健康复用恢复与回落路径 close 保留由 ⑦ Step 7 双路径实验实证。

`postSseViaXhr` 在 `applyXhrHeaders` **之后**、`send` 之前补 `xhr.setRequestHeader("Connection", "close")`（置于 applyXhrHeaders 之后 = 覆盖用户 provider.headers 里的同名头，强制生效）：

- 依据：OkHttp `CallServerInterceptor` 尊重**请求侧** `Connection: close`——响应完成后 `noNewExchangesOnConnection()`，连接用完即废不回池（agent C 源码核实）；RN `NetworkingModule.extractHeaders` 无头黑名单，该头从 JS 原样到达 OkHttp。
- 效果（初稿语义，终版仅对回落 XHR 路径成立）：mobile 的 SSE 流式请求永不复用池内连接——「上一条流（尤其高速大流）留下的连接」不再被下一条请求命中，黑洞入口关闭。重试/重发也天然走新连接。
- 代价：每请求重建 TCP+TLS（约 100-300ms 首字节延迟）；LLM 请求天然秒级，可接受。仅 XHR（RN）路径设置——desktop fetch 路径不受本 bug 影响，不加。
- 已知边界：HTTP/2 下该头被协议剥离（`Http2ExchangeCodec.HTTP_2_SKIPPED_REQUEST_HEADERS`）——无效但无害；h2 黑洞由第 2 层兜底。

### 2. 整调用兜底：`xhr.timeout`（映射 OkHttp callTimeout，确定性网）

`postSseViaXhr` 在 `open` 后设 `xhr.timeout = SSE_WHOLE_CALL_TIMEOUT_MS`（新导出常量，默认 **600_000 = 10 分钟**）：

- 依据：RN 0.85.3 `NetworkingModule.kt` L412-418——`sendRequest` 收到非 0 timeout 时克隆 OkHttpClient builder 设 `callTimeout`（克隆共享池/分发器，开销极低）；JS 侧 `XMLHttpRequest.js` L614-626 透传、`_timedOut` 时 dispatch `timeout` 事件。**这是 JS 侧唯一对 h1/h2、connect/写/读全周期都生效的控制面。**
- 阈值论证：必须显著大于最长健康流——200 t/s 下 10 分钟 ≈ 120K token 单次输出，超出生成合理上限；常量导出便于调整。它不是快速响应机制（用户节奏十几秒），而是「放着不管也不会永远挂」的确定性下界；快速收敛靠第 1 层（不再落入黑洞）+ 干净的手动停止。
- **ontimeout 处理**：`emitter.dispose(); rejectOnce(new LlmStreamTimeoutError(processedLength > 0 ? "idle" : "first-chunk", SSE_WHOLE_CALL_TIMEOUT_MS))`——按「是否已收到响应数据」分级：黑洞（0 字节）→ `first-chunk` 语义（无输出无副作用，可重试，重试走新连接）；健康长流被总预算截断（有输出）→ `idle` 语义（不自动重试，走失败链）。rejectOnce 抢占 settle 后，RN 后续可能补发的 load/error/abort 回调被 settled 守卫丢弃。**终版修订**：原句首的 `watchdog.dispose()` 已随 watchdog 退役移除（原语无接入方，无实例可 dispose）；settle 守卫本身随 ⑦ 上移到 `postSse` 公共层，三分支共用。
- **fetch 路径同构兜底**：`postSseViaFetch` 内补 whole-call 定时器（`setTimeout(SSE_WHOLE_CALL_TIMEOUT_MS)` → 同款分级 rejectOnce + `controller.abort()`；所有 settle 路径清理）。desktop 无黑洞 bug 报告，此为语义对齐（同一常量、同一分级），非必须但保持双路径对称。

### 3. 流空闲安全网：watchdog 已退役（留档）

**终版（2026-09-26 产品拍板，见 `docs/apm/RULE.md:85` 与本文首节「终版语义修订」）：本节初稿的 idle 安全网整体退役**——流式不设任何固定空闲界。退役形态：

- `stream-watchdog.ts` 的**原语与导出保留**（`createStreamWatchdog` / `STREAM_IDLE_TIMEOUT_MS` 等），但**无接入方**：transport 不再装配 watchdog 实例，`noteActivity()` 调用点不再接线，`dispose()` 无实例可调——仅原语级单测（T-D1/T-D2）在跑，用于锁住原语行为本身。
- Kotlin 侧 client 级读超时恒禁用；`sseConnect` 的 `readTimeoutMs` 参数仅保留 **JS 接口兼容**与一条防御性错误文案位（`read timeout after {n}ms`，正常路径不会产生 SocketTimeoutException）。
- 触发链替代：初稿的「30s 流中静默 → `LlmStreamTimeoutError("idle")` → 不自动重试 → 既有失败链」不再存在；终版流中停顿如实等待，唯一自动收敛是整调用 callTimeout（`first-chunk`/`idle` 分级语义沿用），**死流由用户手动终止**（sseAbort 链，第 4 层保证干净）。

以下为初稿语义，**仅作历史留档，不作为终版现状**：

- ~~移除 first-chunk deadline（`FIRST_CHUNK_TIMEOUT_MS` 及其定时器删除）——用户裁决：缓冲型（非流式）模型首字可以远超任何阈值，固定首字自动杀死 = 误杀。~~（该结论在终版被进一步推广：流中空闲界同样误杀，故 watchdog 整体退役。）
- ~~`STREAM_IDLE_TIMEOUT_MS`：90_000 → **30_000**——触发 → `LlmStreamTimeoutError("idle")` → 不自动重试 → 既有失败链。~~（真机实锤误杀：GLM 工具调用默认服务端憋非流式生成、期间零数据，30s 流中界杀掉了合法停顿。）
- ~~原语 API 简化：`createStreamWatchdog({ idleTimeoutMs?, onTimeout })`，`noteActivity()` 重置 idle 定时器，`dispose()` 终态幂等；XHR `onprogress` 与 fetch `reader.read()` 返回处调用点不变。~~（API 简化保留在代码里，但已无装配方。）

### 4. abort 语义修正：任何 abort 形态绝不自动重试

`model-request.service.ts` 的 `isRetryableError` 在超时分支之后、`status == null → true` 之前显式增加：

```ts
if (
  error instanceof ProviderError &&
  error.code === "HTTP_ERROR" &&
  error.message.toLowerCase().includes("abort")
) {
  return false;
}
```

依据：`isAbortLikeError` 只认 `name === "AbortError"`，而 XHR onabort 链 reject 的是 `ProviderError("HTTP_ERROR", "Request aborted")`——一旦因时序窗口逃离 adapter 的 `isRequestAborted` 吞错（signal 晚于错误读取等竞态），现状落入「无状态码 → 默认可重试」，r3 实测即触发僵尸重试。本分支与 `request-abort.ts` 的 `isRequestAborted` 第三判据（ProviderError+HTTP_ERROR+message 含 abort）口径对齐，双向一致：adapter 视为用户取消、retry 层视为不可重试。

### 5. 观测（保留既有打点，随分级语义更新）

onTimeout/ontimeout 打点沿用 NM_DEBUG 门控，字段 `{ phase, lastActivityAt, processedLength, bufferedBytes }` 不变；whole-call 触发时 phase 按分级记录，便于区分「黑洞（0 字节超总预算）」与「健康长流超总预算（有输出）」。

## 最终项目结构

```
packages/core/src/infra/llm-protocol/logic/
  stream-watchdog.ts            # 回炉：仅 idle deadline + STREAM_IDLE_TIMEOUT_MS(30s)；终版已退役（原语与导出保留、无接入方）
  llm-stream-timeout-error.ts   # phase 语义不变（first-chunk/idle），消息文案补 whole-call 语境
  llm-sse-transport.ts          # 初版：XHR: Connection:close + xhr.timeout + ontimeout 分级；fetch: whole-call 定时器。终版：close 条件化（native 分支不设）+ settle 守卫上移公共层 + watchdog 退役，导出 SSE_WHOLE_CALL_TIMEOUT_MS
packages/core/src/service/provider/impl/model-request.service.ts   # isRetryableError 补 abort 分支
packages/core/src/public/provider.ts        # 导出面更新（去 FIRST_CHUNK_TIMEOUT_MS）
测试: packages/core/test/infra/llm-protocol/{stream-watchdog,llm-stream-timeout}.test.ts、test/provider/model-request-retry.test.ts
```

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `stream-watchdog.ts` | 初版：删首字臂与 `FIRST_CHUNK_TIMEOUT_MS`；`STREAM_IDLE_TIMEOUT_MS` 90s→30s；`onTimeout()` 无参化。**终版：整体退役**（原语与导出保留、无接入方，见第 3 节「终版修订」） |
| 2 | `llm-stream-timeout-error.ts` | 构造器加可选 `detail`（whole-call 语境文案）；phase 语义不变 |
| 3 | `llm-sse-transport.ts` | XHR：`Connection: close`（applyXhrHeaders 后）、`xhr.timeout`、`ontimeout` 分级 rejectOnce；fetch：whole-call 定时器；新导出 `SSE_WHOLE_CALL_TIMEOUT_MS = 600_000`；类型面补 `timeout`/`ontimeout` |
| 4 | `model-request.service.ts` | `isRetryableError` 补 ProviderError-abort 不可重试分支 |
| 5 | `public/provider.ts`（+allowlist 快照如有引用） | 导出面随 1/3 更新 |
| 6 | 测试 | T-D 系列（见测试策略）+ 既有 T-T 系列改造 |
| 7 | 文档 | CHANGELOG 重写；PRD/spec 回炉版；已知限制更新 |

## 详细实现步骤

- Step 1 — watchdog-rework — blocking: yes — qa: auto：原语 idle-only 化 + 常量调整；T-D1/T-D2。**终版修订**：原语改动保留，但装配方随产品拍板退役（无接入方）——本步验收口径为「原语级用例通过 + 全仓无生产装配引用」。
- Step 2 — transport-hardening — blocking: yes — qa: auto：初版为 XHR Connection:close + xhr.timeout + ontimeout 分级、fetch whole-call；**终版**为 close 条件化（native 分支不设、回落 XHR 保留）+ settle 守卫上移公共层 + watchdog 不装配；T-D3/T-D4/T-D5/T-D6（T-D3 改条件化断言，主覆盖迁 ⑦ T-N3）。
- Step 3 — retry-abort-semantics — blocking: yes — qa: auto：isRetryableError abort 分支；T-D7；回归 T-T4 形态（first-chunk 可重试/idle 不可重试，来源改为 whole-call 分级）。
- Step 4 — export-surface — blocking: yes — qa: auto：public/provider.ts + allowlist 快照同步；typecheck。
- Step 5 — regression — blocking: yes — qa: auto：core 全量 + mobile/desktop 定向。
- Step 6 — e2e-blackhole — blocking: no — qa: manual_agent：模拟器诊断构建（内嵌 bundle）+ mock 服务器走查：正常流、死服务器黑洞→停止→干净收敛、复活后重发成功（见测试策略 T-D10）。

## 测试策略

- T-D1 — blocking: yes — **原语级**（终版：无接入方，仅锁原语行为）：watchdog idle-only：有活动后静默 30s 触发；持续活动不触发；活动前无任何定时器（首字慢启动不触发）；dispose 后无泄漏（fake timers）（映射 Step 1）
- T-D2 — blocking: yes — **原语级**（终版：无接入方）：watchdog 无参 onTimeout + 自定义阈值（映射 Step 1）
- T-D3 — blocking: yes — XHR 请求头断言（**终版：条件化**）：native 分支**不设** `Connection: close`；注销 native（模拟未注册/加载失败）回落 XHR 时该头**保留**且在用户头之后调用（覆盖用户同名头）（fake XHR harness）。**主覆盖迁 ⑦ T-N3**（⑥ spec 测试策略亦承接同一断言），本文件保留回落半边的断言（映射 Step 2）
- T-D4 — blocking: yes — XHR `timeout` 属性被设为 `SSE_WHOLE_CALL_TIMEOUT_MS`（映射 Step 2）
- T-D5 — blocking: yes — ontimeout 分级：0 数据时 reject `LlmStreamTimeoutError("first-chunk")`；有数据时 `"idle"`；均不被后续 load/abort 回调顶替（settled 守卫）（映射 Step 2）
- T-D6 — blocking: yes — fetch whole-call：到点 reject 分级超时错误 + controller.abort；正常完成路径定时器被清理（fake timers）（映射 Step 2）
- T-D7 — blocking: yes — `isRetryableError`：`ProviderError("HTTP_ERROR", "Request aborted")` → false；超时错误分级判定回归（映射 Step 3）
- T-D8 — 既有 T-T 系列改造：stream-watchdog.test（去首字用例；**终版：原语级用例保留、接入方断言删除**）、llm-stream-timeout.test（XHR idle 保留、首字自动超时用例删除/改为 ontimeout 分级；**终版：watchdog 装配断言移除、close 断言改条件化**）、model-request-retry、run-agent-turn-abort-registry（语义不变应全绿）
- T-D9 — core 全量回归 + typecheck
- T-D10 — manual_agent e2e（模拟器）：(a) mock-fast 正常流完成且服务端日志显示连接不复用；(b) 杀服务器后发送 → 停止 → logcat 无自动重试 POST、run 收敛（partial/失败占位）、会话可再发；(c) 服务器复活后再发成功（新连接）

## 风险与回滚方案

- **Connection: close 代价**：每请求 TLS 重建 ~100-300ms。若用户反馈首字变慢，可将其改为「仅 RN XHR 流式请求」的开关常量（本期即仅此范围）；回滚 = 删一行。
- **xhr.timeout 误杀超长流**：600s 预算对正常生成不可达；若极端场景（超长单次生成）触及，常量可调；错误分级保证有输出时走失败链（不重发不双计费）。
- **idle 30s 误杀慢静默流（初稿风险，终版已由退役消解）**：初稿赌「流式模型 chunk 间隔远小于秒级、thinking 模型连接后有持续事件」，真机实锤失败——GLM 工具调用默认服务端憋非流式生成、期间零数据，30s 流中界杀掉合法停顿。终版按产品拍板整体退役 watchdog（见第 3 节「终版修订」），改由「无固定空闲界 + 手动终止 + 整调用 callTimeout」承接；新风险转为**死流的自动收敛上限 ≈ 3×600s≈30 分钟**，产品口径以手动终止为快速路径。
- **回滚**：变更面集中（transport 装配 + watchdog 原语 + retry 一分支），revert 即回到现状。

## Context Bundle

```yaml
iteration_name: mobile-perf-2026-09 / llm-stream-timeout
requirement_path: docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/prd.md
spec_path: docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/spec.md
evidence:
  blackhole_repro: 模拟器 r3（杀服务器→请求黑洞→计时冻结→stop 触发自动重试再黑洞→服务器复活不自愈）
  healthy_reuse: 模拟器 r1/r2（conn#1 复用正常，健康服务器下复用无恙——病灶在死连接而非复用本身）
  four_timeouts_zero: OkHttpClientProvider.kt L49-54（RN 0.85.3 本地源码）
  xhr_timeout_maps_calltimeout: NetworkingModule.kt L412-418（0.85.3 已实现，克隆 builder 开销极低）
  connection_close_honored: OkHttp CallServerInterceptor 尊重请求侧 close；h2 剥离（边界登记）
  abort_retry_bug: isRetryableError 对 ProviderError("Request aborted") 走 status==null→true
impact_files: 见变更点清单
constraints:
  - 不做首字自动超时（用户裁决：缓冲型模型零误杀）
  - **终版（2026-09-26 产品拍板，`docs/apm/RULE.md:85`）**：流式不设任何固定空闲超时（watchdog 整体退役、原语与导出保留但无接入方；Kotlin 读超时恒禁用、`readTimeoutMs` 仅接口兼容），唯一自动兜底是整调用预算（`SSE_WHOLE_CALL_TIMEOUT_MS` / Kotlin callTimeout 600s / `xhr.timeout`）；死流由用户手动终止。首字黑洞自动上限 = 单次 600s × 重试次数（最多 3 次尝试）≈ 30 分钟
  - `Connection: close` 为**条件化**：native 分支不设（连接池复用恢复）；未注册/加载失败回落 XHR 时保留（详见 ⑦ llm-stream-native §7）
  - 超时分级语义沿用 first-chunk(可重试)/idle(不重试)，来源扩展为 whole-call 分级映射
  - 失败落消息复用 run-fail 机制；重试复用 model-request 既有循环，不新造
  - P1 增量停摆登记 Phase 2（原生 SSE 模块），本期不修
blocking_steps: [1, 2, 3, 4, 5]
```
