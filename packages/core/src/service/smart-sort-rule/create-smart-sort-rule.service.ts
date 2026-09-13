/**
 * Factory for {@link DefaultSmartSortRuleService}.
 *
 * @module service/smart-sort-rule/create-smart-sort-rule-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { BUILTIN_SMART_SORT_RULE_ROWS } from "@/bootstrap/smart-sort-rule/builtin-smart-sort-rules.js";
import { SqliteSmartSortRuleRepository } from "@/domain/smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository.js";
import { DefaultSmartSortRuleService } from "./impl/smart-sort-rule.service.js";
import type { SmartSortRuleService } from "./smart-sort-rule.port.js";

/**
 * Creates smart sort rule service.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 */
export function createSmartSortRuleService(
  conn: TdbcConnection
): SmartSortRuleService {
  return new DefaultSmartSortRuleService({
    rules: new SqliteSmartSortRuleRepository(conn),
    builtinSeed: BUILTIN_SMART_SORT_RULE_ROWS,
  });
}
