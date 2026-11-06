package com.novelmaster.tokenizer

import ai.djl.huggingface.tokenizers.Encoding
import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer
import android.content.Context
import android.util.Log
import android.util.LruCache
import java.io.File
import java.nio.file.Files
import java.nio.file.Paths
import java.nio.file.StandardCopyOption

/**
 * Native counting via DJL HuggingFaceTokenizer (JSON assets) — parity with core
 * tokenizers. SP (`.model`) 路径在本构建不可用，能力位见 `TokenizerCapabilities.kt`。
 * Missing assets / load failure / encode failure always throw (no heuristic fallback);
 * the bridge module converts them into a JS promise rejection.
 *
 * **分段计时（tokenizer-native-cancel，2026-10-02）**：真机实报 chip 精确升级轮
 * 整轮 14.2s，本迭代要给「词表加载 vs encode」的构成打点，为后续「是否分段
 * encode」的口径决策提供数据。打点走 `Log.i("nm-tok", ...)` 单条收尾输出，
 * **不经 RN 桥回 JS**——JS 侧 console.log 在 dev 下每条放大 100-400ms，会反过来
 * 把要测的东西测花。探针性质：不参与返回值、不参与判定。
 */
internal class TokenizerEngine(private val context: Context) {
  data class CountResult(
    val tokenCount: Int,
    val counterKind: String,
    val estimated: Boolean,
  )

  /**
   * 单轮计时的分段读数。词表加载耗时要等 WEB 分支加载完才知道，故用一个可变
   * 载体把子层读数带回 [count] 统一收尾输出，避免散落多条日志。
   */
  private class CountTimings(
    val family: String,
    val chars: Int,
  ) {
    var vocabLoadMs: Long = -1
    var encodeMs: Long = -1
    var totalMs: Long = -1
    /** 词表加载拆细（2026-10-02 成本拆解实验）：assets→cacheDir 拷贝段。无加载（LRU 命中）为 -1。 */
    var copyMs: Long = -1
    /** 词表加载拆细：DJL newInstance（含 .so 首载/解析/建表）段。无加载为 -1。 */
    var jniMs: Long = -1
  }

  // 缓存容量 6（token-count-perf-r2 由 4→6）：常驻条目现为 13 个——WEB 家族 8 个
  // + tiktoken 两表（cl100k/o200k）+ SP 转 HF 的 gemma/llama/mistral（2026-11-06
  // 起后者也走 webCache）。6 槽只兜最常用的 6 个家族，跨家族频繁切换仍会 LRU 互踢、
  // 每踢一次重付秒级词表加载（gemma.json 13.7MB / 58 万 merges，解析比 WEB 家族更重）。
  // 是否上调容量待真机内存与互踢重载耗时数据拍板。LRU 淘汰后下次使用再懒加载一次即可。
  private val webCache = LruCache<String, HuggingFaceTokenizer>(6)

  /**
   * @param shouldCancel 取消检查回调，命中即抛 [TokenizerCountCancelledException]。
   *   缺省 `{ false }` 是为了保持既有调用方（[TokenizerModule.countPrompt] 等）
   *   逐字兼容——可取消的轮才显式传入。
   * @param encodingName gpt 家族（family == "tiktoken"）的编码名
   *   （`cl100k_base` / `o200k_base`），经 Module 的 vendorModelId 槽下发
   *   （token-count-perf-r2）；其余家族忽略。gpt 家族缺编码名即抛。
   */
  fun count(
    serialized: String,
    family: String,
    encodingName: String? = null,
    shouldCancel: () -> Boolean = { false },
  ): CountResult {
    val timings = CountTimings(family, serialized.length)
    val startNs = System.nanoTime()
    val spec =
      if (family == "tiktoken") {
        resolveTiktokenAssetSpec(encodingName)
      } else {
        resolveAssetSpecFor(family)
      }
    return try {
      when {
        // 能力位先于资产读取：当前构建没有 SP native，命中 model 档直接抛，
        // 省掉 `.model` 拷贝与一次必然失败的 JNI 构造（JS 侧照旧回退）。
        isSpUnavailableSpec(spec) ->
          throw IllegalStateException("SP native unavailable: ${spec.primary}")
        // 裸编码档：直编码整串、不做 WEB 的 system 包装。口径由 [isBareCaliber]
        // 单点定义——新增裸编码家族只改那一处，不必再动 dispatch（曾经
        // `family == "tiktoken" || spec.bare` 两套表达并存，新家族漏改就会
        // 静默走成包装、多算 3~5 token）。
        isBareCaliber(family) -> countBareJsonFamily(serialized, family, spec, shouldCancel, timings)
        spec.kind == "json" -> countWebFamily(serialized, family, spec, shouldCancel, timings)
        // resolveAssetSpecFor 已校验 kind，此分支仅为防御性兜底。
        else -> throw IllegalStateException("家族 $family 的资产类型未知: ${spec.kind}")
      }
    } finally {
      // 收尾打点放在 finally：被取消的轮次同样要留下时间线（取消命中频次是
      // Step 9 的观测量之一），且 totalMs 必须覆盖到抛出的那一刻。
      timings.totalMs = elapsedMs(startNs)
      logTimings(timings)
    }
  }

