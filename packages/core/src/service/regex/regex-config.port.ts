/**
 * Regex configuration service port (groups + rules CRUD).
 *
 * @module service/regex/regex-config.port
 */

import type { CompiledRegexRule } from "@/domain/regex/compile-regex-rule.js";
import type { RegexGroup } from "@/domain/regex/model/regex-group.js";
import type { RegexRule } from "@/domain/regex/model/regex-rule.js";
import type {
  CreateRegexGroupInput,
  CreateRegexRuleInput,
  UpdateRegexGroupInput,
  UpdateRegexRuleInput,
} from "@/domain/regex/regex-rule.schema.js";

/** Application service for regex groups and rules. */
export interface RegexConfigService {
  createGroup(input: CreateRegexGroupInput): Promise<RegexGroup>;
  listGroups(): Promise<RegexGroup[]>;
  getGroup(groupId: string): Promise<RegexGroup>;
  updateGroup(groupId: string, patch: UpdateRegexGroupInput): Promise<RegexGroup>;
  deleteGroup(groupId: string): Promise<void>;

  createRule(input: CreateRegexRuleInput): Promise<RegexRule>;
  listRules(groupId: string): Promise<RegexRule[]>;
  getRule(groupId: string, ruleId: string): Promise<RegexRule>;
  updateRule(
    groupId: string,
    ruleId: string,
    patch: UpdateRegexRuleInput,
  ): Promise<RegexRule>;
  deleteRule(groupId: string, ruleId: string): Promise<void>;
  setRuleEnabled(
    groupId: string,
    ruleId: string,
    enabled: boolean,
  ): Promise<RegexRule>;

  /** Enabled rules for group, compiled in `sort_order` (empty if group missing). */
  listCompiledRulesForGroup(groupId: string): Promise<CompiledRegexRule[]>;
}
