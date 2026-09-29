package com.novelmaster.tokenizer

import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer
import ai.djl.sentencepiece.SpTokenizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.nio.file.Paths

/**
 * JVM unit tests: DJL WEB + SentencePiece SP paths (no device).
 *
 * Engine 构造依赖 android.content.Context 且依赖树无 Robolectric，
 * 因此 Engine 级用例只测 companion 静态纯函数，不实例化 Engine。
 */
class TokenizerEngineTest {
  private val fixedSerialized = "You are helpful.\n\nuser: Hello"

  @Test
  fun claudeFamilyCountsFixedStringAboveZero() {
    val asset = resolveAsset("tokenizers/claude.json")
    assumeTrue("claude.json asset missing", asset != null)

    val tokenizer = HuggingFaceTokenizer.newInstance(Paths.get(asset!!.absolutePath))
    val count =
      WebPromptConverter.countWebSerialized(fixedSerialized) { text ->
        tokenizer.encode(text).ids.size
      }
    assertTrue("expected positive token count for claude web path", count > 0)
  }

  @Test
  fun claudeFamilySuccessPathIsNotEstimated() {
    val asset = resolveAsset("tokenizers/claude.json")
    assumeTrue("claude.json asset missing", asset != null)

    val tokenizer = HuggingFaceTokenizer.newInstance(Paths.get(asset!!.absolutePath))
    val count =
      WebPromptConverter.countWebSerialized(fixedSerialized) { text ->
        tokenizer.encode(text).ids.size
      }
    val result = TokenizerEngine.CountResult(count, "claude", estimated = false)
    assertFalse("claude web encode must not be estimated", result.estimated)
    assertTrue(result.tokenCount > 0)
  }

  @Test
  fun gemmaFamilyCountsFixedStringAboveZero() {
    val asset = resolveAsset("tokenizers/gemma.model")
    assumeTrue("gemma.model asset missing", asset != null)

    SpTokenizer(Paths.get(asset!!.absolutePath)).use { tokenizer ->
      val ids = tokenizer.processor.encode(fixedSerialized)
      assertTrue("expected positive token count for gemma SP path", ids.size > 0)
    }
  }

  @Test
  fun gemmaFamilySuccessPathIsNotEstimated() {
    val asset = resolveAsset("tokenizers/gemma.model")
    assumeTrue("gemma.model asset missing", asset != null)

    SpTokenizer(Paths.get(asset!!.absolutePath)).use { tokenizer ->
      val ids = tokenizer.processor.encode(fixedSerialized)
      val result = TokenizerEngine.CountResult(ids.size, "gemma", estimated = false)
      assertFalse("gemma SP encode must not be estimated", result.estimated)
      assertTrue(result.tokenCount > 0)
    }
  }

  @Test
  fun resolveAssetSpecForFamilyWithoutAssetsThrowsInsteadOfHeuristic() {
    // 新契约：无资产家族不再折算 heuristic，直接抛异常（T-FA5）。
    try {
      TokenizerEngine.resolveAssetSpecFor("gpt-4o")
      fail("无资产家族必须抛 IllegalStateException，不允许返回折算值")
    } catch (expected: IllegalStateException) {
      assertTrue(
        "异常消息应包含家族名，实际: ${expected.message}",
        expected.message?.contains("gpt-4o") == true,
      )
    }
  }

  @Test
  fun resolveAssetSpecForKnownFamiliesReturnsExpectedSpec() {
    val claude = TokenizerEngine.resolveAssetSpecFor("claude")
    assertEquals("claude.json", claude.primary)
    assertEquals("json", claude.kind)

    val gemma = TokenizerEngine.resolveAssetSpecFor("gemma")
    assertEquals("gemma.model", gemma.primary)
    assertEquals("model", gemma.kind)

    val qwen2 = TokenizerEngine.resolveAssetSpecFor("qwen2")
    assertEquals("web/qwen2.json", qwen2.primary)
    assertEquals("llama3.json", qwen2.fallback)
  }

  private fun resolveAsset(relative: String): File? {
    val candidates =
      listOf(
        File("src/main/assets/$relative"),
        File("app/src/main/assets/$relative"),
      )
    return candidates.firstOrNull { it.exists() }
  }
}
