/**
 * Minimal VFS port for checkpoint restore (domain layer).
 *
 * @module domain/vfs/ports/vfs-restore.port
 */

import type { VfsReadResult, WriteOptions } from "./vfs-service.port.js";

/** Subset of {@link VfsService} used by message-checkpoint restore logic. */
export interface VfsRestorePort {
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<VfsReadResult>;
  write(
    path: string,
    content: string,
    options?: WriteOptions
  ): Promise<{ version: number }>;
  delete(path: string): Promise<void>;

  /**
   * 将 live head 拨回指定 version（不 append、不 bump）。
   *
   * @remarks restore-path 走 resetHead 语义替代 write 注水。
   */
  resetHeadToVersion(path: string, version: number): Promise<void>;
}
