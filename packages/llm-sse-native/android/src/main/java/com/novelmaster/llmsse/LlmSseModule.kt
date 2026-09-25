package com.novelmaster.llmsse

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

    /** 读超时默认 30s：首字与流中黑洞的界；callTimeout 默认 600s：整调用兜底。 */
    const val DEFAULT_READ_TIMEOUT_MS = 30_000L
    const val DEFAULT_CALL_TIMEOUT_MS = 600_000L

    /** 合批参数：100ms 定时与 64KB 阈值先到者 flush 一次。 */
    private const val FLUSH_INTERVAL_MS = 100L
    private const val FLUSH_THRESHOLD_CHARS = 64 * 1024

    /** 单次 source.read 的字节上限（与合批阈值解耦，只控制拷贝粒度）。 */
    private const val READ_CHUNK_BYTES = 16 * 1024L

    private val JSON_MEDIA_TYPE = "application/json".toMediaType()
  }

  /** 自有 OkHttpClient：独立 ConnectionPool（与 RN 网络层互不复用连接）。 */
  private val baseClient: OkHttpClient = OkHttpClient.Builder()
    .connectionPool(ConnectionPool())
    .readTimeout(DEFAULT_READ_TIMEOUT_MS, TimeUnit.MILLISECONDS)
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

  /** 每请求的合批缓冲与定时句柄；读循环线程与 flush 线程并发访问，靠自身锁串行。 */
  private class StreamState(val requestId: String) {
    val pending = StringBuilder()
    var flushTask: ScheduledFuture<*>? = null
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
   *   覆盖经 newBuilder 克隆 client，共享连接池——RN 官方同款手法）
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
    val client = clientWithTimeouts(readTimeoutMs, callTimeoutMs)
    val call = client.newCall(request)
    if (calls.putIfAbsent(requestId, call) != null) {
      emitError(requestId, "network", "duplicate requestId: $requestId")
      return
    }
    val state = StreamState(requestId)
    streams[requestId] = state
    executor.execute {
      try {
        call.execute().use { response ->
          emitHeaders(requestId, response.code, response.header("Content-Type"))
          val source = response.body?.source()
          if (source == null) {
            throw IOException("response body is null")
          }
          pumpStream(state, source)
          flushPending(state)
          finishStream(requestId, state)
        }
      } catch (t: Throwable) {
        handleStreamFailure(requestId, call, t)
      } finally {
        calls.remove(requestId)
      }
    }
  }

  /** 主动中止：关事件闸门 + cancel（读循环随后抛 IOException，被闸门拦住静默收尾）。 */
  @ReactMethod
  fun sseAbort(requestId: String) {
    streams.remove(requestId)
    val call = calls.remove(requestId)
    try {
      call?.cancel()
    } catch (_: Throwable) {
      // cancel 失败无需处理：callTimeout 兜底
    }
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
        val (kind, message) = classifyError(t)
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
    flushScheduler.shutdownNow()
    executor.shutdownNow()
  }

  // ------------------------------------------------------------------
  // 内部：请求构造 / 读循环 / 合批
  // ------------------------------------------------------------------

  private fun clientWithTimeouts(readTimeoutMs: Int, callTimeoutMs: Int): OkHttpClient {
    if (readTimeoutMs <= 0 && callTimeoutMs <= 0) {
      return baseClient
    }
    val builder = baseClient.newBuilder()
    if (readTimeoutMs > 0) {
      builder.readTimeout(readTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
    }
    if (callTimeoutMs > 0) {
      builder.callTimeout(callTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
    }
    return builder.build()
  }

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

  /** flush 缓冲余量为一个 LlmSseChunk 事件；幂等，读循环与定时器线程均可调。 */
  private fun flushPending(state: StreamState) {
    val text = synchronized(state) {
      state.flushTask?.cancel(false)
      state.flushTask = null
      if (state.pending.isEmpty()) {
        return
      }
      val snapshot = state.pending.toString()
      state.pending.setLength(0)
      snapshot
    }
    // 事件闸门：流已被 abort/终结时不再发（streams 移除即关闸）
    if (streams.containsKey(state.requestId)) {
      emitChunk(state.requestId, text)
    }
  }

  private fun finishStream(requestId: String, state: StreamState) {
    streams.remove(requestId)
    emitDone(requestId)
  }

  private fun handleStreamFailure(requestId: String, call: Call, t: Throwable) {
    streams.remove(requestId)
    if (call.isCanceled()) {
      return // 主动 abort：JS 侧已自行收尾，静默
    }
    val (kind, message) = classifyError(t)
    emitError(requestId, kind, message)
  }

  /** 错误分类：读超时（SocketTimeout）与 callTimeout（InterruptedIOException "timeout"）归 timeout。 */
  private fun classifyError(t: Throwable): Pair<String, String> = when (t) {
    is SocketTimeoutException -> "timeout" to (t.message ?: "read timeout")
    is InterruptedIOException ->
      if (t.message?.contains("timeout", ignoreCase = true) == true) {
        "timeout" to (t.message ?: "timeout")
      } else {
        "network" to (t.message ?: "interrupted")
      }
    is IOException -> "network" to (t.message ?: t.javaClass.simpleName)
    else -> "network" to (t.message ?: t.javaClass.simpleName)
  }

  // ------------------------------------------------------------------
  // 事件发射
  // ------------------------------------------------------------------

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
