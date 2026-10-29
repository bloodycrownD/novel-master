/**
 * JSON 类工具：文本解析（BOM 剥离、Either 化）、RFC 7396 Merge Patch。
 *
 * @module common/json
 */

import {Result} from "@/errors/either.js";
import {isRecord} from "./guards.js";

/**
 * 解析 JSON 文本（剥离 UTF-8 BOM）；失败返回 Err<Error>，不抛。
 */
export function parseJsonText(text: string): Result<unknown, Error> {
    const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    try {
        return Result.ok(JSON.parse(stripped) as unknown);
    } catch (error) {
        return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
}

/** 只跳过这三类键，防 `__proto__` 之类的原型污染（patch 可能来自外部 JSON）。 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

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
export function applyMergePatch<T>(current: T, patch: unknown): T {
    if (!isRecord(patch)) {
        // undefined 视为「没传」，保留现值；null / 数组 / 标量整体替换。
        return (patch === undefined ? current : patch) as T;
    }
    const merged: Record<string, unknown> = isRecord(current) ? {...current} : {};
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || UNSAFE_KEYS.has(key)) {
            continue;
        }
        if (value === null) {
            delete merged[key];
            continue;
        }
        merged[key] = applyMergePatch(merged[key], value);
    }
    return merged as T;
}
