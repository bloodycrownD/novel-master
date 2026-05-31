/**
 * Compiles persisted rules into runtime RegExp + metadata for apply pipeline.
 *
 * @module domain/regex/compile-regex-rule
 */

import { RegexError } from "@/errors/regex-errors.js";
import type { RegexRule } from "../model/regex-rule.js";
import { validateRegexRuleEntity } from "./validate-regex-rule.js";

/** Runtime-ready rule (enabled rules only should be passed to apply). */
export interface CompiledRegexRule {
  readonly pattern: RegExp;
  readonly llmReplace: string | null;
  readonly displayReplace: string | null;
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly scopeUser: boolean;
  readonly scopeAssistant: boolean;
}

/**
 * Validates and compiles a {@link RegexRule} to a {@link RegExp}.
 *
 * @throws {RegexError} when pattern is invalid
 */
export function compileRegexRule(rule: RegexRule): CompiledRegexRule {
  validateRegexRuleEntity(rule);
  try {
    const pattern = new RegExp(rule.pattern, rule.flags);
    return {
      pattern,
      llmReplace: rule.llmReplace,
      displayReplace: rule.displayReplace,
      minDepth: rule.minDepth,
      maxDepth: rule.maxDepth,
      scopeUser: rule.scopeUser,
      scopeAssistant: rule.scopeAssistant,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new RegexError("INVALID_PATTERN", `Invalid regular expression: ${msg}`, {
      groupId: rule.groupId,
      ruleId: rule.ruleId,
    });
  }
}