  /**
   * 裸编码档（口径见 [isBareCaliber]）：**直编码整串、不包装**。
   *
   * - gpt 家族：与 js-tiktoken 的 `encoding.encode(text)` 对齐（token-count-perf-r2），
   *   per-message overhead（~7 token 常数）由 JS 侧用 core 公式补加，公式单源在 TS。
   * - SP 转 HF 家族（gemma/llama/mistral）：Node 侧的 `SentencePieceTokenCounter`
   *   就是裸编码，Android 若走 `countWebFamily` 的 system 包装（+`\n\nAssistant:`）
   *   会稳定多 3~5 token，与桌面/CLI 的读法对不上。
   *
   * 词表走 webCache（键 = 资产路径，cl100k/o200k 等各占一槽不互踢）。
   */
  private fun countBareJsonFamily(
    serialized: String,
    family: String,
    spec: AssetPathSpec,
    shouldCancel: () -> Boolean,
    timings: CountTimings,
  ): CountResult {
    val loadStartNs = System.nanoTime()
    val tokenizer =
      loadWebTokenizer(spec, timings)
        ?: throw IllegalStateException("家族 $family 的裸编码词表缺失或加载失败: ${spec.primary}")
    timings.vocabLoadMs = elapsedMs(loadStartNs)
    // 检查点：词表已就绪、encode 还没开始（与 WEB 家族同构）。
    if (shouldCancel()) throw TokenizerCountCancelledException("家族 $family 的计数在 encode 前被取消")
    val encodeStartNs = System.nanoTime()
    return try {
      val count = tokenizer.encode(serialized, false, false).ids.size
      CountResult(count, family, estimated = false)
    } catch (e: TokenizerCountCancelledException) {
      throw e
    } catch (e: Throwable) {
      throw IllegalStateException("家族 $family 的裸编码失败: ${e.message}", e)
    } finally {
      timings.encodeMs = elapsedMs(encodeStartNs)
    }
  }

  private fun countWebFamily(
    serialized: String,
    family: String,
    spec: AssetPathSpec,
    shouldCancel: () -> Boolean = { false },
    timings: CountTimings? = null,
  ): CountResult {
    val loadStartNs = System.nanoTime()
    val tokenizer =
      loadWebTokenizer(spec, timings)
        ?: throw IllegalStateException("家族 $family 的 WEB 分词器资产缺失或加载失败")
    timings?.vocabLoadMs = elapsedMs(loadStartNs)
    // 检查点：词表已就绪、encode 还没开始——这是取消收益最大的一处
    // （能省掉 DJL 那次不可中断的整串 encode）。
    if (shouldCancel()) throw TokenizerCountCancelledException("家族 $family 的计数在 encode 前被取消")
    val encodeStartNs = System.nanoTime()
    return try {
      val count =
        WebPromptConverter.countWebSerialized(serialized) { text ->
          encodeWeb(tokenizer, text)
        }
      CountResult(count, family, estimated = false)
    } catch (e: TokenizerCountCancelledException) {
      // 取消异常原样上抛：一旦被包成 IllegalStateException，Module 就认不出取消，
      // JS 侧会掉进兜底全量重算（取消反而更贵）。
      throw e
    } catch (e: Throwable) {
      throw IllegalStateException("家族 $family 的 WEB 编码失败: ${e.message}", e)
    } finally {
      timings?.encodeMs = elapsedMs(encodeStartNs)
    }
  }

  private fun encodeWeb(tokenizer: HuggingFaceTokenizer, text: String): Int {
    val encoding: Encoding = tokenizer.encode(text)
    return encoding.ids.size
  }

