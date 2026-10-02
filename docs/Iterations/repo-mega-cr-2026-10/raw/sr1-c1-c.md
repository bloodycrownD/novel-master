---
zone: fix-spec/wave-c1
agent: sr1-c1-c（readonly reviewer · 组 C = C1-11 / C1-12 + core-runtime 债务池抽验）
files_scanned:
  - docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一章 + 第四章）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-c1.md（C1-11 / C1-12 / N-4 / N-5 / N-6 / N-7）
  - docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md（§3 / §6 #11 / §6 #12）
  - docs/Iterations/repo-mega-cr-2026-10/synth/core-runtime.md（P2 表 / P3 表）
  - docs/apm/RULE.md（:100 / :124 / :129 三条）
  - packages/llm-sse-native/android/src/main/java/com/novelmaster/llmsse/LlmSseModule.kt
  - packages/llm-sse-native/{src/transport.ts,src/native.ts,src/types.ts}
  - packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerModule.kt
  - packages/sksp-android/android/src/main/java/com/novelmaster/sksp/SkspModule.kt
  - packages/sksp-android/{src/android-secret-store.ts,src/native.ts,test/android-secret-store.test.ts,test/rn-mock-hook.mjs,package.json}
  - packages/core/src/infra/llm-protocol/logic/{llm-sse-transport.ts,llm-stream-timeout-error.ts}
  - packages/core/src/infra/sksp/impl/base-sqlite-secret-store.ts
  - packages/core/src/service/provider/impl/model-request.service.ts
  - packages/core/src/domain/tool/builtin/subagent-tool.ts
  - packages/core/src/domain/agent/logic/{doom-loop.ts,validate-agent-tool-policy.ts,resolve-agent-tool-registry.ts,generate-agent-run-id.ts}
  - packages/core/src/domain/agent/model/agent-definition.schema.ts
  - packages/core/src/domain/session-run-state/repositories/impl/sqlite-session-run-state.repository.ts
  - packages/core/src/service/agent/impl/agent-runner.ts
  - packages/core/src/service/agent/logic/run-agent-turn.ts
  - packages/core/test/infra/llm-protocol/llm-sse-transport{,-port}.test.ts
---

# sr1 · wave-c1 组 C 只读审查（C1-11 / C1-12 + core-runtime 债务池抽验）

## 摘要

两条 Kotlin 侧条目的**病症判定全部成立，证据行号逐字精确，字节码级结论由我独立复现**；
但两条的**修法与验收各有硬伤**：C1-11 的 `userAborted` 标记在用户 abort 路径上**必然泄漏**
（spec 自己的 I4 断言会失败），C1-12 的核心验收 I1 **在修复前后测不出差异**（无牙齿）。
债务池抽 14 条（core-runtime 52 条的 26.9%），定级全部合理、无已修，但有 2 条已被本分片
C1-3/C1-4 认领却仍留在债务池（重复立项）。

---

## 一、逐条 verdict 表

### C1-11 · §6 #11 Kotlin SSE `call.isCanceled()` 闸门把 callTimeout 静默吞掉

| 七要素 | verdict | 核对结论 |
|---|---|---|
| 病症 | ✅ **成立** | 见下方「独立复现」。且 spec 的关键发现（`:433` 闸门在当前代码里只可能由 OkHttp 内部 cancel 触发，注释语义与实际相反）**比台账更精确，我确认它是对的** |
| 证据 | ✅ **精确** | 引文块 `:417/:423/:424-425/:432/:433/:434/:436` 与源码**逐行逐字一致**；`sseAbort` 的 `:176/:177/:179`、`:167-169` finally、`:78`、`:83-85`、`:99-102`、`:445-457` 全部在位 |
| 修法 | ❌ **not-ready** | M1 / M2 / M3（见 must-fix 表） |
| 验收 | ❌ **not-ready** | M4 / M5（I4 因 M1 必然失败；I1 的黑洞 URL 不稳） |
| 测试策略 | △ **可接受** | 「不新建 Kotlin 测试基建」的判断成立（llm-sse-native 确无 `src/test`，全仓只有 `tokenizer-driver-rn/android/src/test`）；debug 计数日志方案与 I4 对得上 |
| 回归线 | ✅ **实存** | `packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts` 与 `-port.test.ts` 均在位；`apps/mobile/package.json` `"test": "jest"` 在位；`test:fast` script 在位 |
| 依赖 | ✅ **闭合** | 「无前置」正确；与 C1-12 同 PR 的建议成立（同 Kotlin 主题、同一真机验收窗口） |

