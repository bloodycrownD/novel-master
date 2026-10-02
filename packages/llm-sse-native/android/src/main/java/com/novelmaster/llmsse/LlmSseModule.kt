package com.novelmaster.llmsse

import android.content.pm.ApplicationInfo
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.Buffer
import okio.BufferedSource
import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * LLM SSE 原生字节管子（spec llm-stream-native §2）。
 *
 * 纪律：只搬字节不认协议——SSE 帧解析留在 JS 侧 core parser，native 读循环
 * 只做「响应体字节 → UTF-8 文本 → 合批（100ms | 64KB 先到者）→ LlmSseChunk 事件」。
 *
 * 生命周期（对每个 requestId 至多一轮）：
 * LlmSseHeaders → LlmSseChunk*（合批后 ~10 事件/s 量级）→ LlmSseDone / LlmSseError。
 * 主动 abort（sseAbort）后不再发任何事件。
 */
class LlmSseModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    /** NativeEventEmitter 事件名（JS wrapper 按同名订阅）。 */
    const val EVENT_HEADERS = "LlmSseHeaders"
    const val EVENT_CHUNK = "LlmSseChunk"
    const val EVENT_DONE = "LlmSseDone"
    const val EVENT_ERROR = "LlmSseError"

    /**
     * 已退役的空闲超时默认值（保留常量与 sseConnect 的 readTimeoutMs 参数
     * 仅为 JS 接口兼容）：流式流体现在不设空闲界——首字与流体停顿均由
     * callTimeout 单一兜底（产品拍板：流式不应有固定空闲时间限制）。
     * callTimeout 默认 600s：整调用兜底（connect + 首字 + 流体全周期）。
     */
    const val DEFAULT_READ_TIMEOUT_MS = 30_000L
    const val DEFAULT_CALL_TIMEOUT_MS = 600_000L

    /** 合批参数：100ms 定时与 64K 字符阈值先到者 flush 一次（阈值按 UTF-16 字符计，中文场景约 192KB 字节）。 */
    private const val FLUSH_INTERVAL_MS = 100L
    private const val FLUSH_THRESHOLD_CHARS = 64 * 1024

    /** 单次 source.read 的字节上限（与合批阈值解耦，只控制拷贝粒度）。 */
    private const val READ_CHUNK_BYTES = 16 * 1024L

    private val JSON_MEDIA_TYPE = "application/json".toMediaType()

    /** debugLog 的 logcat tag。 */
    const val TAG = "nm-llm-sse"
  }

  /**
   * 自有 OkHttpClient：独立 ConnectionPool（与 RN 网络层互不复用连接）。
   *
   * client 级读超时**恒禁用**（0 = 无限）：OkHttp 的 readTimeout 从 connect 后
   * 的第一次读就开始计时，会罩住「等首字节/等响应」——非流式请求的响应
   * 等待与流式的首字等待都是正常形态，不应设 30s 界（真机实锤：非流式
   * 大 prompt 30s 超时 × 重试一次 = 用户看到的 ~60s 报错）。流式流体会话内
   * 也不再挂任何空闲界（首字与流体停顿均由 callTimeout 单一兜底）。
   */
  private val baseClient: OkHttpClient = OkHttpClient.Builder()
    .connectionPool(ConnectionPool())
    .readTimeout(0, TimeUnit.MILLISECONDS)
    .callTimeout(DEFAULT_CALL_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .build()

  /** 流式读循环线程池：同步 execute()，不占 OkHttp dispatcher 的 async 配额。 */
  private val executor = Executors.newCachedThreadPool { runnable ->
    Thread(runnable, "llm-sse-reader").apply { isDaemon = true }
  }

  /** 合批定时器（单线程足够：per-request 状态各自加锁，调度本身极轻）。 */
  private val flushScheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "llm-sse-flush").apply { isDaemon = true }
  }

  /** requestId → 活跃 Call（abort 与登记表清理均经此）。 */
  private val calls = ConcurrentHashMap<String, Call>()

  /** requestId → 流状态（事件闸门：移除后不再向 JS 发该请求的事件）。 */
  private val streams = ConcurrentHashMap<String, StreamState>()

  /**
   * requestId → 「本次失败是用户主动 abort 造成的」一次性标记。
   *
   * 旧形态用 `call.isCanceled()` 当 abort 判据，但 OkHttp 自己的 callTimeout
   * 到点时 `AsyncTimeout.timedOut()` 会调 `RealCall.cancel()` ⇒ `isCanceled()`
   * 为 true。而 [sseAbort] 的顺序是「先 streams.remove 再 cancel」，用户 abort
   * 在 `handleStreamFailure` 读到 state 已是 null、早早 return，**根本走不到**
   * 那个闸门 ⇒ 它实际拦掉的恰恰是唯一不该拦的那一类（超时），而它声称要拦的
   * 那一类早在三行之前就被拦掉了。
   *
   * 结果是 callTimeout 到点后 JS 侧既收不到 Done 也收不到 Error ⇒
   * `llm-sse-transport` 的 `post()` Promise 永不 settle ⇒ run 挂到用户手动停止。
   *
   * 「谁取消的」只有本模块知道，所以用显式标记而不是读 OkHttp 的状态。
   * 一次性消费（`remove`，不是 `containsKey`）——见 [handleStreamFailure] 开头
   * 的顺序说明。标记的三处生命周期：`sseAbort` 写入、`handleStreamFailure`
   * 与 `finishStream` 消费、`shutdown` 清空。
   */
  private val userAborted = ConcurrentHashMap<String, Boolean>()

  /** 每请求的合批缓冲与定时句柄；读循环线程与 flush 线程并发访问，靠自身锁串行。 */
  private class StreamState(
    val requestId: String,
    /** 建流时刻（System.nanoTime，单调钟；跨墙钟跳变安全）。 */
    val startedAtNanos: Long,
    /** 本请求生效的整调用预算（ms），口径与 clientWithCallTimeout 一致。 */
    val effectiveCallTimeoutMs: Long,
  ) {
    val pending = StringBuilder()
    var flushTask: ScheduledFuture<*>? = null
  }

  /** 仅 debuggable 构建输出计数日志，供真机 logcat 核对 abort/timeout/残留。 */
  private val debugLoggable: Boolean by lazy {
    (reactApplicationContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
  }

  override fun getName(): String = "LlmSseNative"

  // ------------------------------------------------------------------
  // SSE 流式连接（事件驱动，无 Promise）
  // ------------------------------------------------------------------

  /**
   * 建立 SSE 流：读循环搬运响应体字节，合批后经 LlmSseChunk 事件回传。
   *
   * @param headersKv 扁平键值对 ["k1","v1","k2","v2",...]（ReadableArray 传输最省）
   * @param readTimeoutMs / callTimeoutMs 传 0 或负数则用默认值（per-request
   *   覆盖经 newBuilder 克隆 client，共享连接池——RN 官方同款手法）；
   *   readTimeoutMs 已退役（读超时恒禁用），保留入参仅为 JS 接口兼容。
   */
  @ReactMethod
  fun sseConnect(
    requestId: String,
    url: String,
    headersKv: ReadableArray,
    body: String,
    readTimeoutMs: Int,
    callTimeoutMs: Int,
  ) {
    if (requestId.isEmpty()) {
      return
    }
    val request = try {
      buildRequest("POST", url, headersKv, body)
    } catch (t: Throwable) {
      // URL 非法等同步失败：按 network 错误走事件通道（与流中失败同一条路）。
      emitError(requestId, "network", t.message ?: "build request failed")
      return
    }
    val client = clientWithCallTimeout(callTimeoutMs)
    // readTimeoutMs 已退役（流式不设空闲界）：param 仅保 JS 接口兼容，
    // 该值当前只用于 SocketTimeoutException 的防御性错误文案。
    val effectiveReadTimeoutMs =
      if (readTimeoutMs > 0) readTimeoutMs.toLong() else DEFAULT_READ_TIMEOUT_MS
    val call = client.newCall(request)
    if (calls.putIfAbsent(requestId, call) != null) {
      emitError(requestId, "network", "duplicate requestId: $requestId")
      return
    }
    val state = StreamState(
      requestId,
      System.nanoTime(),
      effectiveCallTimeoutMs(callTimeoutMs),
    )
    streams[requestId] = state
    executor.execute {
      try {
        call.execute().use { response ->
          emitHeaders(requestId, response.code, response.header("Content-Type"))
          val source = response.body?.source()
          if (source == null) {
            throw IOException("response body is null")
          }
          // headers 已到（execute 返回）：对流体**不设空闲界**——流式的合法
          // 停顿（思考、工具调用非流段服务端憋生成、排队）与死流无法区分，
          // 固定阈值必然误杀（GLM tool_stream 默认 false 实锤）。唯一自动
          // 兜底是 client 级 callTimeout；死流由用户手动终止（sseAbort）。
          pumpStream(state, source)
          flushPending(state)
          finishStream(requestId, state)
        }
      } catch (t: Throwable) {
        handleStreamFailure(requestId, call, t, effectiveReadTimeoutMs)
      } finally {
        calls.remove(requestId)
      }
    }
  }

  /** 主动中止：写显式标记 + 关事件闸门 + cancel（读循环随后抛 IOException，按标记静默收尾）。 */
  @ReactMethod
  fun sseAbort(requestId: String) {
    // 标记必须**先于** streams.remove 写入：handleStreamFailure 的一次性消费
    // 在读 state 之前发生（否则 state==null 提前 return 会让标记永远泄漏）。
    userAborted[requestId] = true
    streams.remove(requestId)
    val call = calls.remove(requestId)
    try {
      call?.cancel()
    } catch (_: Throwable) {
      // cancel 失败无需处理：callTimeout 兜底
    }
    debugLog("sse_abort requestId=$requestId userAbortedPending=${userAborted.size}")
  }

  // ------------------------------------------------------------------
  // 非流式请求-响应（request，Promise）
  // ------------------------------------------------------------------

  /**
   * 非流式请求（listModels GET / chatNonStream POST 底座）。
   * 非 2xx 不 reject——status 与 body 原样带回，由 JS 侧 assertOk 处理；
   * 网络类失败 reject，code 取错误分类（"network" | "timeout"）。
   */
  @ReactMethod
  fun request(
    method: String,
    url: String,
    headersKv: ReadableArray,
    body: String?,
    callTimeoutMs: Int,
    promise: Promise,
  ) {
    executor.execute {
      try {
        val effectiveMethod = if (method.equals("GET", ignoreCase = true)) "GET" else "POST"
        val request = buildRequest(effectiveMethod, url, headersKv, body)
        val client = if (callTimeoutMs > 0) {
          baseClient.newBuilder()
            .callTimeout(callTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .build()
        } else {
          baseClient
        }
        client.newCall(request).execute().use { response ->
          val result = Arguments.createMap()
          result.putInt("status", response.code)
          result.putString("contentType", response.header("Content-Type"))
          result.putString("body", response.body?.string() ?: "")
          promise.resolve(result)
        }
      } catch (t: Throwable) {
        // 非流式走 baseClient：读超时已恒禁用（此处传默认数值仅供防御性文案）。
        // 非流式的 callTimeout 会正常抛 InterruptedIOException("timeout")
        // （messageDone 路径可达），已能归 timeout —— 只需补上新参数。
        val (kind, message) = classifyError(
          t,
          DEFAULT_READ_TIMEOUT_MS,
          call = null,
          userAbortedHit = false,
          startedAtNanos = 0L,
          effectiveCallTimeoutMs = DEFAULT_CALL_TIMEOUT_MS,
        )
        promise.reject(kind, message, t)
      }
    }
  }

  // ------------------------------------------------------------------
  // 生命周期清理
  // ------------------------------------------------------------------

  override fun invalidate() {
    super.invalidate()
    shutdown()
  }

  @Deprecated("Deprecated in RN bridgeless")
  @Suppress("DEPRECATION")
  override fun onCatalystInstanceDestroy() {
    super.onCatalystInstanceDestroy()
    shutdown()
  }

  private fun shutdown() {
    for ((_, call) in calls) {
      try {
        call.cancel()
      } catch (_: Throwable) {
      }
    }
    calls.clear()
    streams.clear()
    userAborted.clear()
    flushScheduler.shutdownNow()
    executor.shutdownNow()
  }

  // ------------------------------------------------------------------
  // 内部：请求构造 / 读循环 / 合批
  // ------------------------------------------------------------------

  /**
   * per-request 整调用预算（克隆 builder 共享连接池，RN 官方同款手法）。
   * 读超时不在此设置——client 级读超时已恒禁用（见 baseClient 注释），
   * 流式全程不设空闲界；唯一自动兜底即此处的 callTimeout。
   */
  private fun clientWithCallTimeout(callTimeoutMs: Int): OkHttpClient {
    if (callTimeoutMs <= 0) {
      return baseClient
    }
    return baseClient.newBuilder()
      .callTimeout(callTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
      .build()
  }

  /**
   * 本请求生效的整调用预算（ms），供 callTimeout 归类判定使用。
   *
   * ⚠️ 与 [clientWithCallTimeout] 的分支口径**必须一致，改一处要改两处**：
   * `callTimeoutMs <= 0` 时 client 走 `baseClient`（预算 600s），若这里直接存
   * `callTimeoutMs` 本身（可能是 -1），`elapsed >= effectiveCallTimeoutMs`
   * 会恒真、保险条件失效。
   */
  private fun effectiveCallTimeoutMs(callTimeoutMs: Int): Long =
    if (callTimeoutMs > 0) callTimeoutMs.toLong() else DEFAULT_CALL_TIMEOUT_MS

  private fun buildRequest(
    method: String,
    url: String,
    headersKv: ReadableArray,
    body: String?,
  ): Request {
    val builder = Request.Builder().url(url)
    var i = 0
    while (i + 1 < headersKv.size()) {
      val name = headersKv.getString(i)
      val value = headersKv.getString(i + 1)
      if (name != null && value != null) {
        builder.addHeader(name, value)
      }
      i += 2
    }
    return when {
      method.equals("GET", ignoreCase = true) -> builder.get().build()
      body != null -> builder.post(body.toRequestBody(JSON_MEDIA_TYPE)).build()
      else -> builder.post("".toRequestBody(JSON_MEDIA_TYPE)).build()
    }
  }

  /** 读循环：字节搬进 per-request 缓冲，UTF-8 不完整尾部留在 carry 跨迭代拼接。 */
  private fun pumpStream(state: StreamState, source: BufferedSource) {
    val carry = Buffer()
    while (true) {
      val read = source.read(carry, READ_CHUNK_BYTES)
      if (read == -1L) {
        break
      }
      val safe = completeUtf8PrefixLength(carry)
      if (safe > 0) {
        val text = carry.readUtf8(safe)
        synchronized(state) {
          state.pending.append(text)
        }
        maybeFlush(state)
      }
    }
  }

  /**
   * 返回 buffer 中「最后一个完整 UTF-8 序列」之前的长度；不完整的多字节尾部
   * 留在 buffer 里等下一次读拼接（防止把一个中文字符劈成两个替换符）。
   */
  private fun completeUtf8PrefixLength(buf: Buffer): Long {
    val size = buf.size
    if (size == 0L) {
      return 0L
    }
    var back = 1L
    while (back <= 4L && back <= size) {
      val b = buf[size - back]
      if (b.toInt() and 0x80 == 0x00) {
        return size // 尾字节是 ASCII：全部完整
      }
      if (b.toInt() and 0xC0 == 0xC0) {
        // 前导字节：按其声明的序列长度判断尾部序列是否完整
        val sequenceLength = when (b.toInt() and 0xF8) {
          0xF0 -> 4L
          0xE0 -> 3L
          0xC0 -> 2L
          else -> 2L // 非法前导（F8+ 等）：保守按 2 字节切，不阻塞流
        }
        return if (back >= sequenceLength) size else size - back
      }
      back++
    }
    // 连续 4 个 continuation 字节仍未遇前导：非法 UTF-8，保守丢弃判定按完整处理
    return size
  }

  /** 阈值先到即 flush；否则起 100ms 定时（已有 pending 定时则不重置）。 */
  private fun maybeFlush(state: StreamState) {
    val overThreshold = synchronized(state) { state.pending.length >= FLUSH_THRESHOLD_CHARS }
    if (overThreshold) {
      flushPending(state)
      return
    }
    val hasTimer = synchronized(state) { state.flushTask != null }
    if (!hasTimer) {
      val task = flushScheduler.schedule({ flushPending(state) }, FLUSH_INTERVAL_MS, TimeUnit.MILLISECONDS)
      synchronized(state) {
        if (state.flushTask == null) {
          state.flushTask = task
        } else {
          task.cancel(false)
        }
      }
    }
  }

  /**
   * flush 缓冲余量为一个 LlmSseChunk 事件；幂等，读循环与定时器线程均可调。
   *
   * 「闸门检查 + emitChunk」整体在 state 锁内完成，与 [finishStream] 的
   * 「关闸 + emitDone」互斥：否则定时器线程可能先取走缓冲、再被读循环的收尾
   * 插队（Done 已发）→ 流尾批被静默丢弃；或反过来让 Chunk 落在 Done 之后。
   */
  private fun flushPending(state: StreamState) {
    synchronized(state) {
      state.flushTask?.cancel(false)
      state.flushTask = null
      if (state.pending.isEmpty()) {
        return
      }
      val snapshot = state.pending.toString()
      state.pending.setLength(0)
      // 事件闸门：流已被 abort/终结时不再发（streams 移除即关闸，余量丢弃）
      if (!streams.containsKey(state.requestId)) {
        return
      }
      emitChunk(state.requestId, snapshot)
    }
  }

  /**
   * 流收尾：同锁内完成「兜底 flush + 关闸 + emitDone」。
   *
   * 与 [flushPending] 共用 state 锁 → 同一 requestId 的 Chunk/Done 严格串行、
   * Done 恒为最后一个事件：先到的 flush 一定先 emit，晚到的 flush 见闸门已关
   * 即丢弃。闸门已被 abort 关掉时不重复发终结事件。
   */
  private fun finishStream(requestId: String, state: StreamState) {
    synchronized(state) {
      // 一次性消费必须**早于** streams 闸门（与 [handleStreamFailure] 同一口径）：
      // 流读完后 call.execute().use 尚未退出时用户点「停止」，sseAbort 会先写标记 +
      // streams.remove；读循环随后进本方法命中下面的闸门早退——若把 remove 放在
      // `!streams.containsKey(requestId)` 的 return 之后，这条标记就永远不会被消费
      // （每点一次「停止」往 map 里永久留一条，userAbortedPending 归不了零），
      // 且因无异常发生、handleStreamFailure 也不会来兜底。注释宣称覆盖的竞态
      // 恰被自己的代码位置挡住。
      userAborted.remove(requestId)
      if (!streams.containsKey(requestId)) {
        return
      }
      // 读循环收尾已显式 flush 过一次；这里再兜一层（幂等），保证 ≤100ms
      // 窗口内的最后一批一定落在 Done 之前。
      flushPending(state)
      streams.remove(requestId)
      emitDone(requestId)
    }
  }

  /**
   * 读循环/建流失败收尾：同锁内「关闸 + emitError」，与 [flushPending] 的
   * 闸门检查互斥（Error 同 Done：恒为该 requestId 的最后一个事件）。
   */
  private fun handleStreamFailure(
    requestId: String,
    call: Call,
    t: Throwable,
    effectiveReadTimeoutMs: Long,
  ) {
    // 一次性消费必须**早于** streams 闸门：用户主动 abort 时 sseAbort 已先
    // streams.remove，这里读到的 state 会是 null，若把 remove 放在
    // `state == null` 的 return 之后，标记就永远不会被消费掉（每点一次「停止」
    // 往 map 里永久留一条）。
    val userAbortedHit = userAborted.remove(requestId) == true
    val state = streams[requestId]
    if (state == null || userAbortedHit) {
      debugLog(
        "stream_failure_silent requestId=$requestId userAborted=$userAbortedHit " +
          "statePresent=${state != null} userAbortedPending=${userAborted.size}"
      )
      return // 闸门已关（abort 或正常收尾）/ 用户主动中止：不再发终结事件
    }
    synchronized(state) {
      if (!streams.containsKey(requestId)) {
        return
      }
      streams.remove(requestId)
      // 分类与发事件同在 state 锁内；但**不要**据此认为 userAborted 的读写已同锁闭合：
      // 传进来的 userAbortedHit 是上面 `userAborted.remove(requestId)` 在**锁外**取出的
      // 一次性消费结果，classifyError 锁内**不再读 map** ⇒ spec 风险 R2 登记的
      // 「消费 vs 写入」错位窗口（abort 打在分类之后）并未被本锁消除，此处只是已知的
      // 残余窗口，不是「已闭合」的证明。
      // userAbortedHit 到这里可证恒为 false（上面的 userAbortedHit 早退已滤掉 true），
      // 故 classifyError 里的 `&& !userAbortedHit` 是恒真的死条件；参数按签名保留，
      // 供将来非流式路径复用，不作删减。
      val (kind, message) = classifyError(
        t,
        effectiveReadTimeoutMs,
        call,
        userAbortedHit,
        state.startedAtNanos,
        state.effectiveCallTimeoutMs,
      )
      debugLog(
        "stream_failure requestId=$requestId kind=$kind elapsedMs=" +
          "${(System.nanoTime() - state.startedAtNanos) / 1_000_000} " +
          "userAbortedPending=${userAborted.size}"
      )
      emitError(requestId, kind, message)
    }
  }

  /**
   * 错误分类：callTimeout 归 timeout，其余按异常类型归类。
   *
   * 新增的 callTimeout 分支：`call.isCanceled() && 非用户 abort` 时读循环抛的
   * 是 IOException，而「本模块里谁会 cancel 一个 call」只有三处——`sseAbort`
   * （用户，已被 userAborted 标记排除）、`shutdown()`（走 streams.clear()，
   * state==null 已在闸门处拦掉）、OkHttp 自己的 callTimeout。所以这个组合的
   * 唯一可能来源就是 callTimeout，elapsed 判定只是把「万一是别的原因」排除掉
   * 的保险。
   *
   * ⚠️ **本条不改预算**（600s 仍是 connect + 首字 + 流体全周期的整调用兜底，
   * 流式不设固定空闲超时那条产品口径不变）：只把「到点形态」从**静默**
   * （一个事件都不发 ⇒ JS Promise 永不 settle）改成发 `kind:"timeout"` 事件。
   *
   * SocketTimeoutException 分支为防御性保留——client 级读超时恒禁用、流中
   * 无空闲界，正常不可达；真触发时 message 携带数值供 JS 侧文案透传来源。
   */
  private fun classifyError(
    t: Throwable,
    effectiveReadTimeoutMs: Long,
    call: Call?,
    userAbortedHit: Boolean,
    startedAtNanos: Long,
    effectiveCallTimeoutMs: Long,
  ): Pair<String, String> {
    if (call?.isCanceled() == true && !userAbortedHit) {
      val elapsedMs = (System.nanoTime() - startedAtNanos) / 1_000_000
      if (elapsedMs >= effectiveCallTimeoutMs) {
        return "timeout" to "call timeout after ${effectiveCallTimeoutMs}ms"
      }
    }
    return when (t) {
      is SocketTimeoutException ->
        "timeout" to "read timeout after ${effectiveReadTimeoutMs}ms"
      is InterruptedIOException ->
        if (t.message?.contains("timeout", ignoreCase = true) == true) {
          "timeout" to (t.message ?: "timeout")
        } else {
          "network" to (t.message ?: "interrupted")
        }
      is IOException -> "network" to (t.message ?: t.javaClass.simpleName)
      else -> "network" to (t.message ?: t.javaClass.simpleName)
    }
  }

  // ------------------------------------------------------------------
  // 事件发射
  // ------------------------------------------------------------------

  /**
   * 仅 debuggable 构建输出的一行计数日志（abort 次数 / timeout 次数 / 标记残留数）。
   *
   * 本包**没有** JVM 测试基建（仓内只有 `tokenizer-driver-rn` 有 android/src/test），
   * 为这两个方法新建 Robolectric 基建不划算 ⇒ 「不建基建」不等于「不加日志」：
   * 真机 logcat 核对是本条验收（用户 abort 仍静默、callTimeout 必须发 Error、
   * userAborted 三种路径各一次后不残留）的唯一可观测面。
   *
   * 用 ApplicationInfo.FLAG_DEBUGGABLE 而非 BuildConfig.DEBUG：本 Android library
   * 模块未开 `buildConfig` feature，引用模块 BuildConfig 需要额外的 gradle 改动。
   */
  private fun debugLog(message: String) {
    if (!debugLoggable) {
      return
    }
    try {
      Log.d(TAG, message)
    } catch (_: Throwable) {
    }
  }

  private fun emitEvent(name: String, build: (WritableMap) -> Unit) {
    try {
      val jsModule = reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      val params = Arguments.createMap()
      build(params)
      jsModule.emit(name, params)
    } catch (_: Throwable) {
      // bridge 已关停时发事件失败：不 crash（流本身也会因 executor 关闭而终止）
    }
  }

  private fun emitHeaders(requestId: String, status: Int, contentType: String?) {
    emitEvent(EVENT_HEADERS) { params ->
      params.putString("requestId", requestId)
      params.putInt("status", status)
      params.putString("contentType", contentType)
    }
  }

  private fun emitChunk(requestId: String, text: String) {
    emitEvent(EVENT_CHUNK) { params ->
      params.putString("requestId", requestId)
      params.putString("text", text)
    }
  }

  private fun emitDone(requestId: String) {
    emitEvent(EVENT_DONE) { params ->
      params.putString("requestId", requestId)
    }
  }

  private fun emitError(requestId: String, kind: String, message: String) {
    emitEvent(EVENT_ERROR) { params ->
      params.putString("requestId", requestId)
      params.putString("kind", kind)
      params.putString("message", message)
    }
  }
}
