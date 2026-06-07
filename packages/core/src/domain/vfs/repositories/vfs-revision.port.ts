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

  /**
   * Lists all `(path, version)` revision keys under a physical prefix.
   *
   * @remarks Used by revision GC to enumerate candidates for deletion.
   */
  listKeysUnderPrefix(
    physicalPrefix: string,
  ): Promise<ReadonlyArray<{ path: string; version: number }>>;

  /**
   * Deletes revision rows under `physicalPrefix` whose `path:version` key is not in `reachable`.
   *
   * @returns Count of deleted rows.
   */
  deleteExceptReachable(
    physicalPrefix: string,
    reachable: ReadonlySet<string>,
  ): Promise<number>;
}
