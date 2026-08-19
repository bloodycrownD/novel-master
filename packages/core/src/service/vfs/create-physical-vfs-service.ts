/**
 * Physical VFS service factory.
 *
 * @module service/vfs/create-physical-vfs-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { DefaultPhysicalVfsService } from "./impl/physical-vfs.service.js";
import type { PhysicalVfsService } from "./physical-vfs.port.js";

/**
 * Creates a read-only {@link PhysicalVfsService} for the given connection.
 *
 * @param conn - Open connection after `bootstrapNovelMaster`
 */
export function createPhysicalVfsService(
  conn: TdbcConnection,
): PhysicalVfsService {
  return new DefaultPhysicalVfsService(conn);
}
