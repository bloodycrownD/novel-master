/**
 * Workplace service factory.
 *
 * @module service/workplace/create-workplace-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteSmartSortRuleRepository } from "@/domain/smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository.js";
import { createSmartSortRuleService } from "@/service/smart-sort-rule/create-smart-sort-rule.service.js";
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
  // smart 规则装配统一走 SmartSortRuleService.listCompiledRules（core/C-2），
  // 与管理页/CLI 同源，消除工厂内联「listOrdered→filter→compile」平行实现。
  const smartSortRuleService = createSmartSortRuleService(conn);
  return new DefaultWorkplaceService({
    conn,
    scope,
    vfs: new SqliteVfsEntryRepository(conn),
    workplace: new SqliteWorkplaceRepository(conn),
    // 懒加载 smart 规则 provider（Step 6）：仅当存在 sortField='smart' 的
    // 目录规则时才被调用（查表 + 编译，启用过滤由 service 承担）；三端
    // runtime 均经本工厂构造，零逐端接线。
    smartRules: () => smartSortRuleService.listCompiledRules(),
    // 原始行 provider（L1 签名采样，core/B-3）：仅查表不编译，同一 repo 类
    // （每次新建实例、共享同一 conn）。
    smartRuleRows: () => new SqliteSmartSortRuleRepository(conn).listOrdered(),
  });
}
