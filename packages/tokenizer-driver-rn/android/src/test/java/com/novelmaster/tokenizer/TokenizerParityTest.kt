package com.novelmaster.tokenizer

import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer
import ai.djl.sentencepiece.SpTokenizer
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.nio.file.Paths
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max

/**
 * M1-I1: native JVM counts vs CLI goldens (countPromptLlmInputNode) within tolerance.
 *
 * token-count-perf-r2 两处口径修正：
 * - WEB/SP 的 `HuggingFaceTokenizer.newInstance` 显式关 truncation——DJL 默认
 *   truncation=true + maxLength=512，超过 512 token 的金标串会被静默截断给出
 *   偏小假读数（生产路径 `TokenizerEngine.tryLoadWebTokenizer` 一直带
 *   `truncation=false`，测试路径此前没对齐）。
 * - gpt 家族（family=tiktoken）走直编码分支，对拍字段 `rawTextTokenCount`
 *   （js-tiktoken 对序列化串的裸 encode，与 Kotlin 直编码同口径）；`cliTokenCount`
 *   是「overhead+分块和」口径，仅打印参考不参与 gpt 断言。
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

      if (family == "tiktoken") {
        // gpt 对拍门（T-G2/T-G8）：DJL 直编码 vs js-tiktoken 裸 encode，
        // 容差 max(3, ceil(0.5%))——同算法同表理论上应逐 token 等值，留半百分比
        // 给 HF 转换件在特殊 token 边界上的极小形态差。
        val raw = c.getInt("rawTextTokenCount")
        val encodingName = c.getString("encodingName")
        val native = countGptNative(serialized, encodingName)
        assertFalse("${c.getString("id")}: gpt native must not be estimated", native.estimated)
        val tol = gptParityTolerance(raw)
        val delta = abs(native.tokenCount - raw)
        assertTrue(
          "${c.getString("id")}: |native(${native.tokenCount}) - raw($raw)| = $delta > tol($tol)" +
            "（cli 参考值 $cli 为 overhead+分块口径，不参与本断言）",
          delta <= tol,
        )
        continue
      }

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

  @Test
  fun unknownFamilyPropagatesExceptionInsteadOfHeuristicFallback() {
    // 新契约：无资产家族不再折算 heuristic，异常必须从计数路径直接传播（T-FA5）。
    // 负例家族 gpt2（token-count-perf-r2）：真实家族、原生刻意不配资产——此前用
    // gpt-4o 当负例，gpt 家族上原生词表后该断言必红。
    try {
      countNative("You are helpful.\n\nuser: Hello", "gpt2")
      fail("无资产家族应抛 IllegalStateException 而非返回折算值")
    } catch (_: IllegalStateException) {
      // 预期：异常传播
    }
  }

  @Test
  fun tiktokenOutOfDomainEncodingThrowsInsteadOfHeuristicFallback() {
    // gpt 家族的防御线（T-G1 伴生）：两表域外编码名必须抛，不允许折算。
    try {
      TokenizerEngine.resolveTiktokenAssetSpec("p50k_base")
      fail("两表域外编码名应抛 IllegalStateException")
    } catch (_: IllegalStateException) {
      // 预期：异常传播
    }
  }

  private data class NativeCount(val tokenCount: Int, val estimated: Boolean)

  private fun countNative(serialized: String, family: String): NativeCount {
    // 失败（无资产 spec / kind 未知）由 resolveAssetSpecFor 直接抛异常传播。
    val spec = TokenizerEngine.resolveAssetSpecFor(family)
    return when (spec.kind) {
      "json" -> countWebNative(serialized, family, spec)
      "model" -> countSpNative(serialized, family, spec)
      else -> throw IllegalStateException("家族 $family 的资产类型未知: ${spec.kind}")
    }
  }

  private fun countGptNative(serialized: String, encodingName: String): NativeCount {
    val spec = TokenizerEngine.resolveTiktokenAssetSpec(encodingName)
    val asset =
      resolveAssetFile("tokenizers/${spec.primary}")
        ?: throw IllegalStateException("gpt 编码 $encodingName 的词表资产缺失")
    val tokenizer =
      try {
        HuggingFaceTokenizer.newInstance(
          Paths.get(asset.absolutePath),
          mapOf("truncation" to "false", "addSpecialTokens" to "false"),
        )
      } catch (e: Throwable) {
        throw IllegalStateException("gpt 编码 $encodingName 词表加载失败: ${e.message}", e)
      }
    // 与生产 countGptFamily 同口径：直编码整串、不包装、不加特殊 token。
    return NativeCount(tokenizer.encode(serialized, false, false).ids.size, estimated = false)
  }

  private fun countWebNative(
    serialized: String,
    family: String,
    spec: AssetPathSpec,
  ): NativeCount {
    val asset =
      resolveAssetFile("tokenizers/${spec.primary}")
        ?: throw IllegalStateException("家族 $family 的 WEB 分词器资产缺失")
    val tokenizer =
      try {
        HuggingFaceTokenizer.newInstance(
          Paths.get(asset.absolutePath),
          mapOf("truncation" to "false"),
        )
      } catch (e: Throwable) {
        throw IllegalStateException("家族 $family 的 WEB 分词器加载失败: ${e.message}", e)
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
    val asset =
      resolveAssetFile("tokenizers/${spec.primary}")
        ?: throw IllegalStateException("家族 $family 的 SP 分词器资产缺失")
    return try {
      SpTokenizer(Paths.get(asset.absolutePath)).use { tokenizer ->
        val ids = tokenizer.processor.encode(serialized)
        NativeCount(ids.size, estimated = false)
      }
    } catch (e: Throwable) {
      throw IllegalStateException("家族 $family 的 SP 分词器加载或编码失败: ${e.message}", e)
    }
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

    /** gpt 对拍容差（T-G2）：同算法同表，留 0.5% 给 HF 转换件边界形态差。 */
    fun gptParityTolerance(rawTokenCount: Int): Int =
      max(3, ceil(rawTokenCount * 0.005).toInt())
  }
}
