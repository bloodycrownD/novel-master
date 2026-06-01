/**
 * Business validation for regex rules before persist/compile.
 *
 * @module domain/regex/validate-regex-rule
 */

import { RegexError } from "@/errors/regex-errors.js";
import type { RegexRule } from "../model/regex-rule.js";
import { validateDepthSlice } from "@/domain/depth/logic/depth-slice.js";

export interface RegexRuleValidationFields {
  readonly pattern: string;
  readonly flags: string;
  readonly llmReplace: string | null;
  readonly displayReplace: string | null;
  readonly startDepth: number | null;
  readonly endDepth: number | null;
  readonly scopeUser: boolean;
  readonly scopeAssistant: boolean;
}

/**
 * Validates replace fields, scope, depth, and RegExp syntax.
 *
 * @throws {RegexError} when validation fails
 */
export function validateRegexRule(
  fields: RegexRuleValidationFields,
  options?: { groupId?: string; ruleId?: string },
): void {
  const opts = { groupId: options?.groupId, ruleId: options?.ruleId };
  const hasLlm =
    fields.llmReplace != null && fields.llmReplace !== "";
  const hasDisplay =
    fields.displayReplace != null && fields.displayReplace !== "";
  if (!hasLlm && !hasDisplay) {
    throw new RegexError(
      "INVALID_ARGUMENT",
      "At least one of llmReplace or displayReplace must be set",
      opts,
    );
  }
  if (!fields.scopeUser && !fields.scopeAssistant) {
    throw new RegexError(
      "INVALID_ARGUMENT",
      "At least one of scopeUser or scopeAssistant must be true",
      opts,
    );
  }
  try {
    validateDepthSlice({
      startDepth: fields.startDepth ?? undefined,
      endDepth: fields.endDepth ?? undefined,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new RegexError("INVALID_ARGUMENT", msg, opts);
  }
  try {
    // eslint-disable-next-line no-new -- syntax check only
    new RegExp(fields.pattern, fields.flags);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new RegexError("INVALID_PATTERN", `Invalid regular expression: ${msg}`, opts);
  }
}

/** Validates a persisted {@link RegexRule} entity. */
export function validateRegexRuleEntity(rule: RegexRule): void {
  validateRegexRule(rule, { groupId: rule.groupId, ruleId: rule.ruleId });
}
