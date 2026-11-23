package com.novelmaster.llmsse

import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * 历史乱码根因的回归复现（mobile-sse-utf8-decode-fix）。
 *
 * [LegacyPump] 逐字复刻 v1.5.50 及更早版本的读循环（`pumpStream` + `completeUtf8PrefixLength`
 * + `Buffer.readUtf8(safe)`）。缺陷：序列长度判定用掩码 0xF8 分支，lead 在 0xE8..0xEF 的
 * 3 字节字符（U+8000..U+FFFF：高区汉字与全角标点）落入 `else -> 2L`。当一次 read 恰好停在
 * 这类字符的第 2 个字节之后，尾部被误判为「完整」并交给解码 → 前 2 字节成 1 个 U+FFFD，
 * 下一段开头的第 3 字节又成 1 个 U+FFFD：恰好 2 个替换符、丢 1 个字——与历史库 253 处坏点
 * （100% 为 2 连）及还原出的原字码点分布（92/94 落在高区，基率仅 20.6%）逐项吻合。
 *
 * 本套用例同时锁住 [Utf8StreamingDecoder] 对同一输入逐字无损。
 */
class LegacyDecoderRegressionTest {
    private val fffd = '\uFFFD'

    /** v1.5.50 `pumpStream` + `completeUtf8PrefixLength` 的逐字复刻（仅测试用，勿用于生产）。 */
    private object LegacyPump {
        fun decode(bytes: ByteArray, readEnds: IntArray): String {
            val carry = Buffer()
            val out = StringBuilder()
            var start = 0
            for (end in readEnds + intArrayOf(bytes.size)) {
                carry.write(bytes, start, end - start)
                start = end
                val safe = completeUtf8PrefixLength(carry)
                if (safe > 0) {
                    out.append(carry.readUtf8(safe))
                }
            }
            // v1.5.50 在流结束后不处理 carry 残余（不完整尾部直接丢弃）。
            return out.toString()
        }

        fun completeUtf8PrefixLength(buf: Buffer): Long {
            val size = buf.size
            if (size == 0L) {
                return 0L
            }
            var back = 1L
            while (back <= 4L && back <= size) {
                val b = buf[size - back]
                if (b.toInt() and 0x80 == 0x00) {
                    return size
                }
                if (b.toInt() and 0xC0 == 0xC0) {
                    val sequenceLength = when (b.toInt() and 0xF8) {
                        0xF0 -> 4L
                        0xE0 -> 3L
                        0xC0 -> 2L
                        else -> 2L
                    }
                    return if (back >= sequenceLength) size else size - back
                }
                back++
            }
            return size
        }
    }

    private fun legacyWithNewDecoder(bytes: ByteArray, readEnds: IntArray): String {
        val decoder = Utf8StreamingDecoder()
        val out = StringBuilder()
        var start = 0
        for (end in readEnds + intArrayOf(bytes.size)) {
            out.append(decoder.feed(bytes.copyOfRange(start, end)))
            start = end
        }
        return (out.append(decoder.flush())).toString()
    }

    @Test
    fun legacyMisjudgesHighRangeLeadAsTwoByteSequence() {
        // 「部」= E9 83 A8（lead E9 → 落入 else 分支）：尾部停在 2 字节处，旧逻辑误判「完整」。
        val buf = Buffer().apply { write(byteArrayOf(0xE9.toByte(), 0x83.toByte())) }
        assertEquals("lead E9 的 3 字节字符只到了 2 字节，应保留等待，旧逻辑却判完整", 2L, LegacyPump.completeUtf8PrefixLength(buf))
        // 对照「低区字」「被」= E8 88 AB 同样落入 else；而「发」= E5 8F 91（lead E5）判 3 → 正确保留。
        val low = Buffer().apply { write(byteArrayOf(0xE5.toByte(), 0x8F.toByte())) }
        assertEquals(0L, LegacyPump.completeUtf8PrefixLength(low))
    }

    @Test
    fun legacySplitsHighRangeCharacterIntoTwoFffdAtReadBoundary() {
        // 合法流：「甲」「发」「部」「乙」，read 恰好停在「部」的第 2 个字节之后。
        val text = "甲发部乙"
        val bytes = text.toByteArray(Charsets.UTF_8)
        val buOffset = text.indexOf('部').let { i -> text.substring(0, i).toByteArray(Charsets.UTF_8).size }
        val readEnds = intArrayOf(buOffset + 2)
        val legacy = LegacyPump.decode(bytes, readEnds)
        assertEquals("旧逻辑：一个字变成恰好 2 个 U+FFFD", "甲发${fffd}${fffd}乙", legacy)
        assertEquals("新解码器：同一输入逐字无损", text, legacyWithNewDecoder(bytes, readEnds))
    }

    @Test
    fun legacyLeavesLowRangeCharacterIntactAtSameBoundary() {
        // 同样的切法落在低区字「发」(E5 8F 91) 的第 2 字节之后：旧逻辑正确保留，不坏。
        val text = "甲部发乙"
        val bytes = text.toByteArray(Charsets.UTF_8)
        val faOffset = text.indexOf('发').let { i -> text.substring(0, i).toByteArray(Charsets.UTF_8).size }
        assertEquals(text, LegacyPump.decode(bytes, intArrayOf(faOffset + 2)))
    }

    @Test
    fun legacyCorruptsWellformedStreamAcrossRandomBoundariesWhileNewDecoderStaysLossless() {
        // 历史乱码形态复现：完全合法的长中文流 + 随机 read 边界 → 旧逻辑必然产生 2 连替换符。
        val paragraph = "锁链拖在肮脏的石板地上，发出刺耳的摩擦声。伏在男仆靴旁四肢爬行的少女全身毫无遮掩，" +
            "被药水浸透的红布在夜里显得格外刺眼。她的面色苍白，需销毁的证据：部首、规则与自洽的问答。"
        val text = paragraph.repeat(12)
        val bytes = text.toByteArray(Charsets.UTF_8)
        val random = Random(20261123)
        var legacyBadSpots = 0
        var legacyRunsOfTwo = 0
        repeat(200) {
            val cuts = sortedSetOf<Int>()
            while (cuts.size < 40) {
                cuts.add(random.nextInt(1, bytes.size))
            }
            val out = LegacyPump.decode(bytes, cuts.toIntArray())
            val runs = Regex("$fffd+").findAll(out).map { it.value.length }.toList()
            legacyBadSpots += runs.sum()
            legacyRunsOfTwo += runs.count { it == 2 }
            assertEquals("新解码器：任意边界逐字无损", text, legacyWithNewDecoder(bytes, cuts.toIntArray()))
        }
        println("legacy-replica: 200 轮随机边界（每轮 40 个切点，${text.length} 字合法流）→ 替换符 $legacyBadSpots 个，2 连段 $legacyRunsOfTwo 段；新解码器 200 轮全部逐字无损")
        assertTrue("旧逻辑在合法流上产生替换符（实测 $legacyBadSpots 个）", legacyBadSpots > 0)
        assertEquals("旧逻辑的坏点全部是 2 连（历史指纹）", legacyBadSpots / 2, legacyRunsOfTwo)
    }
}
