/**
 * Narrow port for resolving active compiled regex rules.
 *
 * @module domain/regex/ports/active-regex-rules.port
 */

import type { CompiledRegexRule } from "../logic/compile-regex-rule.js";
import type { RegexGroup } from "../model/regex-group.js";

export interface ActiveRegexRulesSource {
  getGroup(id: string): Promise<RegexGroup>;
  listCompiledRulesForGroup(groupId: string): Promise<CompiledRegexRule[]>;
}
