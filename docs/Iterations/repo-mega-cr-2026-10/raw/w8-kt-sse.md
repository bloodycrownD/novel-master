---
zone: w8-kt-sse
agent: zone-scan (W8 Kotlin 专项，首次深审——全 CR 明确记录的盲区)
files_scanned:
  - packages/llm-sse-native/android/src/main/java/com/novelmaster/llmsse/LlmSseModule.kt (503 行，全读)
  - packages/llm-sse-native/android/src/main/java/com/novelmaster/llmsse/LlmSsePackage.kt (21 行，全读)
  - packages/llm-sse-native/src/native.ts (116 行，全读)
  - packages/llm-sse-native/src/transport.ts (337 行，全读)
  - packages/llm-sse-native/src/types.ts (113 行，全读)
  - packages/llm-sse-native/android/build.gradle (32 行，全读)
  - packages/llm-sse-native/package.json (45 行，全读)
  - packages/llm-sse-native/README.md (46 行，全读)
  - packages/llm-sse-native/test/mock-bridge.ts（消费面，核对测试是否真覆盖）
  - apps/mobile/src/services/llm-native-fetch-shim.ts（消费面，错误契约对账）
  - apps/mobile/src/runtime/setup-llm-fetch.ts（装配面）
  - packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts:255-460（消费面，timeout 分级契约对账）
---

## 摘要

`packages/llm-sse-native` 是 novel-master 移动端 LLM 流式传输的**最底层字节管子**：Kotlin 侧用
自有 `OkHttpClient`（独立连接池、读超时恒禁用、整调用 callTimeout 600s）做同步 `execute()` 读响应体，
把字节按「16KB 读粒度 → UTF-8 完整前缀切分 → 100ms|64K 字符合批」搬成 `LlmSseChunk` 事件过桥；
JS 侧 `native.ts` 静态绑 `NativeModules.LlmSseNative` + `NativeEventEmitter`，`transport.ts`
按 requestId 路由并 settle 成 core 的 `SseTransport` port。纪律是「只搬字节不认协议」——SSE 帧解析、
超时分级、重试全部留在 core。本次为该区域**首次深审**。

## 职责与边界

- **只做**：HTTP 建流、响应体字节 → UTF-8 文本、native 侧合批、事件闸门（abort/终结后不再发事件）、
  四类事件发射、非流式请求-响应（Promise）。
- **不做**：SSE 帧解析、重试、超时分级（`first-chunk` vs `idle`）、abort 分发（由 core 组合 controller
  → wrapper 转发到 `sseAbort`）、HTTP 状态判定（非 2xx 不 reject，由 JS 侧据 status 归纳）。
- **超时口径**（RULE.md:95 拍板、spec §2 登记）：读超时**已退役**——client 级 `readTimeout(0)` 恒禁用，
  流式全程无空闲界，唯一自动兜底是整调用 `callTimeout` 600s；死流由用户手动终止。

## 对外接口

Kotlin `LlmSseModule`（`getName() = "LlmSseNative"`）：

| 方法 | 签名 | 语义 |
|---|---|---|
| `sseConnect` | `(requestId, url, headersKv: ReadableArray, body, readTimeoutMs, callTimeoutMs)` | 建流，无 Promise，事件驱动 |
| `sseAbort` | `(requestId)` | 关事件闸门 + `call.cancel()` |
| `request` | `(method, url, headersKv, body?, callTimeoutMs, promise)` | 非流式，**非 2xx 不 reject**，status/body 原样回 |

事件（companion 常量 `LlmSseModule.kt:43-46`，JS 侧对齐于 `types.ts:33-36`）：
`LlmSseHeaders{requestId,status,contentType}` → `LlmSseChunk{requestId,text}`* →
`LlmSseDone{requestId}` / `LlmSseError{requestId,kind,message}`，其中 `kind ∈ {network, timeout}`。

JS 导出面：`createNativeSseTransport()` / `isNativeSseAvailable()` /
`registerNativeSseTransportWith(register)` / `createNativeSseTransportFromBridge(bridge)`（可注入，测试面）/
`flattenRequestHeaders()` / `NativeSseTransportError` / `NativeSseAbortError`。

## 数据访问

无 SQLite / KKV / 文件持久化。全部状态在进程内两个 `ConcurrentHashMap`：

- `calls: requestId → Call`（`LlmSseModule.kt:93`）——「abort 与登记表清理均经此」
- `streams: requestId → StreamState`（`:96`）——「事件闸门：移除后不再向 JS 发该请求的事件」

`StreamState`（`:99-102`）持有 per-request 的 `pending: StringBuilder`（合批缓冲）与
`flushTask: ScheduledFuture?`（100ms 定时句柄）。**注意**：`request()`（非流式）**不进任何表**
——它既无 requestId 也无闸门，无法被 `sseAbort` 触达（已在 shim 侧登记为已知限缩）。

## 依赖关系

