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
 */
class TokenizerModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val engine = TokenizerEngine(reactContext.applicationContext)
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "nm-tokenizer").apply { isDaemon = true }
  }

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
}
