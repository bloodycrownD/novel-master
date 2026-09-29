package com.novelmaster.tokenizer

import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer
import org.junit.Test
import java.io.File
import java.nio.file.Paths

/**
 * 临时探针（不作为断言门禁）：glm 原生（DJL/Rust）计数的规模-耗时曲线。
 *
 * 要回答的问题：真机 139KB ~5.8s 是「手机 CPU 的线性成本」还是
 * 「无空白中文长词的合并病态」（glm 预分词是 GPT-2 系 \p{L}+ 正则，
 * 无标点中文串会成单个巨型词——js-tiktoken 同形态实测过 O(n²)）。
 * 线性 → 拆分无益（N 次过桥反而更慢）；病态 → 按句拆分有数量级收益。
 */
class TokenizerScalingProbeTest {
  @Test
  fun glmScalingCurve() {
    val asset = File("src/main/assets/tokenizers/web/glm.json")
    if (!asset.exists()) {
      println("PROBE skip: glm.json missing (cwd=${File(".").absolutePath})")
      return
    }
    val tok = HuggingFaceTokenizer.newInstance(
      Paths.get(asset.absolutePath),
      mapOf("truncation" to "false"),
    )
    val naturalUnit = "夜色如水，林间小径上落满了枯叶。她停下脚步，抬头望向灯火阑珊处；风穿过树梢。"
    val unbrokenUnit = "夜色如水林间小径上落满了枯叶她停下脚步抬头望向灯火阑珊处风穿过树梢"
    val natural = naturalUnit.repeat(4000) // ~132K chars（≈用户 139KB 会话量级）
    val unbroken = unbrokenUnit.repeat(1000) // ~33K chars 池

    fun time(label: String, text: String) {
      val t0 = System.currentTimeMillis()
      val n = tok.encode(text).ids.size
      println("PROBE $label chars=${text.length} tokens=$n ms=${System.currentTimeMillis() - t0}")
    }

    tok.encode("预热。")
    // 词表加载耗时单独计时（释放后重载一次，排除 JVM 类加载噪声取第二遍）。
    run {
      val t0 = System.currentTimeMillis()
      HuggingFaceTokenizer.newInstance(
        Paths.get(asset.absolutePath),
        mapOf("truncation" to "false"),
      )
      println("PROBE vocab-load(reload) ms=${System.currentTimeMillis() - t0}")
    }
    time("natural-8k", natural.take(8_000))
    time("natural-30k", natural.take(30_000))
    time("natural-46k(≈139KB)", natural.take(46_000))
    time("natural-132k", natural)
    time("unbroken-1k", unbroken.take(1_000))
    time("unbroken-2k", unbroken.take(2_000))
    time("unbroken-4k", unbroken.take(4_000))
    time("unbroken-8k", unbroken.take(8_000))
  }
}
