package com.novelmaster.tokenizer

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

/**
 * Android native prompt tokenizer bridge (M1).
 *
 * Input is the serialized prompt string from `serializePromptLlmInput`. WEB families
 * wrap it as a single system message before encode (ST / core web path). SP families
 * encode plain serialized text. Failures reject the promise — JS side
 * (`countPromptViaNative`) catches and falls back to the cl100k path.
 */
class TokenizerModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val engine = TokenizerEngine(reactContext.applicationContext)

  override fun getName(): String = "NovelMasterTokenizer"

  @ReactMethod
  fun countPrompt(
    serialized: String,
    family: String,
    @Suppress("UNUSED_PARAMETER") vendorModelId: String,
    promise: Promise,
  ) {
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
