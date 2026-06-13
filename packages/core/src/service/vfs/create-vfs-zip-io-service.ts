/**
 * Factory for {@link VfsZipIoService}.
 *
 * @module service/vfs/create-vfs-zip-io-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { VfsZipIoService } from "@/domain/vfs/ports/vfs-zip-io.port.js";
import {
  DefaultVfsZipIoService,
  type VfsZipImportTestHook,
} from "./impl/vfs-zip-io.service.js";

export type CreateVfsZipIoServiceOptions = {
  /** @internal import rollback tests only */
  readonly testHook?: VfsZipImportTestHook;
};

/**
 * Creates a ZIP import/export service for the given connection.
 */
export function createVfsZipIoService(
  conn: TdbcConnection,
  options: CreateVfsZipIoServiceOptions = {},
): VfsZipIoService {
  const repo = new SqliteVfsEntryRepository(conn);
  return new DefaultVfsZipIoService(conn, repo, {
    testHook: options.testHook,
  });
}
