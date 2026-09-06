/**
 * Smart sort rule entity (SQL-backed, flat single table, spec D2).
 *
 * @module domain/smart-sort-rule/model/smart-sort-rule
 */

/**
 * 单条智能排序规则：pattern 必须含 ≥1 捕获组，全部捕获组可解析为数值时
 * 该规则命中并产出序号元组（D6）。`sortOrder` 全表统一重编号（1..N）。
 */
export interface SmartSortRule {
  readonly ruleId: string;
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly example: string | null;
  readonly enabled: boolean;
  readonly sortOrder: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

/** 内置规则固定 rule_id 前缀：仅可禁用不可删除（spec D3）。 */
export const BUILTIN_SMART_SORT_RULE_ID_PREFIX = "builtin-";

/** True when the rule id belongs to the built-in (undeletable) set. */
export function isBuiltinSmartSortRuleId(ruleId: string): boolean {
  return ruleId.startsWith(BUILTIN_SMART_SORT_RULE_ID_PREFIX);
}