**Kotlin 侧 import**（`LlmSseModule.kt:3-26`）：`com.facebook.react.bridge.*`（ReactMethod /
Promise / Arguments / ReactContextBaseJavaModule / DeviceEventManagerModule）、
`okhttp3.{Call, ConnectionPool, OkHttpClient, Request, Response, MediaType, RequestBody}`、
`okio.{Buffer, BufferedSource}`、`java.io.{IOException, InterruptedIOException}`、
`java.net.SocketTimeoutException`、`java.util.concurrent.*`。

**版本实测**（非照抄文档）：`packages/llm-sse-native/android/build.gradle:31` 写的是**无版本号**的
`implementation "com.squareup.okhttp3:okhttp"`，实际解析到 RN 0.85.3 自带的
**okhttp 4.9.2 / okio 2.9.0**——证据：`node_modules/react-native/gradle/libs.versions.toml:36-37`
（`okhttp = "4.9.2"` / `okio = "2.9.0"`）+ `:79` `okhttp3 = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }`；
本地 gradle 缓存实测存在 `okhttp-4.9.2.jar` 与 `okio-jvm-2.9.0.jar`。零新增依赖成立，但**版本被 RN 单点锁死**，
`build.gradle:2` 又单独钉了 `kotlinVersion = "2.0.21"`（与 mobile 根 `build.gradle:8` 的 `2.1.20` 不一致，
两处 Kotlin 编译器版本共存，见 F-14）。

**被谁消费**（grep 实测）：
- `apps/mobile/src/runtime/setup-llm-fetch.ts:21,32` —— `registerNativeSseTransportWith(registerSseTransport)`
  + `configureLlmFetch(createLoggingFetch(shim))`（`__DEV__` 下 logging 最外层包 shim）
- `apps/mobile/src/services/llm-native-fetch-shim.ts:26-27` —— 非流式 fetch shim 底座
- `apps/mobile/__tests__/llm-sse-native-bridge-interop.test.ts`、`stop-button-repro.test.ts` —— 防回归

---

## 发现清单

### F-w8-kt-sse-1 | P1 | `LlmSseModule.kt:433`（配合 `:174-183`、`:417-438`）

**引文**：
```kotlin
      streams.remove(requestId)
      if (call.isCanceled()) {
        return // 主动 abort：JS 侧已自行收尾，静默
      }
```

**描述**：整调用 `callTimeout`（本设计**唯一**的自动兜底，600s）到点时，OkHttp 的
`AsyncTimeout.timedOut()` 会调用 `RealCall.cancel()`——这一点是**从字节码实测确认**的，不是推测：

```
$ javap -p -c "RealCall$timeout$1.class"
public final class okhttp3.internal.connection.RealCall$timeout$1 extends okio.AsyncTimeout {
  protected void timedOut();
       0: aload_0
       1: getfield      #15   // Field this$0:.../RealCall;
       4: invokevirtual #18   // Method okhttp3/internal/connection/RealCall.cancel:()V
```

`RealCall.cancel()` 会把 `canceled` 置 true，因此 `call.isCanceled()` 返回 **true**。
于是 600s 到点后的路径是：`callTimeout` 触发 → socket 被关 → 读循环 `source.read()` 抛
`IOException("Canceled")` → `handleStreamFailure` → `streams[requestId]` 非空 → 走到 `:433`
→ **命中 isCanceled 闸门，直接 return，一个事件都不发**。

`:433` 的注释「主动 abort：JS 侧已自行收尾」隐含假设「`isCanceled()` 只可能来自 `sseAbort`」，
但 OkHttp 自己的 callTimeout 也走 `cancel()`，该假设不成立。

**后果链**（逐跳核对过）：JS 侧收不到 Done 也收不到 Error → `transport.ts` 的 `routes` 条目永不删除、
`post()` 返回的 Promise **永不 settle** → core `runNative`（`llm-sse-transport.ts:389-454`）
**不开 JS 侧整调用定时器**（`armWholeCallTimer()` 只在 `runFetch` 里调用，`:626`；
`:301-303` 注释明确写「native 用 transport 内 callTimeout，避免双触发竞态」）→ run 挂到用户手动点停止。

按 spec §3 / T-N2 的设计意图，callTimeout 到点应映射为 `LlmStreamTimeoutError`，
`processedLength === 0` 时归 **first-chunk 阶段 → 可自动重试**。实际结果是丢掉了这次重试，
把一次本可自愈的失败变成用户可见挂起。spec §7「首字黑洞的自动收敛上限」登记的
「600s × 3 次尝试 ≈ 30 分钟」也因此多了一层不确定性——第一次尝试的 600s 是**纯挂起**而非超时错误。

**建议**：`sseAbort` 时把「用户主动中止」与「OkHttp 内部 cancel」区分开，不要用 `isCanceled()` 当闸门。
最小改法：在 `sseAbort` 里往 `calls` 登记表塞一个显式的「用户 abort」标记（或另设 `aborted: ConcurrentHashMap<String,Boolean>`），
`handleStreamFailure` 只认这个标记；`isCanceled()` 且非用户 abort 时应当继续走 `emitError(kind,...)`。

