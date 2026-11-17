/**
 * 数值格式化纯工具。
 *
 * @module common/format-number
 */

/** 非负整数补零到两位（`7` → `"07"`）；超过两位原样返回，不截断。 */
export function pad2(value: number): string {
    return String(value).padStart(2, "0");
}