**独立复现（字节码）**——不采信 raw 报告，我自己对 gradle 缓存里的两个 okhttp 版本各跑一次：

```
$ javap -p -c -classpath .../okhttp-4.9.2.jar 'okhttp3.internal.connection.RealCall$timeout$1'
public final class okhttp3.internal.connection.RealCall$timeout$1 extends okio.AsyncTimeout {
  protected void timedOut();
       0: aload_0
       1: getfield      #15   // Field this$0:.../RealCall;
       4: invokevirtual #18   // Method okhttp3/internal/connection/RealCall.cancel:()V
```
4.12.0 逐字节同构（`invokevirtual #22 RealCall.cancel`）。⇒ **callTimeout 到点 ⇒ `RealCall.cancel()` ⇒ `isCanceled()` 为 true**，raw 的实测结论成立。

**后果链逐跳核对（全部在位）**：

1. `LlmSseModule.kt:174-183` `sseAbort` 的顺序是 `streams.remove`(176) → `calls.remove`(177) → `call?.cancel()`(179)。
   ⇒ 用户主动 abort 时 `streams[requestId]` **已经是 null**，`handleStreamFailure` 在 `:424-425` 提前 return。
   ⇒ **`:433` 闸门在用户 abort 路径上不可达**——spec 这个「⭐关键发现」我确认成立。
2. `packages/llm-sse-native/src/transport.ts:168-178` 的 `finish()` 是 `routes.delete(requestId)` 的**唯一**入口，
   而 `finish` 只被 `onDone`/`onError`/`onAbort` 调用 ⇒ 事件不来则 routes 泄漏 + Promise 永不 settle。**确认**。
3. `llm-sse-transport.ts:301-303` 注释「native 用 transport 内 callTimeout，避免双触发竞态」**逐字在位**；
   `armWholeCallTimer()` 的唯一调用点是 `:626`（`runFetch` 内），`runNative`(`:389-454`) 不调。**确认 JS 侧无兜底定时器**。
4. `isTransportTimeoutError`(`:249-255`) 只认 `name === "LlmSseTimeoutError" || kind === "timeout"` ⇒ 修好后必须发 `kind:"timeout"` 才判得中。**确认 I1 的 kind 断言是必要的、也是可达的**（`parseErrorEvent` 在 `llm-sse-native/src/transport.ts:332` 白名单含 `"timeout"`）。
5. 重试分级：`model-request.service.ts:78-79` `error instanceof LlmStreamTimeoutError → return error.phase === "first-chunk"`；
   `DEFAULT_RETRY_POLICY.maxRetries = 2`(`:52-57`) ⇒ **I2「至少尝试 2 次」可达**。
6. `classifyError` 的两个 timeout 入口不可达：client 级 `readTimeout(0)`(`:78`) 恒禁用；`SocketTimeoutException` 分支确不可达
   （另注：OkHttp `Builder` 默认 `connectTimeout/readTimeout` 均为 10s，本模块未覆写 connectTimeout，但 callTimeout 600s > 10s，
   故真要命中 connect 也会先撞 callTimeout——不影响结论）。

---

### C1-12 · §6 #12 `SkspModule` 无 Executor，内联阻塞原生队列