**置信**：confirmed（Kotlin 侧代码 + OkHttp 4.9.2 字节码双向核对；未上真机跑满 600s，
异常的确切类型 `IOException("Canceled")` 是按 OkHttp 惯例推导，但**结论不依赖异常类型**——
只要 `isCanceled()` 为 true，`:433` 就静默返回。）

---

### F-w8-kt-sse-2 | P1 | `LlmSseModule.kt:445-457`

**引文**：
```kotlin
      is SocketTimeoutException ->
        "timeout" to "read timeout after ${effectiveReadTimeoutMs}ms"
      is InterruptedIOException ->
        if (t.message?.contains("timeout", ignoreCase = true) == true) {
```

**描述**：`classifyError` 里 `"timeout"` 归类的**两个入口在本模块配置下都不可达**。

- `SocketTimeoutException` 分支：client 级 `readTimeout(0, MILLISECONDS)` 恒禁用
  （`:78`，读超时已按 RULE.md:95 退役），流中不可能有读超时；`:222` 的注释也承认这条是「防御性保留」。
- `InterruptedIOException` + message 含 "timeout" 分支：本该由 `timeoutExit()` 产出
  （`RealCall.timeoutExit` 字节码里确实是 `new InterruptedIOException("timeout")`），
  但 `timeoutExit` 只在 `messageDone` 路径被调用（`javap` 确认 `timeoutExit` 的唯一调用点在
  `RealCall.messageDone$okhttp` 内），**流式读卡死时走不到那里**——走的是 `timedOut() → cancel()`
  （见 F-1），抛的是普通 `IOException`。

净效果：`callTimeout` 在**流式与非流式两条路上都永远不产出 `kind:"timeout"`**。
非流式侧（`:223`）尤其明确——`request()` 的 catch 里 classify 后 reject，
但 600s 到点得到的是 `kind:"network"` + `message:"Canceled"`，shim
（`llm-native-fetch-shim.ts:99-112` `toTransportError`）照单全收映射成 `NativeSseTransportError("network")`，
`transport.ts:24` 的 kind 联合类型里 `"timeout"` 分支在生产路径上**永远走不到**。

**建议**：让 `classifyError` 显式识别 callTimeout——例如捕获前先查一个「本次 call 是否是被
AsyncTimeout cancel 的」信号，或改用 OkHttp 提供的 `EventListener` / `Call.timeout()` 状态来区分。
至少先把 F-1 修好，`InterruptedIOException` 分支才有意义。

**置信**：confirmed（Kotlin 代码 + `javap` 对 `timeoutExit` 唯一调用点的确认）；
「流式卡死走不到 messageDone」是基于字节码调用图的推断，未真机复现。

---

### F-w8-kt-sse-3 | P2 | `LlmSseModule.kt:463-473`

**引文**：
```kotlin
      jsModule.emit(name, params)
    } catch (_: Throwable) {
      // bridge 已关停时发事件失败：不 crash（流本身也会因 executor 关闭而终止）
    }
```

**描述**：`catch (_: Throwable)` 无差别吞掉**所有**发射失败。注释只考虑了「bridge 已关停」这一种
良性场景，但 `emitEvent` 同样包住了 `Arguments.createMap()`、`build(params)`（四个 `putString/putInt`）
和 `jsModule.emit(...)`。任何一次 chunk 发射失败——序列化异常、payload 超限、bridge 队列异常——
都会导致**已收到的 SSE 文本被静默丢弃**，而流继续跑、Done 照常发，JS 侧拿到的是一个
「少了若干段文本但状态正常结束」的流。对 LLM 场景这等价于静默内容损坏：用户看到一段缺字/断裂的回答，
终端无任何日志。

**建议**：至少把失败计数与首个异常记进 logcat（`Log.w("LlmSse", ...)`），
并在 Chunk 发射失败时降级为「发一条 Error 事件」或「关闭事件闸门让 JS 侧感知到截断」，
不要让流以「成功」姿态收尾。

**置信**：confirmed（代码直读）。

---

### F-w8-kt-sse-4 | P2 | `transport.ts:164` / `:189` / `:207-210`

**引文**：
```ts
            } else {
              errorBody += event.text;
            }
```

**描述**：非 2xx 时 JS 侧把所有 chunk 无上限累加进 `errorBody`；截断只发生在**构造错误消息时**
（`:207-210`，`errorBody.slice(0, 500)`），累加过程本身没有任何 cap。
配合 native 侧对非 2xx **同样全量搬运响应体**（`LlmSseModule.kt:151-163` 不看 status 就 `pumpStream`），
一个返回超大错误体的服务端（或故障注入）会让 JS 堆内存吃到 OOM，而 native 侧照单全收地搬完整个 body。
`transport.test.ts:372` 的用例名「超长错误 body 只保留前 500 字符摘要」只验证了**最终消息**被截断，
恰恰掩盖了累加阶段的无界增长。

