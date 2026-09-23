---
date: 2026-09-23
---

# LLM 流式超时兜底 技术规格（SPEC）

需求来源：`docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/prd.md`（用户实测 bug + 已登记遗留 bug「run 无超时挂死」，探索报告 2026-09-23）。

## 设计目标

传输层加双超时（首字/流空闲），任何失联在有限时间收敛；超时分级语义（首字前可重试/流中断不重试）；超时走既有 abort 链自愈 registry；XHR 与 fetch 双路径覆盖；零误杀。

## 总体方案

### 1. 超时原语（core 纯逻辑，可测）

`packages/core/src/infra/llm-protocol/logic/stream-watchdog.ts`（新）：

```ts
createStreamWatchdog({
  firstChunkTimeoutMs,   // 默认 120_000（导出常量，thinking 模型首字慢）
  idleTimeoutMs,         // 默认 90_000（导出常量）
  onTimeout: (phase: "first-chunk" | "idle") => void,
}): {
  noteActivity(): void;   // 收到任何响应数据（onprogress/reader.read 返回）时调用
  dispose(): void;
}
```

实现：两个 deadline 定时器（`setTimeout`）；`noteActivity` 重置 idle 定时器并撤销 first-chunk 阶段；触发时回调（**调用方负责以超时错误 settle 请求 Promise，再 abort 断流清理**，见第 2/3 节时序）。纯回调设计，传输无关，fake timers 直测。

阈值取舍：空闲 90s 覆盖慢速模型 chunk 间隔（5 t/s 下 chunk 间隔远小于秒级；thinking 静默段在 anthropic/gemini 连接建立后即有 message_start/thinking delta 持续流出，不触发）。首字 120s 真正覆盖的不是模型思考耗时——thinking 开启时 thinking delta 会作为响应数据持续到达，首字并不会静默两分钟——而是网关排队、上游建连、中转缓冲等请求建立阶段的整体静默，取保守大值避免误杀重负载时段。两常量从 core 导出，暂不做 provider 级配置（YAGNI，后续需要再开口）。

### 2. XHR 路径接入（`llm-sse-transport.ts` `postSseViaXhr`）

- 请求发出即启动 watchdog；`onprogress` 首行加 `noteActivity()`（含每次增量到达）；`onload/onerror/onabort` 与 reject/resolve 全路径 `dispose()`。
- **onTimeout 时序（关键——超时错误不得走既有 onabort reject 链）**：回调内先 `rejectOnce(new LlmStreamTimeoutError(phase))` 抢占 settle，再 `xhr.abort()` + `emitter.dispose()` 仅作断流清理。`rejectOnce` 已有 `settled` 守卫（现状 `llm-sse-transport.ts` 的 `settled` 标志，Promise settled 语义同款）：abort 触发的 `onabort` 里二次 `rejectOnce` 被守卫挡掉，`ProviderError("HTTP_ERROR","Request aborted")` 根本不会产生，超时错误得以原样上抛。若反过来只调 `xhr.abort()` 寄望 onabort 链传播超时，该错误会被 `request-abort.ts` 的 `isRequestAborted`（对 ProviderError+HTTP_ERROR+message 含 "abort" 判 true）识别为用户取消，`anthropic.adapter.ts`（gemini/openai 同构）catch 吞错返回 partial 结果——不失败、不重试、不落占位，分级语义全失效。附带调整：`rejectOnce` 参数类型从 `ProviderError` 放宽为 `Error`。
- AbortSignal（用户停止）优先级不变：signal abort → `xhr.abort()` → onabort reject `ProviderError("Request aborted")`。用户取消与 watchdog 超时天然互斥（先发生者 settle，后到者被守卫丢弃），用户取消语义零回归。

### 3. fetch 路径接入（`postSseViaFetch`，desktop/cli）

