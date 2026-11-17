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
