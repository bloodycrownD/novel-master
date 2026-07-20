/**
 * Workplace service factory.
 *
 * @module service/workplace/create-workplace-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
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
  scope: WorkplaceScope,
): WorkplaceService {
  return new DefaultWorkplaceService({
    scope,
    vfs: new SqliteVfsEntryRepository(conn),
    workplace: new SqliteWorkplaceRepository(conn),
  });
}
