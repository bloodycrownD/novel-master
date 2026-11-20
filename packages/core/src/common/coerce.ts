/**
 * 不可信输入（JSON / IPC / LLM 参数）的安全取值工具。
 *
 * @module common/coerce
 */

import {Guards} from "./guards.js";
import {Json} from "./json.js";

export const Coerce = {
    /** 非字符串（含 null / undefined / 数字 / 对象）→ 空串；空串原样保留。 */
    string: (value: unknown): string => (typeof value === "string" ? value : ""),

    /** 从 SQL 行安全取出可空 TEXT，禁止 `String(null)` → `"null"`：null / undefined → null，其余 String 化。 */
    nullableText: (value: unknown): string | null => (value == null ? null : String(value)),

    /**
     * 只有 string 通过；数字 / 布尔 / 对象 / null → null（**不 String 化**）。
     * 处理不可信 JSON / YAML / 备份快照时用它；SQL 动态类型取值走 {@link Coerce.nullableText}。
     */
    strictText: (value: unknown): string | null => (typeof value === "string" ? value : null),

    /** 整数（number 或数字字符串）且 >= min；其余（小数 / 非数字 / 越界 / NaN / Infinity）→ undefined。 */
    integerAtLeast: (value: unknown, min: number): number | undefined => {
        if (typeof value === "number" && Number.isInteger(value) && value >= min) {
            return value;
        }
        if (typeof value === "string" && value.trim() !== "") {
            const n = Number(value);
            if (Number.isInteger(n) && n >= min) {
                return n;
            }
        }
        return undefined;
    },

    /** 数字（含数字字符串）→ number；其余（布尔 / 空串 / 空白串 / 非数字 / NaN / Infinity）→ undefined。 */
    number: (value: unknown): number | undefined => {
        if (typeof value === "number") {
            return Number.isFinite(value) ? value : undefined;
        }
        if (typeof value === "string" && value.trim() !== "") {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
        }
        return undefined;
    },

    /**
     * 只有有限 number 通过；数字字符串 → null（**不解析**）。
     * 处理不可信 JSON / YAML / 备份快照时用它；宽松解析走 {@link Coerce.number}。
     */
    strictNumber: (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null),

    /** 非负数字（含数字字符串）→ number；负数 / 非数字 / NaN / Infinity → undefined。 */
    nonNegativeNumber: (value: unknown): number | undefined => {
        const parsed = Coerce.number(value);
        return parsed !== undefined && parsed >= 0 ? parsed : undefined;
    },

    /** 非空字符串（trim 后非空）→ 原字符串；其余（含空串 / 空白串 / 非字符串）→ null。 */
    nonEmptyText: (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null),

    /** JSON 文本（可带 UTF-8 BOM）→ Record；null / undefined / 解析失败 / 非对象 → null。 */
    record: (text: string | null | undefined): Record<string, unknown> | null => {
        if (typeof text !== "string") {
            return null;
        }
        const parsed = Json.parseText(text);
        if (!parsed.ok) {
            return null;
        }
        return Guards.isRecord(parsed.value) ? parsed.value : null;
    },

    /** 从容器的键里取可空文本（值 String 化；键缺失 / null / undefined → null）；容器不是对象 → null。 */
    pickText: (container: unknown, key: string): string | null => {
        if (!Guards.isRecord(container)) {
            return null;
        }
        return Coerce.nullableText(container[key]);
    },
} as const;
