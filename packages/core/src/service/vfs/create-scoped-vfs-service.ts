/**
 * Scoped VFS service factory.
 *
 * @module service/vfs/create-scoped-vfs-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { DefaultVfsService } from "./impl/vfs.service.js";
import { RevisionAwareVfsService } from "./impl/revision-aware-vfs.service.js";
import { ScopedVfsService } from "./impl/scoped-vfs.service.js";
import type { VfsService } from "./vfs.port.js";

/**
 * Creates a {@link VfsService} scoped to global, project, or session domain.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 * @param scope - Visibility scope (logical paths only)
 */
export function createScopedVfsService(
  conn: TdbcConnection,
  scope: VfsScope,
): VfsService {
  const entryRepo = new SqliteVfsEntryRepository(conn);
  const inner = new RevisionAwareVfsService(
    conn,
    new DefaultVfsService(entryRepo),
  );
  return new ScopedVfsService(inner, scope);
}