- `reader.read()` 每次返回（含空 chunk）即 `noteActivity()`。
- **onTimeout 时序与 XHR 同构**：读循环包入带 `settled` 守卫的 Promise——回调内先 `rejectOnce(new LlmStreamTimeoutError(phase))` 抢占 settle，再 `controller.abort()`（请求 AbortController）仅作断流清理。随后 `reader.read()` 抛出的 AbortError 落入已 settle 分支被丢弃（`isAbortLikeError` 对其判 true 也无机会介入），最终传播的只会是超时错误。
- Node 环境 setTimeout 正常，无后台停摆问题（桌面无后台场景）。

### 4. 超时语义分级（与既有 retry/落库链对接）

- 新错误类型 `LlmStreamTimeoutError extends Error { phase: "first-chunk" | "idle" }`（`sse-parse-errors.ts` 旁新文件或同文件），`name = "LlmStreamTimeoutError"`。
- **retryable 接入点是 `model-request.service.ts` 的 `isRetryableError`**（重试循环本体 `attempt <= policy.maxRetries && isRetryableError(error)` 与退避均在该文件）。`model-retry-policy.service.ts` 仅做策略 KV 存取（getPolicy/setPolicy），不承载判定，不改动。现状 `isRetryableError`（68-84 行）对非 ProviderError 的未知错误**默认判 true**（未知传输错误视为瞬时），故必须显式增加分支并置于该默认分支之前：`error instanceof LlmStreamTimeoutError` → `phase === "first-chunk" ? true : false`。不加此分支，idle 超时会落进默认 true 被重试，与「idle 不重试」直接矛盾。
- **错误为何不被 adapter 吞成 partial（依赖链，实施与测试须共同保持）**：现状 `anthropic.adapter.ts` 201-205 行（gemini/openai 同构）catch 中 `isRequestAborted(error, req.signal)` 为 true 时吞错、返回 partial 结果。`request-abort.ts` 的 `isRequestAborted` 对三种情形判 true：signal 已 abort、错误 name 为 AbortError、ProviderError+HTTP_ERROR+message 含 "abort"。超时错误三条全不命中——① watchdog 触发时用户的 AbortSignal 尚未 abort；② `LlmStreamTimeoutError.name` 非 "AbortError"，且经第 2/3 节的 rejectOnce 抢占后，含 "Request aborted" 的 ProviderError 根本不会产生；③ 它不是 ProviderError。因此 adapter catch 走 rethrow，错误上抛 runner 主 catch（`agent-runner.ts` 795-838 行现状成立）else 分支进入失败收尾。
- **首字前超时**（first-chunk，无任何输出）：`isRetryableError` 判 true——与 429/5xx 同列，按既有重试上限/退避执行（复用重试链，不新造）。
- **流中断**（idle，已有部分输出）：**不自动重试**（避免重复输出/重复计费）——错误上抛走 runner 主 catch → 既有失败收尾链（`[生成失败] …` assistant 占位消息 + FAILED 事件 + composer 解锁，run-fail 落消息机制（历史迭代引入，锚点见 agent-runner.ts 主 catch else 分支 :795-838）复用）。
- 超时 settle 后 runner `await` 恢复 → finally 反注册 abortRegistry——**挂死泄漏与会话门禁锁死随本修复自然消除**（探索实证：现状挂死时 finally 不执行）。

### 5. 观测（区分 provider 停流 vs 客户端不消费）

`onTimeout` 时 `NM_DEBUG_LLM_FETCH` 门控日志：`{ phase, lastActivityAt, processedLength, bufferedBytes }`——provider 停流（lastActivityAt 早、processedLength 停）与客户端不消费（processedLength 增长中）可从同一行区分。挂死事故的后续归因（服务端槽位 vs 连接池）以此为入口。

字段来源（两路径）：
- XHR：`processedLength` 用 `postSseViaXhr` 现成变量（`llm-sse-transport.ts:168`，`deliverNewText` 维护的已消费文本长度）；`bufferedBytes` 取 SSE 节流 emitter 的待发缓冲长度——`sse-chunk-emitter.ts` 需新增 `bufferedLength()` 访问器，仅暴露既有内部 `buffer` 长度，不改缓冲行为。
- fetch：读循环无现成累计变量，`processedLength` 在 `reader.read()` 循环内自行累计（`decoder.decode` 后的累计字符数）；fetch 路径即时转发、无节流缓冲，`bufferedBytes` 不适用（记 0）。

