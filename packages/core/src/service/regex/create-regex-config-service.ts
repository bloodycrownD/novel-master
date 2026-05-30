/**
 * Factory for {@link DefaultRegexConfigService}.
 *
 * @module service/regex/create-regex-config-service
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { SqliteRegexGroupRepository } from "@/domain/regex/repositories/impl/sqlite-regex-group.repository.js";
import { SqliteRegexRuleRepository } from "@/domain/regex/repositories/impl/sqlite-regex-rule.repository.js";
import type { PersistentState } from "@/service/persistent-state/persistent-state.port.js";
import { DefaultRegexConfigService } from "./impl/regex-config.service.js";
import type { RegexConfigService } from "./regex-config.port.js";

/**
 * Creates regex configuration service.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 * @param state - Optional; when provided, {@link RegexConfigService.deleteGroup} resets current pointer
 */
export function createRegexConfigService(
  conn: TdbcConnection,
  state?: PersistentState,
): RegexConfigService {
  return new DefaultRegexConfigService({
    groups: new SqliteRegexGroupRepository(conn),
    rules: new SqliteRegexRuleRepository(conn),
    state,
  });
}
