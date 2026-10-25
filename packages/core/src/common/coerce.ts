/**
 * 不可信输入（JSON / IPC / LLM 参数）的安全取值工具。
 *
 * @module common/coerce
 */

/** 非字符串（含 null / undefined / 数字 / 对象）→ 空串；空串原样保留。 */
export function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 整数（number 或数字字符串）且 >= min；其余（小数 / 非数字 / 越界 / NaN / Infinity）→ undefined。 */
export function integerAtLeast(value: unknown, min: number): number | undefined {
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
}