  private fun loadWebTokenizer(
    spec: AssetPathSpec,
    timings: CountTimings? = null,
  ): HuggingFaceTokenizer? {
    // 缓存键 = 资产路径（token-count-perf-r2 起）：此前用 family，gpt 家族的
    // cl100k/o200k 两张表会共用 "tiktoken" 一槽互相踢（每踢一次重付秒级加载）。
    webCache.get(spec.primary)?.let { return it }
    val copyStartNs = System.nanoTime()
    val primaryPath = copyAssetToCache("tokenizers/${spec.primary}") ?: return null
    timings?.copyMs = elapsedMs(copyStartNs)
    val jniStartNs = System.nanoTime()
    val loaded =
      tryLoadWebTokenizer(primaryPath)
        ?: spec.fallback?.let { fallback ->
          copyAssetToCache("tokenizers/$fallback")?.let { tryLoadWebTokenizer(it) }
        }
    timings?.jniMs = elapsedMs(jniStartNs)
    if (loaded != null) {
      webCache.put(spec.primary, loaded)
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

  private fun copyAssetToCache(assetPath: String): String? {
    val fileName = assetPath.replace('/', '_')
    val dest = File(context.cacheDir, "nm_tok_$fileName")
    return try {
      context.assets.open(assetPath).use { input ->
        // 长度校验（2026-09-29）：词表资产会随版本更新（如 glm.json 紧凑化
        // 20.4MB→8.2MB），只判「文件存在」会让旧缓存跨版本滞留、瘦身白做。
        // 资产流 available() 即条目长度，同名同长的错配概率可忽略。
        val assetSize = input.available().toLong()
        if (dest.exists() && dest.length() == assetSize) {
          return dest.absolutePath
        }
        dest.parentFile?.mkdirs()
        Files.copy(input, dest.toPath(), StandardCopyOption.REPLACE_EXISTING)
      }
      dest.absolutePath
    } catch (_: Throwable) {
      null
    }
  }

  private fun elapsedMs(startNs: Long): Long = (System.nanoTime() - startNs) / 1_000_000

  /**
   * 单条收尾打点，字段化 key=value 便于真机 logcat 直接肉眼读：
   * `nm-tok: family=claude chars=139002 vocabLoadMs=8123 encodeMs=5811 totalMs=13951`。
   *
   * release 门（merge 后小 CR 探针双门，与 JS 侧 `__DEV__` 门对应）：性能调查
   * 已收口，探针不常驻用户设备的 logcat；debug 包照常输出。包 try/catch 是
   * 因为 JVM 直测（无 Robolectric）下 `android.util.Log` 未 mock 会抛
   * 「Method i in android.util.Log not mocked」——打点是探针，绝不能反过来把
   * 计数路径搞崩。
   */
  private fun logTimings(timings: CountTimings) {
    if (!BuildConfig.DEBUG) {
      return
    }
    try {
      Log.i(
        LOG_TAG,
        "family=${timings.family} chars=${timings.chars} " +
          "vocabLoadMs=${timings.vocabLoadMs} copyMs=${timings.copyMs} jniMs=${timings.jniMs} " +
          "encodeMs=${timings.encodeMs} totalMs=${timings.totalMs}",
      )
    } catch (_: Throwable) {
      // 忽略：探针失败不影响计数结果。
    }
  }

  companion object {
    private const val LOG_TAG = "nm-tok"

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

    /**
     * gpt 家族（family == "tiktoken"）按编码名解析资产 spec（token-count-perf-r2）。
     * 缺编码名 / 编码名不在两表域（cl100k_base / o200k_base）即抛——JS 侧对
     * 出界模型（p50k/gpt2 家族）本就不发起原生调用，走到这里的抛错是防御线，
     * JS 桥 catch 后回退 js-tiktoken 档。
     */
    fun resolveTiktokenAssetSpec(encodingName: String?): AssetPathSpec {
      val name = encodingName?.trim().orEmpty()
      if (name.isEmpty()) {
        throw IllegalStateException("gpt 家族计数缺少编码名（vendorModelId 槽为空）")
      }
      return TokenizerAssetPaths.forTiktokenEncoding(name)
        ?: throw IllegalStateException("gpt 编码名 $name 无原生词表资产（两表域外）")
    }
  }
}

/**
 * 裸编码家族：SP 转 HF 三族 + tiktoken 两表。
 *
 * 这些家族必须整串直编码，不能做 WEB 的 system 包装——同一份文本差 3~5 token。
 * 口径从资产结构里拆出来单点定义：生产 dispatch 与两个测试共用，资产表只描述
 * 「资产在哪」（`primary` / `fallback` / `kind`）。
 */
internal fun isBareCaliber(family: String): Boolean =
  family in setOf("gemma", "llama", "mistral", "tiktoken")
