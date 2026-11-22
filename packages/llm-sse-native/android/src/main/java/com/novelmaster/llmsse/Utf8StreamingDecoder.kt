package com.novelmaster.llmsse

/**
 * WHATWG UTF-8 流式解码器（Encodings 标准 UTF-8 decoder 语义，error mode = replacement）。
 *
 * 替换 okio `readUtf8` / `new String(bytes, UTF_8)` 的 Java REPLACE 语义：后者按
 * per-byte 替换，多字节非法形态上 FFFD 计数与 WHATWG 不一致（真机 mode G 注入流
 * 实测 Java 138 vs Node WHATWG 60——多出 78 个假标记，误导坏点定位）。
 *
 * WHATWG 三原则（spec §9.8 UTF-8 decoder）：
 * 1. 流式 carry：chunk 边界切断的序列留内部状态，跨调用拼接无损解出；
 * 2. malformed 按 maximal subpart 分段，每段恰好 1 个 U+FFFD——非法
 *    continuation 越界时该字节前置回流重判（可能自起新序列），永不丢字节、
 *    永不吞标记；
 * 3. EOF 残尾（流结束时未完成的序列）恰好 1 个 U+FFFD。
 */
class Utf8StreamingDecoder {
    private var codePoint = 0
    private var bytesSeen = 0
    private var bytesNeeded = 0
    private var lowerBoundary = 0x80
    private var upperBoundary = 0xBF

    /** 喂入一段字节，返回已解出的文本（不完整尾部留内部状态）。 */
    fun feed(bytes: ByteArray): String {
        val sb = StringBuilder()
        var i = 0
        while (i < bytes.size) {
            val b = bytes[i].toInt() and 0xFF
            if (bytesNeeded == 0) {
                when {
                    b <= 0x7F -> sb.append(b.toChar())
                    b in 0xC2..0xDF -> startSequence(1, b, b and 0x1F, 0x80, 0xBF)
                    b == 0xE0 -> startSequence(2, b, b and 0xF, 0xA0, 0xBF)
                    b == 0xED -> startSequence(2, b, b and 0xF, 0x80, 0x9F)
                    b == 0xF0 -> startSequence(3, b, b and 0x07, 0x90, 0xBF)
                    b == 0xF4 -> startSequence(3, b, b and 0x07, 0x80, 0x8F)
                    b in 0xE1..0xEC || b == 0xEE || b == 0xEF -> startSequence(2, b, b and 0xF, 0x80, 0xBF)
                    b in 0xF1..0xF3 -> startSequence(3, b, b and 0x07, 0x80, 0xBF)
                    else -> sb.append(REPLACEMENT) // 0x80..0xC1 孤立 continuation / 0xF5..0xFF 非法 lead
                }
            } else if (b in lowerBoundary..upperBoundary) {
                lowerBoundary = 0x80
                upperBoundary = 0xBF
                codePoint = (codePoint shl 6) or (b and 0x3F)
                bytesSeen++
                if (bytesSeen == bytesNeeded) {
                    sb.appendCodePoint(codePoint)
                    bytesNeeded = 0
                    bytesSeen = 0
                }
            } else {
                // WHATWG：越界字节不消费——前置回流，本 subpart 以 1 个 U+FFFD 终结。
                reset()
                sb.append(REPLACEMENT)
                continue
            }
            i++
        }
        return sb.toString()
    }

    /** 流结束：未完成序列恰好 1 个 U+FFFD，状态复位（解码器不复用）。 */
    fun flush(): String {
        if (bytesNeeded == 0) {
            return ""
        }
        reset()
        return REPLACEMENT.toString()
    }

    private fun startSequence(needed: Int, lead: Int, prefix: Int, lower: Int, upper: Int) {
        bytesNeeded = needed
        bytesSeen = 0
        codePoint = prefix
        lowerBoundary = lower
        upperBoundary = upper
    }

    private fun reset() {
        bytesNeeded = 0
        bytesSeen = 0
        codePoint = 0
        lowerBoundary = 0x80
        upperBoundary = 0xBF
    }

    private companion object {
        const val REPLACEMENT = '\uFFFD'
    }
}
