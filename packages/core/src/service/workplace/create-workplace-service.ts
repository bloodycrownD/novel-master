/**
 * Workplace service factory.
 *
 * @module service/workplace/create-workplace-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteSmartSortRuleRepository } from "@/domain/smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository.js";
import { compileSmartSortRule } from "@/domain/smart-sort-rule/logic/compile-smart-sort-rule.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import type { WorkplaceScope } from "@/domain/workplace/model/workplace-types.js";
import { DefaultWorkplaceService } from "./impl/workplace.service.js";
import type { WorkplaceService } from "./workplace.port.js";

/**
 * Creates a {@link WorkplaceService} for the given scope and connection.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 * @param scope - global, project, or session VFS scope
 */
export function createWorkplaceService(
  conn: TdbcConnection,
  scope: WorkplaceScope
): WorkplaceService {
  return new DefaultWorkplaceService({
    conn,
    scope,
    vfs: new SqliteVfsEntryRepository(conn),
    workplace: new SqliteWorkplaceRepository(conn),
    // 懒加载 smart 规则 provider（Step 6）：仅在存在启用且 sortField='smart'
    // 的目录规则时才被调用；三端 runtime 均经本工厂构造，零逐端接线。
    smartRules: async () => {
      const rules = new SqliteSmartSortRuleRepository(conn);
      const compiled = [];
      for (const rule of await rules.listOrdered()) {
        if (rule.enabled) {
          compiled.push(compileSmartSortRule(rule));
        }
      }
      return compiled;
    },
  });
}