## 最终项目结构

```
packages/core/src/infra/llm-protocol/logic/
  stream-watchdog.ts                       # 新：双 deadline 原语 + 阈值常量导出
  llm-stream-timeout-error.ts              # 新：错误类型（或并入 sse-parse-errors.ts）
  llm-sse-transport.ts                     # 两路径接入（onTimeout 先 rejectOnce 抢占 settle，abort 仅作清理）
  sse-chunk-emitter.ts                     # 暴露 bufferedLength()（观测用，只读）
packages/core/src/service/provider/impl/model-request.service.ts   # isRetryableError 增加超时分支
测试: packages/core/test/infra/llm-protocol/stream-watchdog.test.ts 等
```

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `stream-watchdog.ts`（新） | 原语 + `FIRST_CHUNK_TIMEOUT_MS`/`STREAM_IDLE_TIMEOUT_MS` 导出 |
| 2 | `llm-stream-timeout-error.ts`（新） | 错误类型与 phase（name 固定 `LlmStreamTimeoutError`） |
| 3 | `llm-sse-transport.ts` | XHR/fetch 两路径 watchdog 装配；onTimeout 先 `rejectOnce(new LlmStreamTimeoutError(phase))` 抢占 settle、`xhr.abort()`/`controller.abort()` 仅作断流清理；`rejectOnce` 参数放宽为 `Error` |
| 4 | `model-request.service.ts` | `isRetryableError` 显式增加 `LlmStreamTimeoutError` 分支（置于非 ProviderError 默认 true 之前）：first-chunk → true、idle → false |
| 5 | `sse-chunk-emitter.ts` | 新增 `bufferedLength()` 供观测打点（仅暴露既有缓冲长度） |
| 6 | 观测日志 | onTimeout 打点（NM_DEBUG 门控；字段来源见第 5 节） |
| 7 | 测试 | T-T 系列 + 既有传输测试回归 |
| 8 | 文档 | CHANGELOG；已知限制（后台 watchdog 停摆、非流式不覆盖，见 PRD） |

## 详细实现步骤

- Step 1 — phase-watchdog-core — blocking: yes — qa: auto：原语 + 错误类型；T-T1/T-T2/T-T3（原语级）。
- Step 2 — phase-xhr-wiring — blocking: yes — qa: auto：XHR 路径装配（onTimeout 先 rejectOnce 抢占、abort 仅清理）；T-T1/T-T2/T-T3（集成级）+ 既有 XHR 传输用例回归。
- Step 3 — phase-fetch-wiring — blocking: yes — qa: auto：fetch 路径装配（settled 守卫同构）；T-T7。
- Step 4 — phase-retry-semantics — blocking: yes — qa: auto：`model-request.service.ts` 的 `isRetryableError` 超时分级 + adapter 不吞错（rethrow）+ runner 失败链对接；T-T4/T-T5/T-T6。
- Step 5 — phase-observability — blocking: yes — qa: auto：超时打点（测试断言日志内容 T-T9）。
- Step 6 — phase-regression — blocking: yes — qa: auto：core 全量 + mobile/desktop 定向 + typecheck。
- Step 7 — phase-manual-verify — blocking: no — qa: manual_user：真机挂死复现路径（生成中开飞行模式 10s 关闭 → run 应在阈值内收敛失败、会话可再发）；高速模型长流稳定性观察。

## 测试策略

