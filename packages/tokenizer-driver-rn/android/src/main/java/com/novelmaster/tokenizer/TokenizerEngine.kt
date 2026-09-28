package com.novelmaster.tokenizer

import ai.djl.huggingface.tokenizers.Encoding
import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer
import ai.djl.sentencepiece.SpTokenizer
import android.content.Context
import android.util.LruCache
import java.io.File
import java.nio.file.Files
import java.nio.file.Paths
import java.nio.file.StandardCopyOption

/**
 * Native WEB (HF JSON) and SP (.model) counting — parity with core tokenizers.
 * SP uses DJL {@link SpTokenizer} (official SentencePiece JNI, matches @agnai encodeIds).
 * Missing assets / load failure / encode failure always throw (no heuristic fallback);
 * the bridge module converts them into a JS promise rejection.
 */
internal class TokenizerEngine(private val context: Context) {
  data class CountResult(
    val tokenCount: Int,
    val counterKind: String,
    val estimated: Boolean,
  )

  private val webCache = LruCache<String, HuggingFaceTokenizer>(8)
  private val spCache = LruCache<String, SpTokenizer>(8)

  fun count(serialized: String, family: String): CountResult {
    val spec = resolveAssetSpecFor(family)
    return when (spec.kind) {
      "json" -> countWebFamily(serialized, family, spec)
      "model" -> countSpFamily(serialized, family, spec)
      // resolveAssetSpecFor 已校验 kind，此分支仅为防御性兜底。
      else -> throw IllegalStateException("家族 $family 的资产类型未知: ${spec.kind}")
    }
  }

  private fun countWebFamily(
    serialized: String,
    family: String,
    spec: AssetPathSpec,
  ): CountResult {
    val tokenizer =
      loadWebTokenizer(family, spec)
        ?: throw IllegalStateException("家族 $family 的 WEB 分词器资产缺失或加载失败")
    return try {
      val count =
        WebPromptConverter.countWebSerialized(serialized) { text ->
          encodeWeb(tokenizer, text)
        }
      CountResult(count, family, estimated = false)
    } catch (e: Throwable) {
      throw IllegalStateException("家族 $family 的 WEB 编码失败: ${e.message}", e)
    }
  }

  private fun encodeWeb(tokenizer: HuggingFaceTokenizer, text: String): Int {
    val encoding: Encoding = tokenizer.encode(text)
    return encoding.ids.size
  }

  private fun loadWebTokenizer(family: String, spec: AssetPathSpec): HuggingFaceTokenizer? {
    webCache.get(family)?.let { return it }
    val primaryPath = copyAssetToCache("tokenizers/${spec.primary}") ?: return null
    val loaded =
      tryLoadWebTokenizer(primaryPath)
        ?: spec.fallback?.let { fallback ->
          copyAssetToCache("tokenizers/$fallback")?.let { tryLoadWebTokenizer(it) }
        }
    if (loaded != null) {
      webCache.put(family, loaded)
    }
    return loaded
  }

  private fun tryLoadWebTokenizer(path: String): HuggingFaceTokenizer? {
    return try {
      // DJL 默认 truncation=true + maxLength=512，长文本会被截断。
      // 显式关闭 truncation，让 encode 返回完整 token 数。
      HuggingFaceTokenizer.newInstance(
        Paths.get(path),
        mapOf("truncation" to "false"),
      )
    } catch (_: Throwable) {
      null
    }
  }

  private fun countSpFamily(
    serialized: String,
    family: String,
    spec: AssetPathSpec,
  ): CountResult {
    val tokenizer =
      loadSpTokenizer(family, spec)
        ?: throw IllegalStateException("家族 $family 的 SP 分词器资产缺失或加载失败")
    return try {
      val ids = tokenizer.processor.encode(serialized)
      CountResult(ids.size, family, estimated = false)
    } catch (e: Throwable) {
      throw IllegalStateException("家族 $family 的 SP 编码失败: ${e.message}", e)
    }
  }

  private fun loadSpTokenizer(family: String, spec: AssetPathSpec): SpTokenizer? {
    spCache.get(family)?.let { return it }
    val path = copyAssetToCache("tokenizers/${spec.primary}") ?: return null
    return try {
      SpTokenizer(Paths.get(path)).also { spCache.put(family, it) }
    } catch (_: Throwable) {
      null
    }
  }

  private fun copyAssetToCache(assetPath: String): String? {
    val fileName = assetPath.replace('/', '_')
    val dest = File(context.cacheDir, "nm_tok_$fileName")
    if (dest.exists() && dest.length() > 0L) {
      return dest.absolutePath
    }
    return try {
      context.assets.open(assetPath).use { input ->
        dest.parentFile?.mkdirs()
        Files.copy(input, dest.toPath(), StandardCopyOption.REPLACE_EXISTING)
      }
      dest.absolutePath
    } catch (_: Throwable) {
      null
    }
  }

  companion object {
    /**
     * 静态纯函数：解析家族对应的资产 spec（不持有 android Context，可 JVM 直测）。
     * 家族无资产 spec 或 kind 未知时抛 [IllegalStateException]——失败不再折算为启发式计数。
     */
    fun resolveAssetSpecFor(family: String): AssetPathSpec {
      val spec =
        TokenizerAssetPaths.forFamily(family)
          ?: throw IllegalStateException("家族 $family 无原生分词器资产配置")
      if (spec.kind != "json" && spec.kind != "model") {
        throw IllegalStateException("家族 $family 的资产类型未知: ${spec.kind}")
      }
      return spec
    }
  }
}
