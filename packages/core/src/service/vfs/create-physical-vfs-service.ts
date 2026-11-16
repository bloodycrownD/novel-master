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
// nm-style: keep-local — 公共组合根（cli / desktop / mobile 三端从 public/vfs 取用，生产调用点 3 处）：隔离 impl/DefaultPhysicalVfsService，port 层不暴露实现。
export function createPhysicalVfsService(conn: TdbcConnection): PhysicalVfsService {
  return new DefaultPhysicalVfsService(conn);
}