- T-T1 — blocking: yes — 首字超时：请求后 firstChunkTimeoutMs 无 onprogress → transport promise reject `LlmStreamTimeoutError("first-chunk")`（非 "Request aborted" ProviderError），xhr.abort 随后仅作清理（fake timers）（映射 Step 1/2）
- T-T2 — blocking: yes — 空闲超时：有 chunk 后静默 idleTimeoutMs → reject `LlmStreamTimeoutError("idle")`；chunk 持续到达不触发（映射 Step 1/2）
- T-T3 — blocking: yes — 零误杀：慢节奏 chunk（间隔 < idleTimeoutMs）长流全程不触发；正常收尾 dispose 后定时器清空（无泄漏断言）（映射 Step 1/2）
- T-T4 — blocking: yes — 首字前超时经 `isRetryableError` 判 retryable 并按既有上限重试；idle 超时判不可重试（同测两分支，映射 Step 4）
- T-T5 — blocking: yes — 流中断不重试：idle 错误经 adapter rethrow（`isRequestAborted` 判 false，不吞成 partial）→ runner 主 catch → `[生成失败]` assistant 占位落库 + FAILED 事件（复用既有断言形态）（映射 Step 4）
- T-T6 — blocking: yes — registry 自愈：超时收敛后 abortRegistry 反注册（同会话 startRun 门禁放行）（映射 Step 4）
- T-T7 — blocking: yes — fetch 路径同款双超时：reject `LlmStreamTimeoutError` 而非 AbortError（Node timers，fake timers 直测）（映射 Step 3）
- T-T8 — manual_user：AC-1/AC-3 真机验证（映射 Step 7）
- T-T9 — blocking: yes — onTimeout 打点字段断言：phase / lastActivityAt / processedLength / bufferedBytes 按第 5 节字段来源口径（XHR：processedLength 取 `postSseViaXhr` 现成变量、bufferedBytes 取 emitter `bufferedLength()`；fetch：processedLength 读循环内累计、bufferedBytes 记 0）可从打点日志捕获并断言（映射 Step 5）

## 风险与回滚方案

- **误杀风险**：阈值过紧误杀慢流——默认取保守值（120s/90s）+ 零误杀测试 + 真机长流观察；阈值常量导出便于热调。
- **后台限制**：watchdog 的 setTimeout 在 RN 后台停摆（与 ③ 同根因）——后台挂死检测失效登记为已知限制；③ 交付后后台数据到达驱动推进，回前台 watchdog 恢复。不为本期目标。
- **中转层行为**：超时主动断开即释放服务端并发槽（探索候选 2 的缓解面）；若 provider 侧槽位释放有延迟，重试退避（既有）自然错峰。
- **回滚方案**：单点改动面（transport 装配 + `model-request.service.ts` retry 判定分支 + emitter 只读访问器），revert 即回到现状（挂死为既有已知行为，不劣化）。

## Context Bundle

```yaml
iteration_name: mobile-perf-2026-09 / llm-stream-timeout
requirement_path: docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/prd.md
spec_path: docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/spec.md
explore_summary: >
  超时现状四类全缺失（XHR 无 timeout、fetch reader.read 无限等、retry 只对 throw、
  AbortSignal 唯一来源是用户停止）；挂死点=agent-runner await modelRequests.request；
  挂死时 finally 不执行→abortRegistry 恒真→同会话门禁锁死（换模型成功必是新会话/先停止）。
  客户端无 per-model 状态（排除性实证）；「换模型恢复」最可能=服务端/中转 per-key/model
  并发槽被死连接占用，重启断 TCP 释放。逐 delta 链路竞态与「缓存卡住」路径已排除。
  XHR onload 同步 flush 兜底=短请求不挂、长流必挂。desktop fetch 同构。
impact_files: 见变更点清单
constraints:
  - 重试复用 model-request.service 既有循环（isRetryableError + 退避，429/5xx 口径），不新造重试框架；model-retry-policy.service 仅策略存取不改动
  - 失败落消息复用 run-fail 机制（[生成失败] 占位），不另建收尾
  - 超时错误须绕开三处既有 abort 拦截（onabort reject 链 / isRequestAborted / adapter 吞 partial），时序与依赖链见 spec 第 2/3/4 节
  - 探索报告的验证手段（飞行模式实验/PC 同 key 对照）作为 manual 验收素材
blocking_steps: [1, 2, 3, 4, 5, 6]
```
