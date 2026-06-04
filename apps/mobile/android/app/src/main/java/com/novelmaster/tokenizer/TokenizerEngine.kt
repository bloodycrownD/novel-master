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
import kotlin.math.ceil

/**
 * Native WEB (HF JSON) and SP (.model) counting — parity with core tokenizers.
 * SP uses DJL {@link SpTokenizer} (official SentencePiece JNI, matches @agnai encodeIds).
 * On load/encode failure returns heuristic + estimated (never throws to JS).
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
    val spec = TokenizerAssetPaths.forFamily(family) ?: return heuristic(serialized, family)
    return when (spec.kind) {
      "json" -> countWebFamily(serialized, family, spec)
      "model" -> countSpFamily(serialized, family, spec)
      else -> heuristic(serialized, family)
    }
  }

  private fun countWebFamily(
    serialized: String,
    family: String,
    spec: AssetPathSpec,
  ): CountResult {
    val tokenizer = loadWebTokenizer(family, spec) ?: return heuristic(serialized, family)
    return try {
      val count =
        WebPromptConverter.countWebSerialized(serialized) { text ->
          encodeWeb(tokenizer, text)
        }
      CountResult(count, family, estimated = false)
    } catch (_: Throwable) {
      heuristic(serialized, family)
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
      HuggingFaceTokenizer.newInstance(Paths.get(path))
    } catch (_: Throwable) {
      null
    }
  }

  private fun countSpFamily(
    serialized: String,
    family: String,
    spec: AssetPathSpec,
  ): CountResult {
    val tokenizer = loadSpTokenizer(family, spec) ?: return heuristic(serialized, family)
    return try {
      val ids = tokenizer.processor.encode(serialized)
      CountResult(ids.size, family, estimated = false)
    } catch (_: Throwable) {
      heuristic(serialized, family)
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
    /** Matches core `CHARACTERS_PER_TOKEN_RATIO` (SillyTavern fallback). */
    private const val CHARACTERS_PER_TOKEN_RATIO = 3.35

    fun heuristic(serialized: String, counterKind: String): CountResult {
      val count = ceil(serialized.length / CHARACTERS_PER_TOKEN_RATIO).toInt()
      return CountResult(count, counterKind, estimated = true)
    }
  }
}
