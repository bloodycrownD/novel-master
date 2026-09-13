/**
 * Smart sort rule management errors.
 *
 * @module errors/smart-sort-rule-errors
 */

/** Discriminant codes for {@link SmartSortRuleError}. */
export type SmartSortRuleErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_ARGUMENT"
  | "INVALID_PATTERN"
  /** 内置规则（`builtin-` 前缀）仅可禁用不可删除（spec D3）。 */
  | "BUILTIN_PROTECTED";

/**
 * Unified error for smart sort rule service and validation.
 */
export class SmartSortRuleError extends Error {
  readonly code: SmartSortRuleErrorCode;
  readonly ruleId?: string;

  constructor(
    code: SmartSortRuleErrorCode,
    message: string,
    options?: { ruleId?: string }
  ) {
    super(message);
    this.name = "SmartSortRuleError";
    this.code = code;
    this.ruleId = options?.ruleId;
  }
}
