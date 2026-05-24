/**
 * VFS service factory: wires repository impl to service impl.
 *
 * @module service/vfs/create-vfs-service
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { DefaultVfsService } from "./impl/vfs.service.js";
import type { VfsService } from "./vfs.port.js";

/**
 * Creates a {@link VfsService} backed by SQLite vfs_entry storage.
 *
 * @param conn - Open TDBC connection after {@link bootstrapNovelMaster}
 */
export function createVfsService(conn: TdbcConnection): VfsService {
  const repo = new SqliteVfsEntryRepository(conn);
  return new DefaultVfsService(repo);
}
