/**
 * Worktree service factory.
 *
 * @module service/worktree/create-worktree-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteWorktreeRepository } from "@/domain/worktree/repositories/impl/sqlite-worktree.repository.js";
import type { WorktreeScope } from "@/domain/worktree/model/worktree-types.js";
import { DefaultWorktreeService } from "./impl/worktree.service.js";
import type { WorktreeService } from "./worktree.port.js";

/**
 * Creates a {@link WorktreeService} for the given scope and connection.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 * @param scope - global, project, or session VFS scope
 */
export function createWorktreeService(
  conn: TdbcConnection,
  scope: WorktreeScope,
): WorktreeService {
  return new DefaultWorktreeService({
    scope,
    vfs: new SqliteVfsEntryRepository(conn),
    worktree: new SqliteWorktreeRepository(conn),
  });
}
