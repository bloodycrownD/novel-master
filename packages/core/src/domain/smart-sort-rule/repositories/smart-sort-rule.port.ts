/**
 * Smart sort rule repository port.
 *
 * @module domain/smart-sort-rule/repositories/smart-sort-rule.port
 */

import type { SmartSortRule } from "../model/smart-sort-rule.js";

/** Persistence for the flat smart_sort_rule table (spec D2). */
export interface SmartSortRuleRepository {
  /** 全量按 sort_order（同序按 rule_id 稳定）。 */
  listOrdered(): Promise<SmartSortRule[]>;
  find(ruleId: string): Promise<SmartSortRule | null>;
  insert(rule: SmartSortRule): Promise<void>;
  /** 整行更新（含 sort_order；调序重编号走逐条 update）。 */
  update(rule: SmartSortRule): Promise<void>;
  delete(ruleId: string): Promise<void>;
  /** 清空全部行（含内置；替换式导入用，spec D10）。 */
  deleteAll(): Promise<void>;
  nextSortOrder(): Promise<number>;
}
