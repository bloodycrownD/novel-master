package com.novelmaster.tokenizer

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.util.concurrent.Executors

/**
 * Android native prompt tokenizer bridge (M1).
 *
 * Input is the serialized prompt string from `serializePromptLlmInput`. WEB families
 * wrap it as a single system message before encode (ST / core web path). SP families
 * encode plain serialized text. Failures reject the promise — JS side
 * (`countPromptViaNative`) catches and falls back to the cl100k path.
 *
 * **计数跑在模块自己的单线程 executor 上（2026-09-30）**：`@ReactMethod` 默认
 * 在 RN 的 NativeModules 队列上**内联**执行，而 WEB/SP 家族的整串计数在冷词表
 * 时可达数秒（glm.json 8.2MB 解析 + DJL 会话建立）——它会把同一条队列上的其它
 * 原生调用（含 llm-sse 的 `sseConnect` 派发）一起堵住，表现为「发完消息很久
 * 才开始出字」「进会话偶发卡死」。JS 侧本来就是 await Promise，换线程对调用方
 * 完全透明。**单线程而非线程池**：TokenizerEngine 的词表 LruCache 与 DJL 会话
 * 按串行使用最稳，并发计数只会互相抢内存。
 *
 * **可取消（tokenizer-native-cancel，2026-10-02）**：真机实报切换项目后 chip 上下文
 * 精确升级轮 resolve 耗时 14.2s（logcat `[nm-chip] resolve done +14234ms`），期间
 * 侧滑返回事件排队、UI「突然卡住」——根因是原生计数中段不可中断。修法是 JS 侧
 * 下发取消指令、Kotlin 侧在检查点短路弃置。三个语义检查点由**两处调用点**覆盖：
 * Module 的任务出队检查（①），与 Engine 内「词表加载后、encode 调用前」的同一次
 * shouldCancel 回调（②③——两者之间无可切分语句，合并为一次检查）。注意 WEB 家族
 * encode 内部不再有检查点（单次 JNI 不可中断）。取消与真失败用**不同的 reject
 * code** 区分（`TOKENIZER_COUNT_CANCELLED` vs 既有的 `TOKENIZER_COUNT_FAILED`），
 * JS 侧据此把取消收成「无回调」，而不是掉进兜底全量重算。
 */
class TokenizerModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val engine = TokenizerEngine(reactContext.applicationContext)
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "nm-tokenizer").apply { isDaemon = true }
  }

  /**
   * 取消标记表。任务体 `finally` 里 [CountCancelState.finish] 逐 id 收口，Module
   * 析构时 [CountCancelState.clearAll] 兜底；两处都不依赖 executor shutdown——
   * 单线程 executor 是 daemon 线程随进程走（中途打断会毁掉 LruCache 里的 DJL
   * 会话，不划算）。
   */
  private val cancelState = CountCancelState

  override fun getName(): String = "NovelMasterTokenizer"

  @ReactMethod
  fun countPrompt(
    serialized: String,
    family: String,
    @Suppress("UNUSED_PARAMETER") vendorModelId: String,
    promise: Promise,
  ) {
    executor.execute {
      try {
        val result = engine.count(serialized, family)
        val map = WritableNativeMap()
        map.putInt("tokenCount", result.tokenCount)
        map.putString("counterKind", result.counterKind)
        map.putBoolean("estimated", result.estimated)
        promise.resolve(map)
      } catch (e: Throwable) {
        // 失败一律 reject：不再折算 heuristic 值，由 JS 桥的 catch→null 分支走兜底路径。
        promise.reject("TOKENIZER_COUNT_FAILED", e.message ?: "原生分词计数失败", e)
      }
    }
  }

  // ------------------------------------------------------------------
  // 可取消计数（tokenizer-native-cancel，2026-10-02）
  // ------------------------------------------------------------------

  /**
   * 可取消的计数入口，**新增独立方法**而非给 [countPrompt] 加参。
   *
   * 为什么不能加参：RN 0.85 的两条调用路径（legacy `JavaMethodWrapper.kt:191-195`
   * 与 bridgeless `JavaTurboModule.cpp:299-308`）都在调用前做严格 arity 校验，
   * 加参会让「旧 JS 调新 Kotlin」和「新 JS 调旧 Kotlin」双向硬抛。独立新方法下
   * 四象限全兼容：旧 JS + 新壳走旧三参 [countPrompt]（行为=现状）、新 JS + 旧壳
   * 探测不到本方法也走旧三参（取消 no-op）。
   *
   * [requestId] 必须非空：bridgeless 桥对 String 参数传 null/undefined 硬抛
   * （`JavaTurboModule.cpp:400-404`），所以「不可取消」的轮根本不进本方法，由 JS
   * 侧二分口径保证。
   */
  @ReactMethod
  fun countPromptCancelable(
    serialized: String,
    family: String,
    @Suppress("UNUSED_PARAMETER") vendorModelId: String,
    requestId: String,
    promise: Promise,
  ) {
    executor.execute {
      try {
        // 检查点 ①：任务出队时。取消指令可能早于任务真正开跑送达（JS 线程当时正
        // 被同一瓶颈堵着），这里能在零成本处弃置整轮。
        throwIfCancelled(requestId)
        val shouldCancel: () -> Boolean = {
          // Engine 在「词表加载后」与「encode 前」两个回调点调它（检查点 ②③）。
          throwIfCancelled(requestId)
          false
        }
        val result = engine.count(serialized, family, shouldCancel)
        val map = WritableNativeMap()
        map.putInt("tokenCount", result.tokenCount)
        map.putString("counterKind", result.counterKind)
        map.putBoolean("estimated", result.estimated)
        promise.resolve(map)
      } catch (e: TokenizerCountCancelledException) {
        // 取消是**正常收口**不是失败：给专属 code，让 JS 侧识别后既不落兜底
        // 全量重算、也不写 L1。
        promise.reject(CODE_COUNT_CANCELLED, e.message ?: "原生分词计数已取消", e)
      } catch (e: Throwable) {
        // 失败一律 reject：不再折算 heuristic 值，由 JS 桥的 catch→null 分支走兜底路径。
        promise.reject(CODE_COUNT_FAILED, e.message ?: "原生分词计数失败", e)
      } finally {
        // 标记表不泄漏的唯一收口点：任务无论成功/失败/被取消，都清掉自己的标记。
        cancelState.finish(requestId)
      }
    }
  }

  /**
   * 下发取消指令，fire-and-forget（无 Promise）。JS 侧只关心「指令送达」，不关心
   * 取消是否真的生效——后者由上面 reject 的专属 code 回答。
   */
  @ReactMethod
  fun cancelCount(requestId: String) {
    cancelState.markCancelled(requestId)
  }

  /**
   * RN 0.85 bridgeless 下的实际析构路径（TurboModuleManager.invalidate →
   * NativeModule.invalidate）：清空标记表，避免 Module 重建后残留标记误杀新一轮。
   * 在途计数**不**中断——executor 是 daemon 线程随进程走。
   */
  override fun invalidate() {
    super.invalidate()
    cancelState.clearAll()
  }

  /** 旧架构（catalyst）下的无害兜底，与 [invalidate] 同款清理，不计收益。 */
  @Deprecated("Deprecated in RN bridgeless")
  @Suppress("DEPRECATION")
  override fun onCatalystInstanceDestroy() {
    super.onCatalystInstanceDestroy()
    cancelState.clearAll()
  }

  private fun throwIfCancelled(requestId: String) {
    if (cancelState.isCancelled(requestId)) {
      throw TokenizerCountCancelledException("原生分词计数已被取消: requestId=$requestId")
    }
  }

  private companion object {
    const val CODE_COUNT_FAILED = "TOKENIZER_COUNT_FAILED"
    const val CODE_COUNT_CANCELLED = "TOKENIZER_COUNT_CANCELLED"
  }
}

/**
 * 计数被取消的专用异常。与真失败区分开的意义在于「不该被包装成
 * `IllegalStateException`」——包装后 JS 侧就认不出取消 code，会掉进兜底重算。
 * 消息里带上可定位信息（requestId 或家族），真机 logcat 抓包时能直接对上。
 */
internal class TokenizerCountCancelledException(message: String) : RuntimeException(message)
