/**
 * Smart sort rule compilation and draft validation (spec Step 7 / D6).
 *
 * @module domain/smart-sort-rule/logic/compile-smart-sort-rule
 */

import { SmartSortRuleError } from "@/errors/smart-sort-rule-errors.js";
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

/**
 * Counts capture groups via the `pattern + "|"` probe: appending a top-level
 * empty alternative makes `exec("")` always succeed, and the match array
 * length is `captureGroups + 1` regardless of whether the pattern itself can
 * match an empty string. Returns `null` when the probe fails to compile.
 */
function countCaptureGroups(pattern: string, flags: string): number | null {
  try {
    const probe = new RegExp(`${pattern}|`, flags);
    const match = probe.exec("");
    if (match == null) {
      return null;
    }
    return match.length - 1;
  } catch {
    return null;
  }
}

/**
 * Validates a rule draft before persist/compile:
 * name 必填、flags 合法（gimsuy 子集、不重复，复用 schema 层单源实现 C-1）、
 * 正则可编译；smart 档还要求 pattern 含 ≥1 捕获组（D6）——fixed 档命中即
 * 固定哨兵元组、捕获组被忽略，有无捕获组均合法（D13）。
 *
 * @throws {SmartSortRuleError} INVALID_ARGUMENT（name/flags/捕获组）或
 *   INVALID_PATTERN（正则不可编译）
 */
export function validateSmartSortRuleDraft(
  fields: SmartSortRuleValidationFields,
  options?: { ruleId?: string }
): void {
  const opts = { ruleId: options?.ruleId };
  if (fields.name == null || fields.name.length === 0) {
    throw new SmartSortRuleError("INVALID_ARGUMENT", "Rule name is required", opts);
  }
  assertFlagsValid(fields.flags, opts);
  let compiled: RegExp;
  try {
    compiled = new RegExp(fields.pattern, fields.flags);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new SmartSortRuleError(
      "INVALID_PATTERN",
      `Invalid regular expression: ${msg}`,
      opts
    );
  }
  compiled.lastIndex = 0;
  const captureKind = fields.captureKind ?? "smart";
  if (captureKind !== "smart") {
    return;
  }
  const groupCount = countCaptureGroups(fields.pattern, fields.flags);
  if (groupCount == null || groupCount < 1) {
    throw new SmartSortRuleError(
      "INVALID_ARGUMENT",
      "Pattern must contain at least one capture group (ordinals are extracted from capture groups)",
      opts
    );
  }
}

/**
 * Compiles a persisted {@link SmartSortRule} into a {@link CompiledSmartSortRule}
 * (workplace comparator input). Assumes the rule passed validation at write
 * time; a stale/uncompilable row surfaces as INVALID_PATTERN here.
 */
export function compileSmartSortRule(rule: SmartSortRule): CompiledSmartSortRule {
  let regex: RegExp;
  try {
    regex = new RegExp(rule.pattern, rule.flags);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new SmartSortRuleError(
      "INVALID_PATTERN",
      `Invalid regular expression in rule ${rule.ruleId}: ${msg}`,
      { ruleId: rule.ruleId }
    );
  }
  return {
    ruleId: rule.ruleId,
    name: rule.name,
    regex,
    captureKind: rule.captureKind,
  };
}