| 七要素 | verdict | 核对结论 |
|---|---|---|
| 病症 | △ **成立但受害面需收窄** | 「`@ReactMethod` 内联 + 阻塞式系统调用」成立（RULE:124 的 2026-09-30 事故是本仓自证）。但**主路径上 `sksp` 与 `sseConnect` 是串行前后关系，不是队列争用**，spec 的受害面描述需改写（见 M6） |
| 证据 | ✅ **精确** | `SkspModule.kt` 引文 `:48-64` / `:66-82`、`:25` `String.format`、`:30`/`:70` `load(null)`、`:45` `generateKey()`、`:52` `getOrCreateKey()` **逐行在位**；文件 83 行、`import` 段零 `java.util.concurrent` **确认**。`TokenizerModule.kt:18-24` 事故注释**逐字在位**、executor 在 `:30-32`、`executor.execute`(`:43`)/`resolve`(`:50`)/`reject`(`:53`) **全部在位** |
| 修法 | ❌ **not-ready** | M7（修法 4 自相矛盾）+ S1（修法 3 未覆盖 `getOrCreateKey`） |
| 验收 | ❌ **not-ready** | M6（I1 无牙齿） |
| 测试策略 | △ **可接受** | 「不新建 Kotlin 基建」判断同 C1-11，成立。JS 侧复用 `android-secret-store.test.ts` 的说法**核实为真**（该文件确实用 `__RN_NATIVE_MODULES__.SkspModule` 桩、确实纯 base64 直通、确实不碰 Kotlin） |
| 回归线 | ✅ **实存** | `packages/sksp-android/package.json` 有 `"test": "tsx --test test/**/*.test.ts"`（I6 的「若该包有 test script」= **有**）；`test/android-secret-store.test.ts` + `test/rn-mock-hook.mjs` 均在位；mobile `"test": "jest"` 在位 |
| 依赖 | ✅ **闭合** | 「无前置」正确；同 PR 建议 + 「不要合并成顺手重构」的告诫成立（回滚粒度确实必须独立） |

**主路径时序核对（这是 M6 的根据）**：
`model-request.service.ts:182` `const apiKey = await resolveProviderApiKey(provider, this.deps.secretStore);`
→ `resolve-provider-api-key.ts:26` `await secretStore.get(ref)` → `base-sqlite-secret-store.ts:55` `strategy.decrypt`
→ `sksp-android/src/android-secret-store.ts:69` `await native.decrypt(...)`
→ **之后** 才到 `:214` `adapter.chat(...)` → `sseConnect`。
⇒ **每一次发消息都会走 sksp decrypt，且它在 sseConnect 之前被 `await`**。

---

## 二、core-runtime 债务池抽验（ledger §3：P2 18 + P3 34 = 52 条，抽 14 条 = **26.9% ≥ 10%**）

> §3 只给计数与主题、不出条目 ID，故抽验对象取其上游 `synth/core-runtime.md` 的 P2 表（RT-09…RT-25 + RT-24b，18 条）与 P3 表（RT-26…RT-59，34 条）。
> 先核计数：P2 表逐行数 = 18 ✅、P3 表 RT-26→RT-59 = 34 ✅ ⇒ **§3 的 18/34 与 synth 表自洽**。

