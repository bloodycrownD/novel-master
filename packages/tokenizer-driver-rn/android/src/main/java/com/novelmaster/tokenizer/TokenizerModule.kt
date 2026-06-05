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
 * encode plain serialized text. Failures resolve with heuristic + estimated — no reject.
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
    } catch (_: Throwable) {
      val fallback = TokenizerEngine.heuristic(serialized, family)
      val map = WritableNativeMap()
      map.putInt("tokenCount", fallback.tokenCount)
      map.putString("counterKind", fallback.counterKind)
      map.putBoolean("estimated", true)
      promise.resolve(map)
    }
  }
}