**建议**：给 `errorBody` 加硬上限（如 64KB 字符），到达即停止追加并打标记
（摘要处改为 `…(truncated)`）；native 侧可考虑对非 2xx 的响应体也走一个读取上限。

**置信**：confirmed（代码直读 + 测试用例对照）。

---

### F-w8-kt-sse-5 | P2 | `LlmSseModule.kt:245-256`

**引文**：
```kotlin
    calls.clear()
    streams.clear()
    flushScheduler.shutdownNow()
    executor.shutdownNow()
```

**描述**：`shutdown()` 取消了所有在途 `Call`、停了自己的两个线程池，但**没有释放 OkHttp 侧的
`ConnectionPool`**——既没有 `baseClient.connectionPool.evictAll()`，也没有
`baseClient.dispatcher().executorService().shutdownNow()`。
`baseClient`（`:76-80`）自带一个 `ConnectionPool()`（默认 5 条空闲连接 / 5 分钟 keepAlive），
这些 socket 在模块 invalidate 后仍会挂在池里直到自然老化。React context 重建（dev 热重载、
Activity 重建、生产环境低内存回收后重启）会反复走这条路径。

补充：`shutdown()` 可能被 `invalidate()`（`:233`）与 `onCatalystInstanceDestroy()`（`:240`）**各调一次**，
两个钩子在 RN 里不是互斥的。重复调用本身是幂等安全的（`clear()` + `shutdownNow()` 可重入），
但也说明清理职责分散、没有幂等标记。

**建议**：`shutdown()` 末尾补 `baseClient.connectionPool.evictAll()`；
若 `baseClient` 未来要跨实例复用，再评估 `dispatcher.executorService` 的关闭时机。
另可加一个 `@Volatile private var shutDown = false` 让重复调用短路。

**置信**：confirmed（代码直读；OkHttp 侧 `ConnectionPool` 的 keepAlive 默认为 5min 属库默认行为）。

---

### F-w8-kt-sse-6 | P3 | `LlmSseModule.kt:267-274`

**引文**：
```kotlin
    return baseClient.newBuilder()
      .callTimeout(callTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
      .build()
```

**描述**：core 每条流都下发 `wholeCallTimeoutMs`（`llm-sse-transport.ts:426`），
所以 `callTimeoutMs > 0` **恒成立**，即**每次 `sseConnect` 都新建一个 `OkHttpClient` 实例**。
好消息：这不是资源泄漏——OkHttp 的 `newBuilder()` 走 `OkHttpClient(okHttpClient, builder)` 复制构造，
`connectionPool` 与 `dispatcher` 都是**按引用共享**的，所以连接池复用成立（这也回答了
「每连接新建 client 会不会炸连接池」：**不会**）。`request()` 侧（`:207-213`）同款逻辑。
代价只是每次分配一个 `OkHttpClient` 对象 + 若干 builder 字段拷贝，在 ~10 次/秒的合批节奏下可忽略。

**建议**：无需修。若要省分配，可按 `callTimeoutMs` 值做一个小缓存
（实际取值域极窄：恒为 core 下发的 600_000）。

**置信**：confirmed（Kotlin 直读 + OkHttp `newBuilder` 复制构造语义）。

---

### F-w8-kt-sse-7 | P2 | `LlmSseModule.kt:142-146`

**引文**：
```kotlin
    if (calls.putIfAbsent(requestId, call) != null) {
      emitError(requestId, "network", "duplicate requestId: $requestId")
      return
    }
```

**描述**：重复 requestId 时，除了发一条 Error，**旧的那条流既没有被 abort 也没有被摘除**——
它继续挂在 `calls`/`streams` 上读 socket，直到 600s callTimeout 或服务端断开。
而 JS 侧 `routes` 是按同一个 requestId 建的表（`transport.ts:180`），Error 事件会被路由到
**新请求**的处理器上把它 reject 掉，旧流的 chunk 随后全部命中已删除的路由被丢弃（`:128-133`）。
净效果：一条 JS 侧已判失败的孤儿 native 流，在后台白占一个连接 + 一个 reader 线程最长 600s。

可达性：`transport.ts:69-72` 的一次性实例前缀 + 单调计数器实际上让 requestId 碰撞概率极低，
所以这是防御性分支而非活跃 bug。但注释把它描述成正常防护（「native 报 duplicate requestId 直接把新请求打掉」），
实际上它在打掉新请求的同时**留下了旧请求的孤儿**。

**建议**：重复分支里显式 `streams.putIfAbsent(requestId, …)` 之前先判断——若已有流，
先 `calls[requestId]?.cancel()` 并清理旧 `streams` 条目，再发 Error；
或直接复用 `sseAbort` 的清理逻辑。同时 `client.newCall(request)` 产物也应丢弃说明（未 execute，无连接泄漏）。

