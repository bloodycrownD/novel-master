/**
 * Smart sort rule compilation and draft validation (spec Step 7 / D6).
 *
 * @module domain/smart-sort-rule/logic/compile-smart-sort-rule
 */

import { SmartSortRuleError } from "@/errors/smart-sort-rule-errors.js";
import type { CompiledSmartSortRule } from "@/domain/workplace/logic/smart-sort.js";
import type { SmartSortRule } from "../model/smart-sort-rule.js";

/** Draft fields accepted by {@link validateSmartSortRuleDraft}. */
export interface SmartSortRuleValidationFields {
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
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
 * name 必填、flags 合法（gimsuy 子集、不重复）、正则可编译、pattern 含 ≥1 捕获组（D6）。
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
  const flagChars = new Set(fields.flags);
  if (
    fields.flags.length !== flagChars.size ||
    ![...fields.flags].every((ch) => "gimsuy".includes(ch))
  ) {
    throw new SmartSortRuleError(
      "INVALID_ARGUMENT",
      `Invalid flags '${fields.flags}': only g/i/m/s/u/y, no repeats`,
      opts
    );
  }
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
  };
}
