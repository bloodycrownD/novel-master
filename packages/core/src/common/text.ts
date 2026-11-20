/**
 * 通用文本截断 / 转义 / HTML 实体解码纯工具。
 *
 * @module common/text
 */

import {Encoding} from "./encoding.js";

/** `Text.decodeHtmlEntities` 的选项：`preserveAngleBrackets` 保留尖括号（sanitize 出口路径用）。 */
export interface DecodeHtmlEntitiesOptions {
    readonly preserveAngleBrackets?: boolean;
}

/** LCS 的 DP 单元格上界；超过即走降级路径（≈ 2e6 格 × 4B ≈ 8MB）。 */
const LCS_DP_MAX_CELLS = 2_000_000;

/** LCS 降级时两侧各自的长度下限；低于此值直接放弃。 */
const LCS_DEGRADED_MIN_CHARS = 512;

/** ASCII 数字码位判定（自然排序分块用）。 */
function isAsciiDigitCode(code: number): boolean {
    return code >= 0x30 && code <= 0x39;
}

export const Text = {
    /**
     * 超过 `maxChars` 时保留前 `maxChars` 个字符并追加省略号；未超长原样返回。
     * 输出长度上限是 `maxChars + 1`（省略号不计入 `maxChars`）。
     */
    truncate: (text: string, maxChars: number): string =>
        text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`,

    /**
     * 按 UTF-8 字节截断：保留不超过 `maxBytes` 字节的最长前缀并追加省略号
     * （不切断代理对，省略号本身 3 字节，不计入 `maxBytes`）。
     *
     * 空串原样返回；`maxBytes` 为负数 / NaN 时返回 `"…"`；`Infinity` 原样返回。
     */
    truncateToBytes: (text: string, maxBytes: number): string => {
        if (text === "") {
            return text;
        }
        if (!Number.isFinite(maxBytes)) {
            return maxBytes === Number.POSITIVE_INFINITY ? text : "…";
        }
        if (Encoding.utf8ByteLength(text) <= maxBytes) {
            return text;
        }
        let used = 0;
        let out = "";
        for (const char of text) {
            // 单码点 UTF-8 字节数（与 Encoding.utf8ByteLength 的回落口径一致）
            const code = char.codePointAt(0)!;
            const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
            if (used + size > maxBytes) {
                break;
            }
            used += size;
            out += char;
        }
        return `${out}…`;
    },

    /**
     * 按 UTF-8 字节切前缀：返回不超过 `maxBytes` 字节的最长完整字符前缀
     * （**不追加省略号**；代理对成对推进，不切半个字符；预算 ≤ 0 → 空串）。
     *
     * @remarks 块式增量编码避免全量字符串一次性编码，块尾落在代理对中间时边界右移 1
     * （代理对不跨块，孤儿 surrogate 会虚高字节计数且可能进返回值）。
     */
    sliceUtf8Bytes: (text: string, maxBytes: number): string => {
        if (maxBytes <= 0) return "";
        const encoder = new TextEncoder();
        const CHUNK = 8192;
        let used = 0;
        // 块起点用变量传递（而非固定步进推算）：块尾恰为高代理项时边界右移 1，
        // 保证不重叠不遗漏。
        for (let start = 0; start < text.length; ) {
            let end = Math.min(start + CHUNK, text.length);
            const tailUnit = text.charCodeAt(end - 1);
            if (end < text.length && tailUnit >= 0xd800 && tailUnit <= 0xdbff) {
                end += 1;
            }
            const chunk = text.slice(start, end);
            const chunkBytes = encoder.encode(chunk).byteLength;
            if (used + chunkBytes <= maxBytes) {
                used += chunkBytes;
                start = end;
                continue;
            }
            for (let j = 0; j < chunk.length; ) {
                const codePoint = chunk.codePointAt(j)!;
                const charLength = codePoint > 0xffff ? 2 : 1;
                const charBytes = encoder.encode(String.fromCodePoint(codePoint)).byteLength;
                if (used + charBytes > maxBytes) {
                    return text.slice(0, start + j);
                }
                used += charBytes;
                j += charLength;
            }
            return text.slice(0, end);
        }
        return text;
    },

    /** 统计 needle 在 haystack 中的非重叠出现次数（重叠时仍计每次 indexOf 命中）。 */
    countOccurrences: (haystack: string, needle: string): number => {
        if (needle.length === 0) {
            return 0;
        }
        let count = 0;
        let start = 0;
        while (start <= haystack.length - needle.length) {
            const index = haystack.indexOf(needle, start);
            if (index === -1) {
                break;
            }
            count += 1;
            start = index + 1;
        }
        return count;
    },

    /**
     * 求 a 与 b 的最长公共子串；并列最长时取在 b 中首次出现位置最靠前的子串。
     *
     * @remarks DP 只依赖「上一行的左上角」，故用滚动两行 `Int32Array` 而非全表
     * `number[][]`；`endsInB` 记的是 **b 的下标**（沿行滚动足够）。两侧字符数过大时
     * 按同一比例裁剪降级——诊断路径不能因为一次失败诊断把进程打爆；降级结果被上游
     * `length === 0` 分支消化，错误码与调用流程零变化。
     */
    longestCommonSubstring: (a: string, b: string): {readonly substring: string; readonly length: number} => {
        if (a.length === 0 || b.length === 0) {
            return {substring: "", length: 0};
        }
        // 超阈值降级：按**同一比例**裁两侧（只砍一侧会让另一侧独占全部预算）。
        // scale = sqrt(上限 / 实际) ⇒ 裁剪后 nextA × nextB ≤ 上限恒成立。
        const totalCells = a.length * b.length;
        if (totalCells > LCS_DP_MAX_CELLS) {
            const scale = Math.sqrt(LCS_DP_MAX_CELLS / totalCells);
            const nextA = Math.floor(a.length * scale);
            const nextB = Math.floor(b.length * scale);
            if (nextA < LCS_DEGRADED_MIN_CHARS || nextB < LCS_DEGRADED_MIN_CHARS) {
                return {substring: "", length: 0};
            }
            a = a.slice(0, nextA);
            b = b.slice(0, nextB);
        }

        const cols = b.length + 1;
        let maxLen = 0;
        const endsInB: number[] = [];
        let prev = new Int32Array(cols);
        let cur = new Int32Array(cols);

        for (let i = 1; i < a.length + 1; i++) {
            cur.fill(0);
            for (let j = 1; j < cols; j++) {
                if (a[i - 1] === b[j - 1]) {
                    const len = prev[j - 1]! + 1;
                    cur[j] = len;
                    if (len > maxLen) {
                        maxLen = len;
                        endsInB.length = 0;
                        endsInB.push(j);
                    } else if (len === maxLen && len > 0) {
                        endsInB.push(j);
                    }
                }
            }
            const swap = prev;
            prev = cur;
            cur = swap;
        }

        if (maxLen === 0) {
            return {substring: "", length: 0};
        }
        // 循环取最小值：`Math.min(...endsInB)` 在并列最长子串极多时会撞 V8 的
        // 参数展开上限（≈2×10⁵）抛 RangeError。
        let endInB = globalThis.Number.POSITIVE_INFINITY;
        for (const value of endsInB) {
            if (value < endInB) {
                endInB = value;
            }
        }
        const startInB = endInB - maxLen;
        return {substring: b.slice(startInB, endInB), length: maxLen};
    },

    /** 按 `"\n"` 切行；空串 → `[]`（空文件 0 行，直接 split 会得到 `[""]`）。 */
    splitLines: (text: string): string[] => (text === "" ? [] : text.split("\n")),

    /** 按 `"\n"` 拼行（与 {@link Text.splitLines} 同一分隔符约定）。 */
    joinLines: (lines: readonly string[]): string => lines.join("\n"),

    /**
     * 按 ASCII 数字 / 非数字切成交替块（数字仅 `0-9`；全角数字与中文都算非数字）。
     */
    tokenizeNatural: (s: string): string[] => {
        const chunks: string[] = [];
        const n = s.length;
        let i = 0;
        while (i < n) {
            const digitChunk = isAsciiDigitCode(s.charCodeAt(i));
            const start = i;
            i++;
            while (i < n && isAsciiDigitCode(s.charCodeAt(i)) === digitChunk) {
                i++;
            }
            chunks.push(s.slice(start, i));
        }
        return chunks;
    },

    /**
     * 自然序比较：两侧同为数字块 → 先比位数再多位逐位比；否则整块按 code unit 比；
     * 公共块用尽后短串在前（按总长度差）。
     */
    compareNatural: (a: string, b: string): number => {
        const chunksA = Text.tokenizeNatural(a);
        const chunksB = Text.tokenizeNatural(b);
        const common = Math.min(chunksA.length, chunksB.length);
        for (let i = 0; i < common; i++) {
            const x = chunksA[i]!;
            const y = chunksB[i]!;
            if (isAsciiDigitCode(x.charCodeAt(0)) && isAsciiDigitCode(y.charCodeAt(0))) {
                if (x.length !== y.length) {
                    return x.length - y.length;
                }
                for (let j = 0; j < x.length; j++) {
                    const r = x.charCodeAt(j) - y.charCodeAt(j);
                    if (r !== 0) {
                        return r;
                    }
                }
            } else if (x !== y) {
                return x < y ? -1 : 1;
            }
        }
        return a.length - b.length;
    },

    /** 转义正则元字符，使结果可作为字面量拼进 `new RegExp`。 */
    escapeRegExp: (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),

    /**
     * 逐行剥前缀：按 `"\n"` 切行，**每行至多替换一次**（`pattern` 无需全局标志），再按原分隔符拼回。
     *
     * @remarks 判据全部落在 `pattern` 里（锚定形态、是否容忍前导空格），本函数不持有任何业务口径。
     */
    stripLinePrefix: (body: string, pattern: RegExp): string => body.split("\n").map((line) => line.replace(pattern, "")).join("\n"),

    /**
     * HTML 转义：`&` `<` `>` `"` 四个实体（**不处理单引号**，与历史输出逐字节一致）。
     *
     * @remarks 入参取 `unknown`（WebView 侧原口径）：非字符串先 `String(value)` 化，
     * 调用方已保证 string 时行为不变。
     */
    escapeHtml: (value: unknown): string => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),

    /**
     * 解码字面 HTML 实体：命名实体 + 引号/尖括号的十进制与十六进制数值实体，
     * 最多 3 轮（处理 `&amp;quot;` 这类双重编码）。
     *
     * @remarks 替换顺序固定为 amp → quot/apos（含数值）→ 尖括号（含数值），逐轮重跑直到稳定；
     * `preserveAngleBrackets` 为 true 时跳过尖括号那一档（sanitize 出口用，避免把转义后的
     * 伪标签再变回裸尖括号）。非字符串按 WebView 侧 `String(value || "")` 口径（falsy → 空串）。
     */
    decodeHtmlEntities: (value: unknown, options?: DecodeHtmlEntitiesOptions): string => {
        const preserveAngleBrackets = options?.preserveAngleBrackets === true;
        let current = String(value || "");
        let previous = "";
        let pass = 0;
        while (current !== previous && pass < 3) {
            previous = current;
            current = current.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#(?:0*34|x0*22);/gi, '"').replace(/&apos;/gi, "'").replace(/&#(?:0*39|x0*27);/gi, "'");
            if (!preserveAngleBrackets) {
                current = current.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(?:0*60|x0*3c);/gi, "<").replace(/&#(?:0*62|x0*3e);/gi, ">");
            }
            pass += 1;
        }
        return current;
    },
} as const;
