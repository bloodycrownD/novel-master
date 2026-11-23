package com.novelmaster.llmsse

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * WHATWG UTF-8 decoder 语义单测（Encodings 标准 maximal-subpart 替换）。
 *
 * 期望值来源：Node `TextDecoder('utf-8')`（WHATWG 参考实现）离线 oracle
 * （e2e/scripts/whatwg-utf8-oracle.mjs 同源）；真机 mode G 注入流的历史实测
 * 基线：Java REPLACE 138 FFFD vs WHATWG 60——本套用例逐形态锁死差异。
 */
class Utf8StreamingDecoderTest {
  private val fffd = '\uFFFD'

  @Test
  fun asciiPassthrough() {
    assertEquals("hello", Utf8StreamingDecoder().feed("hello".toByteArray(Charsets.UTF_8)))
  }

  @Test
  fun chineseWellformedLossless() {
    val text = "山风红血面色辑部角色——充盈肿胀"
    assertEquals(text, Utf8StreamingDecoder().feed(text.toByteArray(Charsets.UTF_8)))
  }

  @Test
  fun isolatedContinuationEachOneFffd() {
    // 孤立 continuation（0x80..0xBF）：每字节恰 1 个 U+FFFD。
    // mode G 注入形态：孤立 BA A2 对 → 恰 2 个 FFFD（Node oracle 60/30 实证粒度）。
    val out = Utf8StreamingDecoder().feed(byteArrayOf(0xBA.toByte(), 0xA2.toByte()))
    assertEquals("$fffd$fffd", out)
  }

  @Test
  fun illegalLeadEachOneFffd() {
    // 0xC0/C1（非法 2 字节 lead）与 0xF5..0xFF（超上限 lead）：各 1 个 U+FFFD。
    val out = Utf8StreamingDecoder().feed(byteArrayOf(0xC0.toByte(), 0xC1.toByte(), 0xFF.toByte()))
    assertEquals("$fffd$fffd$fffd", out)
  }

  @Test
  fun overlongE0FollowedByLowContinuation() {
    // E0 80（overlong 开头，E0 要求 continuation >= 0xA0）：
    // WHATWG：E0 段 1 FFFD，80 回流又孤立 1 FFFD → 2。
    val out = Utf8StreamingDecoder().feed(byteArrayOf(0xE0.toByte(), 0x80.toByte()))
    assertEquals("$fffd$fffd", out)
  }

  @Test
  fun surrogateEdA0() {
    // ED A0（surrogate 编码开头，ED 要求 continuation <= 0x9F）：
    // WHATWG：ED 段 1 FFFD，A0 回流又孤立 1 FFFD → 2。
    val out = Utf8StreamingDecoder().feed(byteArrayOf(0xED.toByte(), 0xA0.toByte()))
    assertEquals("$fffd$fffd", out)
  }

  @Test
  fun surrogateFullCesU() {
    // ED A0 80（完整 CESU-8 surrogate）：WHATWG 官方示例 → 3 个 U+FFFD。
    val out = Utf8StreamingDecoder().feed(byteArrayOf(0xED.toByte(), 0xA0.toByte(), 0x80.toByte()))
    assertEquals("$fffd$fffd$fffd", out)
  }

  @Test
  fun leadFollowedByAsciiReflows() {
    // E7 41：E7 期待 continuation，41 越界 → E7 段 1 FFFD；41 回流是合法 ASCII 'A'。
    val out = Utf8StreamingDecoder().feed(byteArrayOf(0xE7.toByte(), 0x41.toByte()))
    assertEquals("${fffd}A", out)
  }

  @Test
  fun injectionBetweenChineseStaysMarked() {
    // 「红」= E7 BA A2，其后插入孤立 BA A2（mode G 实形态）：
    // 红完整解出；注入对各 1 FFFD → 文本=红 + 2 FFFD，零丢内容。
    val bytes = byteArrayOf(0xE7.toByte(), 0xBA.toByte(), 0xA2.toByte(), 0xBA.toByte(), 0xA2.toByte())
    val out = Utf8StreamingDecoder().feed(bytes)
    assertEquals("红$fffd$fffd", out)
  }

  @Test
  fun eofTruncatedSequenceOneFffd() {
    // 流结束（flush）时未完成序列恰 1 个 U+FFFD。
    val decoder = Utf8StreamingDecoder()
    decoder.feed(byteArrayOf(0xE7.toByte(), 0xBA.toByte()))
    assertEquals("$fffd", decoder.flush())
  }

  @Test
  fun eofCleanNoTail() {
    val decoder = Utf8StreamingDecoder()
    decoder.feed("完".toByteArray(Charsets.UTF_8))
    assertEquals("", decoder.flush())
  }

  @Test
  fun chunkSplitArbitraryNeverChangesOutput() {
    // 切分不变性：任意边界分片喂入 == 整段喂入（carry 无损的 property 锁）。
    val text = "少女全身毫无遮掩，被药水浸透的红布盖住——充盈红肿。红血面辑部角色圈"
    val corrupted = byteArrayOf(0xBA.toByte(), 0xA2.toByte())
    val stream = text.toByteArray(Charsets.UTF_8) + corrupted + "边界测试".toByteArray(Charsets.UTF_8)
    val whole = Utf8StreamingDecoder().feed(stream.copyOf()) + Utf8StreamingDecoder().flush()
    for (split in intArrayOf(1, 3, 7, 8, 13, stream.size - 1)) {
      val decoder = Utf8StreamingDecoder()
      val left = decoder.feed(stream.copyOfRange(0, split))
      val right = decoder.feed(stream.copyOfRange(split, stream.size))
      assertEquals("split at $split", whole, left + right + decoder.flush())
    }
  }

  @Test
  fun injectedStreamFffdCountMatchesWhatwgOracle() {
    // mode G 验收粒度：孤立 BA A2 注入合法中文流 → 每处恰 2 个 FFFD，
    // 其余字符逐字保留（Node oracle 60/30 实证粒度同源判据；计数动态断言防手数错）。
    val base = "山风掠过少女的肩头，被药水浸透的红布在夜里显得格外刺眼。她的面色辑部角色全无血色。".repeat(10)
    val injection = byteArrayOf(0xBA.toByte(), 0xA2.toByte())
    val stream = java.io.ByteArrayOutputStream()
    var injections = 0
    val chars = base.toCharArray()
    for ((index, ch) in chars.withIndex()) {
      val encoded = ch.toString().toByteArray(Charsets.UTF_8)
      stream.write(encoded)
      if (index % 10 == 7 && injections < 30) {
        stream.write(injection)
        injections++
      }
    }
    assertEquals("注入点应达 30（base 够长）", 30, injections)
    val decoder = Utf8StreamingDecoder()
    val out = decoder.feed(stream.toByteArray()) + decoder.flush()
    assertEquals(injections * 2, out.count { it == fffd })
    assertEquals(base.length, out.length - injections * 2)
  }
}