**置信**：confirmed（代码直读）；实际可达性评估为 suspected（极低概率）。

---

### F-w8-kt-sse-8 | P3 | `LlmSseModule.kt:174-183`

**引文**：
```kotlin
  fun sseAbort(requestId: String) {
    streams.remove(requestId)
    val call = calls.remove(requestId)
```

**描述**：`sseAbort` 摘掉了 `streams` 与 `calls`，但**没有取消 `StreamState.flushTask` 上挂的
100ms 定时任务**。该任务仍会在 ≤100ms 后触发 `flushPending`，靠 `:386` 的
`streams.containsKey(state.requestId)` 闸门丢弃缓冲——行为上是正确的（不漏发也不误发），
但 `StreamState` 对象（含其 `pending` StringBuilder，最多 64K 字符 ≈ 128KB 堆）
会被这个已入队的任务多持有最多 100ms。

**建议**：`sseAbort` 里加 `streams.remove(requestId)?.flushTask?.cancel(false)`。
与 F-1 的修复一并做时，注意 `flushTask` 字段的访问需与 `flushPending` 走同一把锁。

**置信**：confirmed（代码直读；影响极小）。

---

### F-w8-kt-sse-9 | P3 | `LlmSseModule.kt:152`（对照类注释 `:36`）

**引文**：
```kotlin
          emitHeaders(requestId, response.code, response.header("Content-Type"))
```

**描述**：模块文档（`:36`）声明的硬不变量是「**主动 abort（sseAbort）后不再发任何事件**」，
但 `emitHeaders` 是**唯一没有走事件闸门**的发射点——它既不查 `streams` 也不查任何 abort 标记。
若 `sseAbort` 恰好发生在 `executor.execute{}` 已提交、但 reader 线程尚未跑到 `:152` 之前，
Headers 事件会照常过桥。

实际危害很小：JS 侧 `sseAbort` 的 `onAbort` 回调已先 `finish()` 删掉路由并 reject
（`transport.ts:244-247`），迟到的 Headers 命中 `routes.get(requestId)?.onHeaders` 的
`undefined` 分支被丢弃（`:122-127`）。但这是**依赖 JS 侧兜底**才成立的正确性，
与 Kotlin 侧自己声明的契约不符——两处契约应当对齐。

**建议**：`emitHeaders` 前加一次 `streams.containsKey(requestId)` 检查，
或把闸门下沉到 `emitEvent` 统一判（更彻底，见 F-3）。

**置信**：confirmed（代码直读；当前无实际用户可见危害）。

---

### F-w8-kt-sse-10 | P3 | `LlmSseModule.kt:222-223`

**引文**：
```kotlin
        // 非流式走 baseClient：读超时已恒禁用（此处传默认数值仅供防御性文案）。
        val (kind, message) = classifyError(t, DEFAULT_READ_TIMEOUT_MS)
```

**描述**：`request()` 忽略了自己实际使用的 `callTimeoutMs`（`:207-213` 可能用自定义值），
硬编码传 `DEFAULT_READ_TIMEOUT_MS`（30_000）。目前只影响一条正常不可达的 SocketTimeoutException 文案，
但文案一旦可达就会**说谎**（"read timeout after 30000ms" 与实际生效的超时无关）。
`stop-button-fix.md:121` 已把同类问题登记为遗留项「AC-4 前缀文案 `after 600000ms` 数字失真」，
这是同一类缺陷的第二处。

**建议**：`classifyError` 的第二个参数改成携带真实生效的超时值；
或直接删掉这个失真的文案分支（既然 readTimeout 已退役）。

**置信**：confirmed（代码直读）。

---

### F-w8-kt-sse-11 | P3 | `types.ts:46` + `index.ts:22`

**引文**：
```ts
export const LLM_SSE_DEFAULT_READ_TIMEOUT_MS = 30_000;
```

**描述**：读超时已按 RULE.md:95 拍板**退役**，`types.ts:39-45` 的 JSDoc 也标了 `@deprecated`，
但这个常量仍然**从包根 `index.ts:22` 正常导出**，且 `README.md:20` 仍在描述它的语义。
消费方（`apps/mobile` 的 fetch shim 只 import 了 `NativeSseAbortError` /
`NativeSseTransportError` / `flattenRequestHeaders`，目前没误用——这点是好的）随时可能
照着导出把它当成有效配置项传下去，得到一个静默无效的超时设置。
`transport.ts:153` 的 `readTimeoutMs = timeouts?.readMs ?? -1` 仍在把 `nativeTimeouts.readMs`
透传给 native（第 5 个入参），而 Kotlin 侧 `:139-141` 明确说它「当前只用于 SocketTimeoutException 的防御性错误文案」——
一条纯粹为已退役功能保留的半死参数链。

