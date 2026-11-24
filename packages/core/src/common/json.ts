/**
 * JSON 类工具：文本解析（BOM 剥离、Either 化）、RFC 7396 Merge Patch、多行缩进展开。
 *
 * @module common/json
 */

import {Result} from "@/errors/either.js";
import {Guards} from "./guards.js";
import {Text} from "./text.js";

/** 只跳过这三类键，防 `__proto__` 之类的原型污染（patch 可能来自外部 JSON）。 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const Json = {
    /**
     * JSON 对象 / 数组 → 两空格缩进的多行文本；不是合法 JSON 对象 / 数组 → `null`。
     *
     * @remarks 只插空白、不改任何 token：数字与短字符串字面量逐字节保留（超出安全整数
     * 范围的 id 不受损）。超过 `maxWidth` 的长字符串值解码后原样展开（内嵌 JSON 递归
     * 缩进，其余按 {@link Text.wrapLongLines} 折行），这类值展开后不再是合法 JSON。
     */
    prettyJson: (text: string, maxWidth: number): string | null => {
        const head = text.trimStart()[0];
        if (head !== "{" && head !== "[") return null;
        try {
            const parsed: unknown = JSON.parse(text);
            if (parsed === null || typeof parsed !== "object") return null;
        } catch {
            return null;
        }
        const out: string[] = [];
        // opened[i]：第 i 层容器开括号后是否换过行；空容器 {} / [] 留在同一行。
        const opened: boolean[] = [];
        let depth = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const pad = "  ".repeat(Math.min(depth, 20));
            if (ch === '"') {
                let end = i + 1;
                while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
                const token = text.slice(i, end + 1);
                const decoded: string = JSON.parse(token);
                out.push(decoded.length > maxWidth ? `"${Json.prettyJson(decoded, maxWidth) ?? Text.wrapLongLines(decoded, maxWidth)}"` : token);
                i = end;
                continue;
            }
            if (ch === "{" || ch === "[") {
                let next = i + 1;
                while (/\s/.test(text[next] ?? "")) next++;
                // 空容器 {} / [] 不换行。
                if (text[next] === "}" || text[next] === "]") {
                    out.push(ch, text[next]);
                    i = next;
                    continue;
                }
                opened[depth] = true;
                depth++;
                out.push(ch, "\n", "  ".repeat(Math.min(depth, 20)));
                continue;
            }
            if (ch === "}" || ch === "]") {
                depth--;
                if (opened[depth]) out.push("\n", "  ".repeat(Math.min(depth, 20)));
            } else if (ch === ",") {
                out.push(",", "\n", pad);
                continue;
            } else if (ch === ":") {
                out.push(": ");
                continue;
            } else if (/\s/.test(ch)) continue;
            out.push(ch);
        }
        return out.join("");
    },
    /**
     * 解析 JSON 文本（剥离 UTF-8 BOM）；失败返回 Err<Error>，不抛。
     */
    parseText: (text: string): Result<unknown, Error> => {
        const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
        try {
            return Result.ok(JSON.parse(stripped) as unknown);
        } catch (error) {
            return Result.err(error instanceof Error ? error : new Error(String(error)));
        }
    },

    /**
     * 把 patch 合并进 current，返回新对象（不修改入参）。
     *
     * 语义：对象递归合并；`null` 删除键；数组与标量整体替换；未出现的键保留现值。
     * 这里刻意不认识任何业务模型——业务侧自己定义显式的 patch 接口，
     * 合并时直接调用本函数，不再另设薄壳。
     *
     * `patch` 用 `unknown` 接：调用方常拿到未校验的 JSON，形状校验本来就该在下游
     * 统一做；这里只保证合并语义可预期。
     */
    mergePatch: <T>(current: T, patch: unknown): T => {
        if (!Guards.isRecord(patch)) {
            // undefined 视为「没传」，保留现值；null / 数组 / 标量整体替换。
            return (patch === undefined ? current : patch) as T;
        }
        const merged: Record<string, unknown> = Guards.isRecord(current) ? {...current} : {};
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || UNSAFE_KEYS.has(key)) {
                continue;
            }
            if (value === null) {
                delete merged[key];
                continue;
            }
            merged[key] = Json.mergePatch(merged[key], value);
        }
        return merged as T;
    },
} as const;
