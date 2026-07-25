/**
 * VFS revision repository port (append-only file history).
 *
 * @module domain/vfs/repositories/vfs-revision.port
 */

import type { VfsRevision } from "../model/vfs-revision.js";

/**
 * Input for appending a new revision row (insert-only).
 *
 * @remarks
 * `contentHash` 若提供则跳过 ContentStore.put，直接落库（seed-fork / backfill 共享 blob）。
 * active 行无 hash 且 `content` 非空时由 repo put 后只写 hash。
 */
export type VfsRevisionAppendInput = VfsRevision & {
  readonly contentHash?: string | null;
};

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
   * 判断指定 path+version 的 revision 行是否存在（不解正文）。
   */
  existsByPathAndVersion(path: string, version: number): Promise<boolean>;

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
