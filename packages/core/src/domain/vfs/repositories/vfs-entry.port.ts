/**
 * VFS entry repository port (core-internal).
 *
 * @module domain/vfs/repositories/vfs-entry.port
 */

import type { VfsEntry } from "../model/vfs-entry.js";
import type {
  VfsDeleteOptions,
  VfsListOptions,
  VfsWriteRepoOptions,
} from "../model/vfs-options.js";

/**
 * Persistence contract for vfs_entry rows. Implemented by SQLite adapter only.
 */
export interface VfsEntryRepository {
  list(dir: string, options?: VfsListOptions): Promise<string[]>;

  findByPath(path: string): Promise<VfsEntry | null>;

  insert(path: string, content: string): Promise<{ version: number }>;

  update(
    path: string,
    content: string,
    options: VfsWriteRepoOptions,
  ): Promise<{ version: number }>;

  delete(path: string, options: VfsDeleteOptions): Promise<void>;

  listAllPaths(): Promise<string[]>;

  scanContents(pathPrefix?: string): Promise<
    ReadonlyArray<{ path: string; content: string }>
  >;
}
