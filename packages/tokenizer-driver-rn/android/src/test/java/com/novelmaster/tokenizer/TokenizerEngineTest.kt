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
    // 负例家族用 gpt2（token-count-perf-r2）：真实家族、原生刻意不配资产
    // （r50k/gpt2 出界域由 JS 侧拦下不走原生）——此前用 gpt-4o 当负例，
    // gpt 家族上原生词表后该断言必红。
    try {
      TokenizerEngine.resolveAssetSpecFor("gpt2")
      fail("无资产家族必须抛 IllegalStateException，不允许返回折算值")
    } catch (expected: IllegalStateException) {
      assertTrue(
        "异常消息应包含家族名，实际: ${expected.message}",
        expected.message?.contains("gpt2") == true,
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

  // ------------------------------------------------------------------
  // gpt 家族（token-count-perf-r2）
  // ------------------------------------------------------------------

  @Test
  fun resolveTiktokenAssetSpecMapsBothEncodingsAndThrowsOutOfDomain() {
    val cl = TokenizerEngine.resolveTiktokenAssetSpec("cl100k_base")
    assertEquals("cl100k.json", cl.primary)
    assertEquals("json", cl.kind)

    val o2 = TokenizerEngine.resolveTiktokenAssetSpec("o200k_base")
    assertEquals("o200k.json", o2.primary)
    assertEquals("json", o2.kind)

    // 两表域外（p50k 等）与空缺编码名都必须抛：JS 侧出界模型本就不发起原生
    // 调用，这里是防御线。
    try {
      TokenizerEngine.resolveTiktokenAssetSpec("p50k_base")
      fail("两表域外编码名必须抛")
    } catch (expected: IllegalStateException) {
      assertTrue(expected.message?.contains("p50k_base") == true)
    }
    try {
      TokenizerEngine.resolveTiktokenAssetSpec(null)
      fail("缺编码名必须抛")
    } catch (expected: IllegalStateException) {
      // 防御线：消息说明缺编码名即可
    }
  }

  @Test
  fun gptEncodingsLoadAndCountFixedStringAboveZero() {
    // gpt 冒烟（T-G1 伴生）：两张表都能被 DJL 加载并对固定串直编码出正数。
    // 注意 addSpecialTokens=false——与 tiktoken 裸 encode 口径对齐（HF 转换件
    // 虽无 post_processor，仍显式关闭防未来资产形态变化）。
    for (assetName in listOf("cl100k.json", "o200k.json")) {
      val asset = resolveAsset("tokenizers/$assetName")
      assumeTrue("$assetName asset missing", asset != null)
      val tokenizer =
        HuggingFaceTokenizer.newInstance(
          Paths.get(asset!!.absolutePath),
          mapOf("truncation" to "false", "addSpecialTokens" to "false"),
        )
      val count = tokenizer.encode(fixedSerialized, false, false).ids.size
      assertTrue("$assetName 直编码应得正数，实际 $count", count > 0)
    }
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
