/**
 * VFS service factory: wires repository impl to service impl.
 *
 * @module service/vfs/create-vfs-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { DefaultVfsService } from "./impl/vfs.service.js";
import { RevisionAwareVfsService } from "./impl/revision-aware-vfs.service.js";
import type { InternalVfsService } from "./internal-vfs.port.js";

/**
 * Creates a revision-aware {@link InternalVfsService} backed by SQLite storage.
 *
 * 返回 core-internal 的 InternalVfsService（按 scopeKey + 逻辑 path 操作）；apps 入口
 * 应改用 {@link createScopedVfsService}，它会把 scope 隐藏在 ScopedVfsService 后面。
 *
 * @param conn - Open TDBC connection after {@link bootstrapNovelMaster}
 */
export function createVfsService(conn: TdbcConnection): InternalVfsService {
  const entryRepo = new SqliteVfsEntryRepository(conn);
  const inner = new DefaultVfsService(entryRepo);
  return new RevisionAwareVfsService(conn, inner);
}
