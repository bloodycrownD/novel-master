/**
 * VFS revision repository port (append-only file history).
 *
 * @module domain/vfs/repositories/vfs-revision.port
 */

import type { VfsRevision } from "../model/vfs-revision.js";

/** Input for appending a new revision row (insert-only). */
export type VfsRevisionAppendInput = Omit<VfsRevision, never>;

/**
 * Persistence contract for vfs_revision rows.
 */
export interface VfsRevisionRepository {
  /**
   * Loads a specific revision by path and version.
   *
   * @returns `null` when no row exists for the pair.
   */
  findByPathAndVersion(
    path: string,
    version: number,
  ): Promise<VfsRevision | null>;

  /**
   * Returns the highest stored revision version for a path.
   *
   * @returns `null` when no revision rows exist for the path.
   */
  findMaxVersionForPath(path: string): Promise<number | null>;

  /** Appends a new revision row; never updates existing rows. */
  append(input: VfsRevisionAppendInput): Promise<void>;
}
