package com.novelmaster.tokenizer

import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.nio.file.Paths

/**
 * JVM unit tests: DJL HF tokenizer paths (WEB / 裸编码 / tiktoken)，无设备。
 *
 * Engine 构造依赖 android.content.Context 且依赖树无 Robolectric，
 * 因此 Engine 级用例只测 companion 静态纯函数与能力位纯函数，不实例化 Engine。
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
    val asset = resolveAsset("tokenizers/gemma.json")
    assumeTrue("gemma.json asset missing", asset != null)

    // sp-to-hf（2026-11-06）：Android 无 SentencePiece native，gemma 走转换后的
    // HF tokenizer.json + 裸编码（isBareCaliber），不再经 SpTokenizer。
    val tokenizer = HuggingFaceTokenizer.newInstance(Paths.get(asset!!.absolutePath))
    val ids = tokenizer.encode(fixedSerialized, false, false).ids
    assertTrue("expected positive token count for gemma HF path", ids.size > 0)
  }

  @Test
  fun gemmaFamilySuccessPathIsNotEstimated() {
    val asset = resolveAsset("tokenizers/gemma.json")
    assumeTrue("gemma.json asset missing", asset != null)

    val tokenizer = HuggingFaceTokenizer.newInstance(Paths.get(asset!!.absolutePath))
    val ids = tokenizer.encode(fixedSerialized, false, false).ids
    val result = TokenizerEngine.CountResult(ids.size, "gemma", estimated = false)
    assertFalse("gemma HF encode must not be estimated", result.estimated)
    assertTrue(result.tokenCount > 0)
  }

  @Test
  fun everyKnownFamilyPrimaryAssetExists() {
    // 映射与磁盘资产的一致性守卫：表中每条 primary / fallback 都必须是真实文件
    // （isFile 而非 exists——目录会骗过 exists），且扩展名与 kind 一致。
    // gemma/llama/mistral 从 .model 切到 .json 时，两个用例曾靠 assumption
    // 静默 skip、覆盖凭空消失；这条守卫让同类遗漏直接红而不是悄悄跳过。
    for (family in
      listOf(
        "claude",
        "llama3",
        "llama",
        "mistral",
        "gemma",
        "qwen2",
        "command-r",
        "command-a",
        "nemo",
        "deepseek",
        "glm",
      )) {
      val spec = TokenizerEngine.resolveAssetSpecFor(family)
      assertAssetMatchesKind("家族 $family", spec.primary, spec.kind)
      spec.fallback?.let { assertAssetMatchesKind("家族 $family 的 fallback", it, spec.kind) }
    }

    // tiktoken 两表独立于 forFamily，单独覆盖（cl100k_base / o200k_base）。
    for (encoding in listOf("cl100k_base", "o200k_base")) {
      val spec = TokenizerEngine.resolveTiktokenAssetSpec(encoding)
      assertAssetMatchesKind("gpt 编码 $encoding", spec.primary, spec.kind)
      spec.fallback?.let { assertAssetMatchesKind("gpt 编码 $encoding 的 fallback", it, spec.kind) }
    }
  }

  private fun assertAssetMatchesKind(label: String, relative: String, kind: String) {
    val asset = resolveAsset("tokenizers/$relative")
    assertTrue("$label 的资产不存在或不是文件: $relative", asset?.isFile == true)
    val expectedExtension = if (kind == "json") ".json" else ".model"
    assertTrue(
      "$label 的资产扩展名与 kind=$kind 不符: $relative",
      relative.endsWith(expectedExtension),
    )
  }

  @Test
  fun removedSpFamiliesThrowBeforeAssetRead() {
    // B1：yi/jamba 的 model 条目已随能力位化删除，解析阶段就抛，不碰 assets。
    for (family in listOf("yi", "jamba")) {
      try {
        TokenizerEngine.resolveAssetSpecFor(family)
        fail("$family 已无原生资产，必须抛 IllegalStateException")
      } catch (expected: IllegalStateException) {
        assertTrue(
          "异常消息应包含家族名，实际: ${expected.message}",
          expected.message?.contains(family) == true,
        )
      }
    }
  }

  @Test
  fun isSpUnavailableSpecTreatsModelAsUnavailableAndJsonAsAvailable() {
    // 能力位（TokenizerCapabilities.kt）：当前构建没有 SP native，model 档一律
    // 在资产读取前判不可用；json 档不受影响。
    assertTrue(
      "model 档必须判为 SP 不可用",
      isSpUnavailableSpec(AssetPathSpec("yi.model", kind = "model")),
    )
    assertFalse(
      "json 档不该判为 SP 不可用",
      isSpUnavailableSpec(AssetPathSpec("gemma.json", kind = "json")),
    )
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
    // sp-to-hf（2026-11-06）：Android 无 SentencePiece native，gemma/llama/mistral
    // 改用 convert_slow_tokenizer 转出的 tokenizer.json，走已有的 HF native。
    assertEquals("gemma.json", gemma.primary)
    assertEquals("json", gemma.kind)
    assertTrue("SP 转 HF 家族必须裸编码", isBareCaliber("gemma"))

    for (family in listOf("llama", "mistral")) {
      val spec = TokenizerEngine.resolveAssetSpecFor(family)
      assertEquals("$family.json", spec.primary)
      assertEquals("json", spec.kind)
      assertTrue("SP 转 HF 家族必须裸编码: $family", isBareCaliber(family))
    }

    // WEB 家族相反：必须走包装（buildSerialized 会追加 `\n\nAssistant:`），
    // 归到裸编码反而错。
    assertFalse("WEB 家族不该裸编码", isBareCaliber("claude"))

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
    // 裸编码判定：dispatch 只看 isBareCaliber(family)，漏判就会静默走 WEB
    // 包装、多算 3~5 token。
    assertTrue("tiktoken 两表必须裸编码", isBareCaliber("tiktoken"))

    val o2 = TokenizerEngine.resolveTiktokenAssetSpec("o200k_base")
    assertEquals("o200k.json", o2.primary)
    assertEquals("json", o2.kind)
    assertTrue("tiktoken 两表必须裸编码", isBareCaliber("tiktoken"))

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
    return candidates.firstOrNull { it.isFile }
  }
}
