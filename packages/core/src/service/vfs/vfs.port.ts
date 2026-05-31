/**
 * Re-exports VFS port from domain (service impl implements {@link VfsService}).
 *
 * @module service/vfs/vfs.port
 */

export type {
  VfsGrepMatch,
  VfsReadResult,
  VfsService,
  WriteOptions,
} from "@/domain/vfs/ports/vfs-service.port.js";