**建议**：与 F-10 一起收口——`LLM_SSE_DEFAULT_READ_TIMEOUT_MS` 从 `index.ts` 撤出（保留在
`types.ts` 内部或加 `@deprecated` 到下个 major 再删），README 同步标注退役。

**置信**：confirmed（代码直读；当前无消费方误用）。

---

### F-w8-kt-sse-12 | P3 | `LlmSseModule.kt:465-466`

**引文**：
```kotlin
      val jsModule = reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
```

**描述**：bridgeless 模式下 `getJSModule` **每次调用都新建一个动态 `Proxy`**——
`BridgelessReactContext.kt:131-153` 里没有任何缓存，源码自带 TODO 注释
`// TODO T189052462: ReactContext caches JavaScriptModule instances`。
本模块在 `emitEvent` 里**每个事件都调一次** `getJSModule`。合批后 ~10 事件/s × 并发流数，
每次分配一个 Proxy + 一次反射 `Method.invoke`（`BridgelessJSModuleInvocationHandler`，
`BridgelessReactContext.kt:120-128`）。量级不大，但属于零成本可省的开销，
且 RN 官方已用 `emitDeviceEvent(name, args)` 提供了绕过 Proxy 的快捷路径
（`BridgelessReactContext.kt:155-162`，直接 `callFunctionOnModule`）。

**建议**：改用 `reactApplicationContext.emitDeviceEvent(name, params)` 一次替换，
既省 Proxy 分配，也少一层反射。

**置信**：confirmed（读 RN 0.85.3 源码 `BridgelessReactContext.kt` 确认；性能影响量级为推断）。

---

### F-w8-kt-sse-13 | P3 | `transport.ts:251-258`

**引文**：
```ts
          bridge.sseConnect(
            requestId, url, headersKv, body, readTimeoutMs, callTimeoutMs,
          );
```

**描述**：`bridge.sseConnect(...)` 是在 Promise executor 内、且在 `routes.set(requestId, …)`（`:180`）
**之后**调用的。若此处**同步抛出**（bridge 已销毁 / `bridge.sseConnect` 不是函数 / JNI 异常），
异常会沿 executor 冒泡使 Promise reject，但 `routes` 表里的条目**永远不会删除**，
`onAbort` 监听器也不会摘除——每次这种失败泄漏一个路由条目 + 一个 abort 监听器。
在 dev 热重载或 Activity 重建导致 bridge 失效的窗口内可能累积。

**建议**：把 `bridge.sseConnect` 包在 try/catch 里，catch 内调 `finish(() => reject(err))`；
或把它挪到 `routes.set` 之前并在失败时直接 reject（此时无需清理路由）。

**置信**：confirmed（代码直读；触发条件依赖 bridge 失效窗口）。

---

### F-w8-kt-sse-14 | P3 | `LlmSseModule.kt:284-291`

**引文**：
```kotlin
      if (name != null && value != null) {
        builder.addHeader(name, value)
      }
```

**描述**：用 `addHeader`（**追加**）而非 `header`（**替换**）。`flattenRequestHeaders`
（`transport.ts:83-109`）对 `Headers` 实例与 `Record` 形态产出的键名天然唯一，
对 `string[][]` 形态（`transport.ts:90-97`）则**不去重**——调用方传
`[["Authorization","a"],["Authorization","b"]]` 会得到两条 `Authorization`。
另外 `while (i + 1 < headersKv.size())` 会**静默丢弃**长度奇数的尾项。

同时 `sseConnect` 恒用 `buildRequest("POST", …)`（`:131`），即使 JS 侧将来传 GET 语义也会被强制 POST；
当前 `transport.ts:151` 写死 `method: "POST"` 走 SSE，所以暂不构成问题，但两处都缺少显式约定。

**建议**：`header` 替换 `addHeader`（或至少对重复键显式报错）；奇数长度数组改为抛错而非静默丢弃。

**置信**：confirmed（代码直读；当前调用方不产生重复键，故为潜在风险而非活跃 bug）。

---

### F-w8-kt-sse-15 | P3 | `transport.ts:180` + `llm-sse-transport.ts:301-303`

**引文**：
```ts
          routes.set(requestId, { ... });
```

**描述**：整个 native 路径**没有任何 JS 侧兜底定时器**。core 的 `armWholeCallTimer()` 只在
`runFetch` 分支调用（`llm-sse-transport.ts:626`），native 分支的注释明确说
「callTimeout 由 transport 内部承接（超时按契约形态抛错），公共层不再开 JS 定时器避免双触发竞态」。
这个设计把**全部**收敛安全性押在「native 一定会发 Done 或 Error」这一个不变式上。
F-1（callTimeout 静默）与 F-3（emit 异常被吞）**各自独立地**破坏了这个不变式，
任一发生即导致 Promise 永久悬挂、run 悬死——正是 `stop-button-fix.md` 记录的那个 P0 的同构形态
（「连接不断 + run 悬死」）。

