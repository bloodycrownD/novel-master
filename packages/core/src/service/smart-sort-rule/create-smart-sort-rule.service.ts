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
    conn,
    // 事务回调内会用 tx 句柄再调一次本工厂造仓储（多语句写入口包事务），
    // 所以这里传的是「按连接造仓储」的函数而不是一个已绑根连接的实例。
    createRules: (c) => new SqliteSmartSortRuleRepository(c),
    builtinSeed: BUILTIN_SMART_SORT_RULE_ROWS,
  });
}
