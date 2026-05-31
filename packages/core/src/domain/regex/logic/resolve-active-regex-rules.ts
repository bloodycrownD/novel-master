/**
 * Resolves compiled rules for workspace active group (stale pointer → no rules).
 *
 * @module domain/regex/resolve-active-regex-rules
 */

import type { CompiledRegexRule } from "./compile-regex-rule.js";
import { RegexError } from "@/errors/regex-errors.js";
import type { ActiveRegexRulesSource } from "../ports/active-regex-rules.port.js";

/**
 * Returns compiled enabled rules when the group exists; otherwise `[]`.
 *
 * @param activeGroupId - Workspace pointer (`currentRegexGroupId`)
 */
export async function resolveActiveCompiledRules(
  config: ActiveRegexRulesSource,
  activeGroupId: string | undefined,
): Promise<CompiledRegexRule[]> {
  if (activeGroupId == null || activeGroupId === "") {
    return [];
  }
  try {
    await config.getGroup(activeGroupId);
  } catch (e: unknown) {
    if (e instanceof RegexError && e.code === "NOT_FOUND") {
      return [];
    }
    throw e;
  }
  return config.listCompiledRulesForGroup(activeGroupId);
}
