/**
 * VFS entry repository port (core-internal).
 *
 * @module domain/vfs/repositories/vfs-entry.port
 */

import type { VfsEntry, VfsStorageKind } from "../model/vfs-entry.js";
import type { VfsListEntry } from "../model/vfs-list-entry.js";
import type {
  VfsDeleteOptions,
  VfsListOptions,
  VfsWriteRepoOptions,
} from "../model/vfs-options.js";

/**
 * Persistence contract for vfs_entry rows. Implemented by SQLite adapter only.
 */
export interface VfsEntryRepository {
  list(dir: string, options?: VfsListOptions): Promise<VfsListEntry[]>;

  findByPath(path: string): Promise<VfsEntry | null>;

  insert(path: string, content: string): Promise<{ version: number }>;

  /**
   * Inserts a new file entry at an explicit head version.
   *
   * @remarks Used when re-creating a path whose vfs_entry was removed but revision history remains.
   */
  insertAtVersion(
    path: string,
    content: string,
    version: number,
  ): Promise<{ version: number }>;

  insertDirectory(path: string): Promise<void>;

  update(
    path: string,
    content: string,
    options: VfsWriteRepoOptions,
  ): Promise<{ version: number }>;

  delete(path: string, options: VfsDeleteOptions): Promise<void>;

  listAllPaths(): Promise<string[]>;

  listDirectoryPathsUnderPrefix(physicalPrefix: string): Promise<string[]>;

  listEntriesUnderPrefix(prefix: string): Promise<VfsListEntry[]>;

  /** Lists file paths and mtimes under a prefix without reading `content`. */
  listFileMetaUnderPrefix(physicalPrefix: string): Promise<
    ReadonlyArray<{ path: string; mtimeMs: number }>
  >;

  scanContents(pathPrefix?: string): Promise<
    ReadonlyArray<{
      path: string;
      content: string;
      storageKind: VfsStorageKind;
    }>
  >;
}
