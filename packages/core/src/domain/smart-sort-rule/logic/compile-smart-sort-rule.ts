/**
 * Smart sort rule compilation and draft validation (spec Step 7 / D6).
 *
 * 校验/编译失败走 `Result`（key `SMART_SORT_RULE_INVALID_ARGUMENT` /
 * `SMART_SORT_RULE_INVALID_PATTERN`），本模块不抛；service 在边界按
 * `if (!r.ok) throw r.error` 解包。
 *
 * @module domain/smart-sort-rule/logic/compile-smart-sort-rule
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { assertFlagsValid } from "@/domain/smart-sort-rule/model/smart-sort-rule.schema.js";
import type { SmartSortCaptureKind, SmartSortRule } from "../model/smart-sort-rule.js";
import type { CompiledSmartSortRule } from "@/domain/workplace/logic/smart-sort.js";

/** Draft fields accepted by {@link validateSmartSortRuleDraft}. */
export interface SmartSortRuleValidationFields {
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  /** 捕获数字档位（D13）：缺省 smart；fixed 档不强制捕获组（忽略之）。 */
  readonly captureKind?: SmartSortCaptureKind;
}

/** 本模块的领域失败：草稿不合法（name/flags/捕获组）或正则不可编译。 */
type SmartSortRuleLogicError = AppError<"SMART_SORT_RULE_INVALID_ARGUMENT" | "SMART_SORT_RULE_INVALID_PATTERN">;

/**
 * Validates a rule draft before persist/compile:
 * name 必填、flags 合法（gimsuy 子集、不重复，复用 schema 层单源实现 C-1）、
 * 正则可编译；smart 档还要求 pattern 含 ≥1 捕获组（D6）——fixed 档命中即
 * 固定哨兵元组、捕获组被忽略，有无捕获组均合法（D13）。
 *
 * @returns 合法时 Ok；否则 Err INVALID_ARGUMENT（name/flags/捕获组）或
 *   INVALID_PATTERN（正则不可编译）
 */
export function validateSmartSortRuleDraft(fields: SmartSortRuleValidationFields, options?: { ruleId?: string }): Result<void, SmartSortRuleLogicError> {
  const details = { ruleId: options?.ruleId };
  if (fields.name == null || fields.name.length === 0) {
    return Result.err(new AppError("SMART_SORT_RULE_INVALID_ARGUMENT", "Rule name is required", details));
  }
  const flagsValid = assertFlagsValid(fields.flags, details);
  if (!flagsValid.ok) {
    return Result.err(flagsValid.error);
  }
  try {
    new RegExp(fields.pattern, fields.flags);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Result.err(new AppError("SMART_SORT_RULE_INVALID_PATTERN", `Invalid regular expression: ${msg}`, details));
  }
  const captureKind = fields.captureKind ?? "smart";
  if (captureKind !== "smart") {
    return Result.ok(undefined);
  }
  // 捕获组计数用 `pattern + "|"` 探针：追加一个顶层空分支后 exec("") 必然成功，
  // 匹配数组长度恒为「捕获组数 + 1」，与 pattern 本身能否匹配空串无关。
  let groupCount: number | null;
  try {
    const match = new RegExp(`${fields.pattern}|`, fields.flags).exec("");
    groupCount = match == null ? null : match.length - 1;
  } catch {
    groupCount = null;
  }
  if (groupCount == null || groupCount < 1) {
    return Result.err(new AppError("SMART_SORT_RULE_INVALID_ARGUMENT", "Pattern must contain at least one capture group (ordinals are extracted from capture groups)", details));
  }
  return Result.ok(undefined);
}

/**
 * Compiles a persisted {@link SmartSortRule} into a {@link CompiledSmartSortRule}
 * (workplace comparator input). Assumes the rule passed validation at write
 * time; a stale/uncompilable row surfaces as Err INVALID_PATTERN here.
 */
export function compileSmartSortRule(rule: SmartSortRule): Result<CompiledSmartSortRule, SmartSortRuleLogicError> {
  try {
    const regex = new RegExp(rule.pattern, rule.flags);
    return Result.ok({ ruleId: rule.ruleId, name: rule.name, regex, captureKind: rule.captureKind });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Result.err(new AppError("SMART_SORT_RULE_INVALID_PATTERN", `Invalid regular expression in rule ${rule.ruleId}: ${msg}`, { ruleId: rule.ruleId }));
  }
}