| ID | 级 | 位置（spec/台账记） | 实测位置 | 定级 | 已修 | 重复 | 备注 |
|---|---|---|---|---|---|---|---|
| RT-09 | P2 | `doom-loop.ts:42-53` + `agent-definition.schema.ts:148` | `:42` threshold、`:43-45` 长度 guard、`:48-50` `tail.every`；schema `:148` `z.number().int().positive()`（接受 1）✅ | 合理 | 否 | 无 | **确认**：`threshold=1` 时 `length<1` 不成立 ⇒ `[x].every(...)` 恒真 ⇒ 首次工具调用即抛。附带的 `crossRoundWindow < 4 \|\| % 2 !== 0` 静默 no-op（`:78-84`）**也在位** |
| RT-10 | P2 | `agent-session.port.ts:52,60` | 声明 `:52`/`:60`；实现 `chat-agent-session.ts:54,55,58`、`ephemeral-overlay:71,72,75`；生产零调用方 ✅ | 合理 | 否 | 无 | **确认**：`message.port.ts:84` 是同名不同接口，全仓无对 `AgentSession.hideRange/truncateAfterMessage` 的生产调用 |
| RT-12 | P2 | `validate-agent-tool-policy.ts:63` vs `resolve-agent-tool-registry.ts:22` | `:64` `const hasDeny = tools.deny != null`；`:22` `policy.deny != null && policy.deny.length > 0` ✅ | 合理 | 否 | 无 | **确认**（台账 `:63` 差一行，实为 `:63-64` 的 hasDeny 声明区） |
| RT-14 | P2 | `run-agent-turn.ts:976 / :1314` | 唯一生产赋值在 `:1389` `persistMessages: true`；`agent.port.ts:24` 声明；`agent-runner.ts:233/236/374/517/761/886/948/1001` 全是内部消费 ✅ | 合理 | 否 | 无 | **确认零调用方**。台账行号 `:1314` → 实为 `:1389`（**该文件行号整体漂移 ~+67**） |
| RT-16 | P2 | `agent-runner.ts:561`（每 step）vs `:301`（每 run） | `:574` `inferLlmProtocolFromSavedModelId`（在 for `:406` 体内）；`:309-311` `savedModelForAppend`（循环外）✅ | 合理 | 否 | 无 | **确认**。台账复核栏 `:398/:561/:301` 全部偏移 8~13 行（**该文件行号漂移 ~+8~13**） |
| RT-20 | P2 | `run-agent-turn.ts:489,609,...,955` + `:1009-1011`；`:973` 置真 | 8 处 stage 赋值 `:667,676,690,704,778,812,841,1022`；`runnerEntered = true` 在 `:1040`；`if (runnerEntered)` 在 `:1076`、`onRunFailed?.({` 在 `:1077` ✅ | 合理 | 否 | 无 | **确认**：`stage` 在 `:1022` 写成 `"runner.run"` 后至 `:1077` 读取之间无再赋值 ⇒ **`onRunFailed.stage` 恒为 `"runner.run"`**，前奏 7 个标签是死写 |
| RT-26 | P3 | `sqlite-session-run-state.repository.ts:21-35` | `:21-23` `nullableText`、`:26-28` `tokenSource` 收窄、`:35` `status: String(row.status) as SessionRunStatus`、`:40` 走收窄 ✅ | 合理 | 否 | 无 | **确认，且行号精确**（未漂移的文件） |
| RT-29 | P3 | `generate-agent-run-id.ts:10-12` | 全文 13 行，函数体只有 `return randomUUID()` ✅ | 合理 | 否 | 无 | **确认，行号精确** |
| RT-33 | P3 | `agent-runner.ts:403` 声明 / `:527` 读 / `:548` 写 | `:411` `let stepCompactionEmitted = false`（在 for `:406` 体内）、`:540` `!stepCompactionEmitted`、`:561` 置真、**无其它置真路径** ✅ | 合理 | 否 | 无 | **确认**：`!stepCompactionEmitted` 恒为 true，守卫纯装饰（行号同 RT-16 漂移） |
| RT-34 | P3 | `agent-runner.ts:909-912` + `:248` | `:927-930` `if (step+1>=maxSteps){stopReason="max_steps";break;}`；`:256` `let stopReason = "max_steps"` ✅ | 合理 | 否 | 无 | **确认**：赋一个已是当前值的常量 + 跳一个 for 条件本就会结束的循环 |
| RT-39 | P3 | `subagent-tool.ts:219` | `:218-220` 逐字一致 ✅ | 合理 | 否 | ⚠ **重复** | 已被 **C1-3** 认领（wave-c1.md:263-306 逐字覆盖同一条），但仍留在 core-runtime 债务池 |
| RT-51 | P3 | `run-agent-turn.ts:133-134` | `:135` `readonly userVfsTurn?: UserVfsTurnService;` + `:72` import；service/agent 内**仅此两处** ✅ | 合理 | 否 | 无 | **确认** |
| RT-52 | P3 | `run-agent-turn.ts:585-939`（283 行） | try 在 `:643`；4 空格区 `:644-657`；**掉到 2 空格 `:713`–`:1004`（292 行）**；`:1014` 起恢复 4 空格 ✅ | 合理 | 否 | 无 | **确认缩进异常真实存在**（数字修正：2 空格跨度 292 行、起止 `:713/:1004`，非台账的 `:655/:937`/283 行） |
| RT-24 | P2 | `builtin-tool-context.ts:174` + 三处装配 | 声明 `:174`；装配 `run-agent-turn.ts:912`、`:1269`、`create-user-vfs-turn-service.ts:67`；生产 `.listSessionMessages(` **零命中** ✅ | 合理 | 否 | ⚠ **重复** | 已被 **C1-4** 认领（wave-c1.md:343-410），但仍留在债务池（台账未销账） |

