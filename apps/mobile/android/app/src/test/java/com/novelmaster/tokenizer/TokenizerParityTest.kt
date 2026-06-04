package com.novelmaster.tokenizer

import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer
import ai.djl.sentencepiece.SpTokenizer
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.nio.file.Paths
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max

/**
 * M1-I1: native JVM counts vs CLI goldens (countPromptLlmInputNode) within tolerance.
 */
class TokenizerParityTest {
  @Test
  fun nativeCountsWithinCliToleranceForClaudeAndGemma() {
    val stream =
      javaClass.classLoader?.getResourceAsStream("tokenizer-parity-goldens.json")
        ?: error("tokenizer-parity-goldens.json missing from test resources")
    val root = JSONObject(stream.reader().readText())
    val cases = root.getJSONArray("cases")

    for (i in 0 until cases.length()) {
      val c = cases.getJSONObject(i)
      val family = c.getString("family")
      val serialized = c.getString("serialized")
      val cli = c.getInt("cliTokenCount")
      assumeTrue("CLI golden must be exact for $family", c.getBoolean("cliEstimated") == false)

      val native = countNative(serialized, family)
      assertFalse("${c.getString("id")}: native must not be estimated", native.estimated)
      assertTrue("${c.getString("id")}: native count > 0", native.tokenCount > 0)

      val tol = parityTolerance(cli)
      val delta = abs(native.tokenCount - cli)
      assertTrue(
        "${c.getString("id")}: |native(${native.tokenCount}) - cli($cli)| = $delta > tol($tol)",
        delta <= tol,
      )
    }
  }

  private data class NativeCount(val tokenCount: Int, val estimated: Boolean)

  private fun countNative(serialized: String, family: String): NativeCount {
    val spec =
      TokenizerAssetPaths.forFamily(family)
        ?: return NativeCount(TokenizerEngine.heuristic(serialized, family).tokenCount, true)
    return when (spec.kind) {
      "json" -> countWebNative(serialized, family, spec)
      "model" -> countSpNative(serialized, family, spec)
      else -> NativeCount(TokenizerEngine.heuristic(serialized, family).tokenCount, true)
    }
  }

  private fun countWebNative(
    serialized: String,
    family: String,
    spec: AssetPathSpec,
  ): NativeCount {
    val asset = resolveAssetFile("tokenizers/${spec.primary}") ?: return heuristicNative(serialized, family)
    val tokenizer =
      try {
        HuggingFaceTokenizer.newInstance(Paths.get(asset.absolutePath))
      } catch (_: Throwable) {
        return heuristicNative(serialized, family)
      }
    val count =
      WebPromptConverter.countWebSerialized(serialized) { text ->
        tokenizer.encode(text).ids.size
      }
    return NativeCount(count, estimated = false)
  }

  private fun countSpNative(
    serialized: String,
    family: String,
    spec: AssetPathSpec,
  ): NativeCount {
    val asset = resolveAssetFile("tokenizers/${spec.primary}") ?: return heuristicNative(serialized, family)
    return try {
      SpTokenizer(Paths.get(asset.absolutePath)).use { tokenizer ->
        val ids = tokenizer.processor.encode(serialized)
        NativeCount(ids.size, estimated = false)
      }
    } catch (_: Throwable) {
      heuristicNative(serialized, family)
    }
  }

  private fun heuristicNative(serialized: String, family: String): NativeCount {
    val h = TokenizerEngine.heuristic(serialized, family)
    return NativeCount(h.tokenCount, h.estimated)
  }

  private fun resolveAssetFile(relative: String): File? {
    val candidates =
      listOf(
        File("src/main/assets/$relative"),
        File("app/src/main/assets/$relative"),
      )
    return candidates.firstOrNull { it.exists() }
  }

  companion object {
    /** M1 tolerance: max(3, ceil(cli * 0.01)). */
    fun parityTolerance(cliTokenCount: Int): Int =
      max(3, ceil(cliTokenCount * 0.01).toInt())
  }
}
