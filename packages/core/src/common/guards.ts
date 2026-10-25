/**
 * 通用判断工具（type guards / predicates）。
 *
 * 只放「输入 unknown、输出类型收窄或布尔」的小函数；序列化、格式化等
 * 其他类别各开同层模块（如 `merge-patch.ts`），不往这里堆。
 *
 * @module common/guards
 */

/** 判断值是不是非数组的普通对象（JSON object）。只排除 `null` 与数组，不校验原型。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