**建议**：这条不宜单独修（属于 F-1/F-3 的后果面），但建议在 ledger 里与 F-1/F-3 绑定追踪。
若要在架构上加固，可在 `transport.post()` 内挂一个**远大于** 600s 的看门狗
（如 900s）作为最后一道网——它不会与 callTimeout 竞态（只在 native 完全失声时触发），
却能把「永久悬挂」降级为「有终态的错误」。

**置信**：confirmed（两侧代码直读 + core 定时器调用点 grep 实测）。

---

### F-w8-kt-sse-16 | P3 | `LlmSseModule.kt:83-85`

**引文**：
```kotlin
  private val executor = Executors.newCachedThreadPool { runnable ->
    Thread(runnable, "llm-sse-reader").apply { isDaemon = true }
  }
```

**描述**：注释写的是「流式读循环线程池」，但 `request()`（`:203`）**共用同一个池**。
`newCachedThreadPool` 无上限，而一次 `request()` 最长可占一个线程 600s（`LLM_NATIVE_FETCH_CALL_TIMEOUT_MS`）。
若 `listModels` / `chatNonStream` 出现并发扇出（多 provider 切换、批量校验 key），
线程数会随之膨胀，且这些线程与 SSE 读循环抢同一个池。
注释与实际用途不符也会误导后续维护者。

另：所有线程同名 `"llm-sse-reader"`，ANR trace / 线程快照里无法区分是流式读循环还是非流式请求。

**建议**：给线程名带上用途前缀（`llm-sse-reader` / `llm-sse-request`），
或拆成两个池；`request` 若想收敛，单独用一个有界池更贴切。

**置信**：confirmed（代码直读；实际并发量未实测，危害偏理论）。

---

### F-w8-kt-sse-17 | P3 | `android/build.gradle:2` vs `apps/mobile/android/build.gradle:8`

**引文**：
```groovy
buildscript {
  ext.kotlinVersion = "2.0.21"   // ← 本包
}
```
```groovy
        kotlinVersion = "2.1.20"  // ← mobile 根工程
```

**描述**：同一个 Gradle 构建里，llm-sse-native 子工程声明的 Kotlin 编译器版本（2.0.21）
与 mobile 根工程（2.1.20）不一致。子工程 buildscript 的 `ext.kotlinVersion` 会 shadow 根工程的同名 ext，
而 `dependencies` 块（`:29`）里 `kotlin-stdlib:$kotlinVersion` 取的是**本包**的值——
即最终 classpath 上是 kotlin-stdlib 2.0.21，而编译本包源码的编译器来自根工程的 2.1.20。
当前能编译通过（`20260923-mobile-perf-issues-batch.md` 记忆里有
`:novel-master_llm-sse-native:compileDebugKotlin BUILD SUCCESSFUL` 的实证），
但「编译器新于 stdlib」是典型的未来炸点（新版编译器对 stdlib 内部 API 的假设会变）。

**建议**：删掉本包 `buildscript { ext.kotlinVersion = "2.0.21" }`，
改为直接引用根工程（`rootProject.ext.kotlinVersion` 或去掉版本号让依赖对齐），
并按 RULE.md 中「workspace 三包」的既有写法核对 sksp-android / tokenizer-driver-rn 是否同款问题。

**置信**：suspected（版本不一致已实测确认；「未来会炸」是基于 Kotlin 版本策略的推断，未实测）。

---

## 争议与存疑

### 已核实为「有意设计」，不作为问题上报

1. **读超时恒禁用 + 零空闲界**（`:76-80`、`:157-161`）：
   RULE.md:95「LLM 流式请求不设固定空闲超时（产品拍板，2026-09-26）」明确记录——流式的合法停顿
   （思考、GLM `tool_stream=false` 的服务端憋生成、排队）与死流无法区分，固定阈值必然误杀，
   已两轮真机实锤。**标 intentional**，出处 `docs/apm/RULE.md:95` + spec §2「实施修正记录」。
   本次深审未发现该决策有新的反证。

2. **`kind: "http"` Kotlin 侧从不主动发射**：
   spec §2「口径登记（D9）」写明——native 只在网络/超时两类归类，HTTP 层失败由 JS 包装侧据
   `LlmSseHeaders` 携带的 status 归纳。已核对 `transport.ts:206-222` 确实自行构造 `kind:"http"`。
   **标 intentional**，属枚举预留而非漂移。

3. **`sseConnect` 的 `readTimeoutMs` 入参保留但不用**：
   spec §2 + RULE.md:95 登记为「仅为 JS 接口兼容」。**标 intentional**。
   但见 F-10 / F-11——保留形态本身引入了两处文案失真与一处误导性导出。

4. **legacy `ReactPackage` 而非 TurboModule codegen**：
   spec §2「Native API 面」+ 风险节「若 0.8x 升级移除 interop，届时迁 codegen（登记）」。
   已实测 `ReactPackageTurboModuleManagerDelegate.kt:61-104` 走 legacy 分支
   （`shouldEnableLegacyModuleInterop = enableBridgelessArchitecture() && useTurboModuleInterop()`，
   `:192`），当前 mobile `newArchEnabled=true` 且 interop 默认开，路径成立。
   同款写法在 `packages/sksp-android/android/.../SkspPackage.kt:8` 也有，属仓库既有惯例。
   **标 intentional**。

