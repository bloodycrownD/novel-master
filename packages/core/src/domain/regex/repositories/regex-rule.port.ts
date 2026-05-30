/**
 * Regex rule repository port.
 *
 * @module domain/regex/repositories/regex-rule.port
 */

import type { RegexRule } from "../model/regex-rule.js";

/** Persistence for regex rules within a group. */
export interface RegexRuleRepository {
  listByGroupOrdered(groupId: string): Promise<RegexRule[]>;
  find(groupId: string, ruleId: string): Promise<RegexRule | null>;
  insert(rule: RegexRule): Promise<void>;
  update(rule: RegexRule): Promise<void>;
  delete(groupId: string, ruleId: string): Promise<void>;
  nextSortOrder(groupId: string): Promise<number>;
}