**抽验小结**：抽 14 条（P2 7 条：RT-09/10/12/14/16/20/24；P3 7 条：RT-26/29/33/34/39/51/52）
—— **定级 14/14 合理、已修 0/14、实质重复 2 条（RT-24↔C1-4、RT-39↔C1-3）**。
另记一条**台账数据质量**问题（不影响定级、但会误导后续执行）：
`agent-runner.ts` 与 `run-agent-turn.ts` 的行号在 synth 里**系统性漂移 +8~+75**（疑为撰写于 `150eec3b` 之前），
而 `doom-loop.ts` / `sqlite-session-run-state.repository.ts` / `generate-agent-run-id.ts` / `subagent-tool.ts` 等**未改动文件行号精确**。
⇒ 若后续把 RT-14/16/20/33/34/52 派进执行批次，**必须按 PLAN §8 第 8 条重新开 `fe79b781` 核行号**。

---

## 三、must-fix 清单

| # | 条目 | 类别 | 问题 | 建议改法（doc-fix 可直接照抄） |
|---|---|---|---|---|
| **M1** | C1-11 | 修法完备性（**高**） | `userAborted` 标记在**用户 abort 路径上必然泄漏**。`sseAbort` 写标记后 `streams.remove`，读循环抛错进 `handleStreamFailure` 时 `:423` 拿到 `streams[requestId] == null` ⇒ **`:424-425` 提前 return，永远走不到 `:433` 的 `userAborted.remove`**。⇒ 每点一次「停止」就往 map 里永久留一条。**连带后果：spec 自己的 I4 断言（「三次之后 userAborted 为空」）在按本修法实现后必然失败** | 把 `userAborted.remove(requestId)` 提到 `handleStreamFailure` 的**最开头**（`:423` 读 state 之前）：<br>`val userAbortedHit = userAborted.remove(requestId) == true`<br>`val state = streams[requestId]`<br>`if (state == null \|\| userAbortedHit) return`<br>并在注释里写死「一次性消费必须早于 `streams` 闸门，否则 abort 路径泄漏」 |
| **M2** | C1-11 | 证据行号（**中**） | 修法 2 写「`classifyError` … 调用点只有两处（`:166` 与 `:223`）」。实测 `classifyError` 的调用点是 **`:427`（在 `handleStreamFailure` 内）与 `:223`（在 `request` 内）**；`:166` 是 `handleStreamFailure(...)` 的调用点，不是 `classifyError` 的 | 把 `:166` 改为 `:427` |
| **M3** | C1-11 | 修法自相矛盾（**中**） | 风险 R2 要求「把 `userAborted` 的读放进 `synchronized(state)` 块内（当前 `:428` 已有该块）」，但修法 2 的 `classifyError` 调用在 **`:427`、锁外**，且它要读同一个 `userAborted` 标志 ⇒ **同一标志被两处读、一处锁内一处锁外，R2 的口径没有落实** | 二选一并写死：①把 `classifyError` 调用整体移进 `synchronized(state)`（`:428` 之后），使「读标记 + 关闸 + 发事件」三步同锁；②或接受 R2 的残余窗口、但必须在风险栏**显式降级**为「已知竞态、I3 真机抽 10 次以上观察」，不得同时宣称「已按 R2 修正」 |
| **M4** | C1-11 | 修法口径缺口（**中**） | 修法 2 说记「生效的 `callTimeoutMs`」，但没给解析式。实测 `clientWithCallTimeout`(`:267-274`) 在 `callTimeoutMs <= 0` 时返回 `baseClient`，而 `baseClient` 的 callTimeout 是 `DEFAULT_CALL_TIMEOUT_MS = 600_000`(`:55,:79`)。⇒ 实现者若直接存 `callTimeoutMs`（可能是 `-1`），`elapsed >= effectiveCallTimeoutMs` 会**恒真**，保险条件失效 | 在修法 2 补一行解析式：<br>`val effectiveCallTimeoutMs = if (callTimeoutMs > 0) callTimeoutMs.toLong() else DEFAULT_CALL_TIMEOUT_MS`，<br>并注明「与 `clientWithCallTimeout` 的分支口径必须一致，改一处要改两处」 |
| **M5** | C1-11 | 验收不可测（**中**） | ① **I1 的黑洞 URL 不稳**：`http://10.255.255.1/...` 在多数网络下 `connect()` 立即返回 `ENETUNREACH/ENETUNREACH`，会得到 `kind:"network"` 而非 `"timeout"`，测试随机红。② 顺带确认：OkHttp `Builder` 默认 `connectTimeout = 10s`，把预算改成 8_000 确实能让 callTimeout **先于** connectTimeout 命中，方向对。③ I1 要临时改 `llm-sse-transport.ts:129` 这个**生产常量**，spec 未写「验收后必须 revert、不得进 PR」 | 把 I1 的注入目标改为**「本地 accept 后永不响应的 TCP 监听端口」**（如 `nc -l 127.0.0.1 9xxx` 只 accept 不 write），并在 I1 下方加一行纪律：「改 `SSE_WHOLE_CALL_TIMEOUT_MS` 属临时本地改动，验收完毕立即 revert，**不得进 PR**；PR 描述里记录改前改后两个值」 |
| **M6** | C1-12 | 验收无牙齿（**高**） | **I1 在修复前后测不出差异**。实测主路径时序：`model-request.service.ts:182` `await resolveProviderApiKey(...)`（内含 sksp `decrypt`）**先于** `:214` `adapter.chat(...)`（sseConnect）执行 ⇒ sksp 的阻塞是**串行前置**、不是队列争用。改前总时长 = T(keystore) + 正常，改后仍是 T(keystore) + 正常（executor 只把 T 挪到 `nm-sksp` 线程，不消除它）。且「未调 sksp 的对照组」在本路径上**不可构造**（api key 必须解密）。⇒ I1 会在修复前后**同样通过**，没有牙齿 | 把 I1 换成**并发形状**的断言，锚到 RULE:129「native 队列阻塞会让停止失灵」：<br>「**sksp 在途时，同队列其它原生调用不被排队**」——具体做法：run 进行中触发一次 sksp 读（搜索工具的 `resolveEngineChain` → `search-config.ts:209` `secretStore.get`，或设置页保存 API Key），同时点「停止」，观测 **`sseAbort` 从点击到 `LlmSseError/AbortError` settle 的延迟**与「无 sksp 在途」时同量级（取 5× 余量）。<br>配套加一条 logcat 断言（与 I4 合并）：`nm-sksp` 线程名在位 **且** RN NativeModules 队列线程上**看不到** sksp 的栈帧。<br>同时把病症段的受害面改写为「并发原生调用（`sseAbort` / 另一条 `sseConnect` / tokenizer 计数）被排队」，删掉「把本流的 sseConnect 派发一起堵住」这种会被逐跳核对推翻的表述 |
| **M7** | C1-12 | 修法自相矛盾（**中**） | 修法 4 标题写「**`invalidate()` 里 `executor.shutdownNow()`**」，紧接的 ⚠ 又写「`TokenizerModule` **没有**做这一步…**不做显式 shutdown**」；R2 也写「`invalidate()` 不调的话」。⇒ 实现者无法判断到底做不做。且 `SkspModule` 当前**没有** `invalidate()` 覆写（全文 83 行已核），加它就是新代码 | 二选一并删掉矛盾半边（建议**选 B**，与范式一致）：<br>**A.** 保留 `invalidate()` + `shutdownNow()`，并在 R2 说明「本条比 `TokenizerModule` 多一步生命周期，理由是…」；<br>**B.** 删掉修法 4 的第一句，只留注释要求（照 `TokenizerModule` 不做显式 shutdown），R2 相应改成「与 `TokenizerModule` 同款：daemon 线程随进程回收」。 |
| **S1** | C1-12 | 修法完备性（低） | 修法 3「顺手把 KeyStore 实例提为字段」只给了字段声明，没说 `getOrCreateKey`(`:29-46`) 内部 `:30` 那一处 `KeyStore.getInstance(...)` 也要改用它——不改就等于**同一模块里两个 KeyStore 实例**，优化落空且注释里「单线程 executor 下安全」的论证只覆盖了一半 | 修法 3 补一句：「`getOrCreateKey`(`:30`) 与 `decrypt`(`:70`) 两处 `KeyStore.getInstance` 一并改用该字段，全模块**只此一个** KeyStore 实例」 |
| **S2** | C1-12 | 测试策略缺口（低） | I4（logcat 看 `nm-sksp` 线程名）依赖「加一行 debug 日志」，但测试策略段只写了「不新建测试基建」，没把这条日志列进产出 | 测试策略补一行：「三处（`encrypt`/`decrypt` 入口）加 `BuildConfig.DEBUG` 门控的一行线程名日志，供 I4 与 C1-11 的 I4 共用 logcat 核对」 |
| **S3** | C1-12 | 验收口径（低） | I1 换成并发断言后，原来的「与『未调 sksp』对照组同量级」措辞要一并删掉（对照组不存在），改成「与『无 sksp 在途』对照组」 | 随 M6 一并改 |
| **S4** | C1-11 | 与 RULE 的关系（低） | 全文没有一处把「本条不改动 600s 整调用预算口径」与 RULE:100「LLM 流式请求不设固定空闲超时」显式挂钩。读者会怀疑「新增 timeout 分类」是不是在偷偷加空闲界 | 修法段补一行口径：「本条**不改**预算：600s 仍是 connect+首字+流体**全周期**的整调用兜底（RULE:100 拍板的『不设固定空闲界』不变），只把『到点形态』从**静默**改成**发 `kind:"timeout"` 事件**」 |
| **S5** | C1-11 | 验收可执行性（低） | I6 的 `gradlew :llm-sse-native:assembleDebug` 里的 Gradle 模块名来自 autolinking（由包名 `@novel-master/llm-sse-native` 推导），本 worktree 下 `apps/mobile/android/app/build/generated/autolinking` **不存在**，我无法在只读范围内确认该模块名 | I6 补一句兜底：「若 autolinking 未把库注册为 `:llm-sse-native`，退化为整包 `gradlew assembleDebug`」 |
| **S6** | 债务池 | 台账 hygiene（低） | RT-24 / RT-39 已被本分片 C1-4 / C1-3 认领，但仍留在 `synth/core-runtime.md` 的 P2/P3 表里并计入 ledger §3 的 155/174 | 在 §3 或 synth 表加一行销账标记：「RT-24 → 已由 wave-c1 C1-4 认领」「RT-39 → 已由 wave-c1 C1-3 认领」，避免后续 backlog 重复立项 |
| **S7** | 债务池 | 行号漂移（低） | `agent-runner.ts` / `run-agent-turn.ts` 在 synth 里的行号系统性偏移 +8~+75（RT-14/16/20/33/34/52 六条） | 在 §3 加一条盲区注记：「core-runtime 簇 P2/P3 的 file:line 系撰写期快照；`agent-runner.ts`/`run-agent-turn.ts` 已漂移，执行前须按 PLAN §8 第 8 条重核」 |

---

## 四、结论

**组 C：No-Go（须先闭合 7 条 must-fix）。**

一句话理由：**两条的病症与证据都经得起逐字复核（字节码级结论我也独立复现了），但 C1-11 的 `userAborted` 在用户 abort 路径上必然泄漏、连它自己的 I4 断言都会挂，C1-12 的核心验收 I1 在修复前后测不出差异——两条都还只是「不能直接执行」的状态，不过 must-fix 全部是局部可改的机械修正，不需要重写任何一条的骨架。**

- must-fix：7（M1 / M2 / M3 / M4 / M5 / M6 / M7），其中 **M1、M6 为高**（前者是缺陷，后者是验收无牙齿）。
- should-fix：7（S1–S7），全部是补口径/补纪律，不阻塞。
- 债务池：抽 14 条（core-runtime 52 条的 26.9%）—— **定级 14/14 合理、已修 0/14、实质重复 2 条**。
