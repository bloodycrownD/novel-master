/**
 * 通用文本截断 / 转义纯工具。
 *
 * @module common/text
 */

import {Encoding} from "./encoding.js";

/** 单个码点的 UTF-8 字节数（与 {@link Encoding.utf8ByteLength} 的回落口径一致）。 */
function utf8SizeOf(char: string): number {
    const code = char.codePointAt(0)!;
    return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
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
            const size = utf8SizeOf(char);
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
} as const;