5. **每连接 `newBuilder()` 克隆 client**（`:267-274`）：
   初看像「每连接新建 client 会炸连接池」，实测 OkHttp 复制构造按引用共享
   `connectionPool` / `dispatcher`，**连接池复用成立**。见 F-6，仅为 P3 分配开销，非正确性问题。

### 存疑（需下一轮验证，我不下定论）

6. **`completeUtf8PrefixLength`（`:322-347`）的正确性——我逐例推演后判定为正确，但边界值得再验。**
   这是本区域最需要小心的一段逻辑（把「半个中文字符」劈成两个替换符是它要防的事故）。
   我按 UTF-8 规范手工走了一遍：`E4 B8`（3 字节序列的前 2 字节）→ 返回 `size-2` ✓；
   `E4 B8 AD`（完整）→ 返回 `size` ✓；`F0 9F 98`（4 字节序列的前 3 字节）→ 返回 `size-3` ✓；
   单个 lead byte → 返回 0 ✓；`back >= sequenceLength` 的判定等价于「从 lead 到尾的字节数够不够」✓；
   4 个连续 continuation 字节无 lead 时保守按完整处理（`:345-346` 注释与实现一致）✓。
   也确认了 Kotlin 的中缀 `and` 优先级高于 `==`（`b.toInt() and 0x80 == 0x00` 解析为
   `(b.toInt() and 0x80) == 0x00`），不存在优先级陷阱；`Byte.toInt()` 的符号扩展也未破坏
   `0x80`/`0xC0` 掩码判定。
   **但**：`okio.Buffer` 的索引器编译到 `getByte(long)`（`javap` 实测只有 `getByte`，无 `get`），
   该方法需遍历 segment 链定位，`carry` 虽被控制在 ~16KB + 3 字节内（`pumpStream` 每轮
   `readUtf8(safe)` 消费掉绝大部分），段数极少，所以当前无性能问题。
   **存疑点**：非法前导字节（F8+）被按 2 字节切（`:339` 注释），若服务端真的送来 F8+ 开头，
   切出来的边界理论上仍可能劈开后续合法序列——注释承认「不阻塞流」的取舍。
   建议 W6 对这一段做逐字节 fuzz（Kotlin 单测基建本期未引入，见 spec §2 登记）。

7. **`pumpStream` 在 EOF 时丢弃 `carry` 残余字节**（`:303-305`）：
   `read == -1L` 时直接 `break`，`carry` 里最多 3 字节未完成的 UTF-8 尾部被静默丢弃。
   对**被截断的**流这是正确行为（半个字符本就无法还原）。但如果服务端在 chunk 边界处
   合法地切断后又补发（HTTP chunked 编码边界与 UTF-8 字符边界不重合是**正常**的），
   这里的 `carry` 机制正是为此而设——所以我倾向认为 EOF 时丢弃也是对的。
   **存疑**：无法从代码判断 OkHttp 的 `BufferedSource` 是否会在 `read` 返回 -1 前
   保证已把 socket 缓冲读完；若不能，`carry` 里的残余可能是「该来的没来」而非「不该来的」。

8. **`emitHeaders` 不走闸门（F-9）在当前 JS 消费面确实无危害**，
   但我没有找到任何文档登记「Headers 允许越过 abort」这条豁免。
   也就是说：要么模块文档 `:36` 的「abort 后不再发任何事件」是**过强的表述**（实际有 Headers 豁免），
   要么 `:152` 缺闸门是真漏。**两边必须有一边改**，我倾向前者（改文档），
   因为闸门加在 `emitHeaders` 上会让「abort 早于建流」的场景丢失 Headers——
   而 JS 侧 `onDone` 对 `status == null` 的处理（`transport.ts:192-205`，
   reject "stream ended before headers"）恰好说明 wrapper **预期**了「Done 但无 Headers」是合法形态。
   这条留给裁决。

9. **`Promise.resolve` / `emitEvent` 的跨线程安全性**：
   `request()` 在 `llm-sse-reader` 线程调 `promise.resolve(result)`（`:219`），
   `emitEvent` 在 reader / flush 线程调 `jsModule.emit(...)`。
   RN 的 Promise 回调与 `JavaScriptModule` 调用均通过 JS 线程队列转发，是官方支持的跨线程用法；
   `PromiseImpl.kt`（`:132-207`）也未见线程断言。**未发现线程模型缺陷**，
   但我**没有**上真机做并发压测，「reader 线程与 flush 线程并发调 emit 是否有序列化保证」这一点
   依赖 RN 内部实现，未实测确认。建议 W6 若有真机窗口，补一条并发流的 logcat 验证。
