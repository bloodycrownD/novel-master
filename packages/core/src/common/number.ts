/**
 * 数值格式化纯工具。
 *
 * 对象名按约定叫 `Number`；模块内访问原生数字工具一律走 `globalThis.Number`，
 * 避免被本文件的局部绑定遮蔽。
 *
 * @module common/number
 */

export const Number = {
    /** 非负整数补零到两位（`7` → `"07"`）；超过两位原样返回，不截断。 */
    pad2: (value: number): string => String(value).padStart(2, "0"),

    /**
     * 字节数格式化：1024 进位（B/KB/MB）、保留 1 位小数（整数位不带 .0）。
     *
     * 负数落 `< 1024` 分支、按字节带符号输出（`-2048` → `"-2048B"`）；
     * 极大值继续用 MB 表达；`NaN` / `±Infinity` 原样 `String()` 化。
     */
    formatBytes: (bytes: number): string => {
        if (!globalThis.Number.isFinite(bytes)) {
            return String(bytes);
        }
        if (bytes < 1024) {
            return `${bytes}B`;
        }
        const kb = bytes / 1024;
        if (kb < 1024) {
            return `${Number.trimFraction(kb)}KB`;
        }
        return `${Number.trimFraction(kb / 1024)}MB`;
    },

    /**
     * 保留 1 位小数并裁掉尾部的 `.0`（`2` → `"2"`，`1.25` → `"1.3"`）。
     * `NaN` / `Infinity` 与 `toFixed` 口径一致，原样字符串化。
     */
    trimFraction: (n: number): string => {
        const fixed = n.toFixed(1);
        return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
    },
} as const;
