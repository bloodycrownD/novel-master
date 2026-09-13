/**
 * Smart sort rule entity (SQL-backed, flat single table, spec D2).
 *
 * @module domain/smart-sort-rule/model/smart-sort-rule
 */

/**
 * 单条智能排序规则：captureKind 为 smart 时 pattern 必须含 ≥1 捕获组，
 * 全部捕获组可解析为数值时该规则命中并产出序号元组（D6）；fixed_min/
 * fixed_max 档命中即产出固定哨兵元组，忽略捕获组（D13）。
 * `sortOrder` 全表统一重编号（1..N）。
 */
export interface SmartSortRule {
  readonly ruleId: string;
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  /** 捕获数字档位（D13）：smart 捕获组提取 / fixed_min 哨兵排最前 / fixed_max 沉底。 */
  readonly captureKind: SmartSortCaptureKind;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly sortOrder: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

/**
 * 捕获数字三档（D13）：smart = 捕获组→数字转换管道（现状）；fixed_min =
 * 命中即哨兵元组 (-Infinity,) 排一切序号前（序章/楔子类）；fixed_max =
 * 命中即哨兵元组 (+Infinity,) 沉底（终章/番外类）。哨兵 ±∞ 只存在于
 * 内存比较，不落库不进 YAML/IPC 序列化（存储层只有枚举字符串）。
 */
export type SmartSortCaptureKind = "smart" | "fixed_min" | "fixed_max";

/** 全部合法 captureKind 值（DDL CHECK / CLI 校验 / GUI 选项共用单源）。 */
export const SMART_SORT_CAPTURE_KINDS: readonly SmartSortCaptureKind[] = [
  "smart",
  "fixed_min",
  "fixed_max",
];

/** 内置规则固定 rule_id 前缀：仅可禁用不可删除（spec D3）。 */
export const BUILTIN_SMART_SORT_RULE_ID_PREFIX = "builtin-";

/** True when the rule id belongs to the built-in (undeletable) set. */
export function isBuiltinSmartSortRuleId(ruleId: string): boolean {
  return ruleId.startsWith(BUILTIN_SMART_SORT_RULE_ID_PREFIX);
}
