/**
 * VFS revision repository port (append-only file history).
 *
 * entry_id 化后全部按 `entryId` 寻址；前缀扫描类按 `(scopeKey, pathPrefix)` 经
 * `vfs_entry` JOIN 圈定范围。
 *
 * @module domain/vfs/repositories/vfs-revision.port
 */

import type { VfsRevision, VfsRevisionStatus } from "../model/vfs-revision.js";

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
 * revision 行轻量元数据（不解 ContentStore 正文）。
 */
export type VfsRevisionPointerMeta = {
  readonly status: VfsRevisionStatus;
  readonly contentHash: string | null;
};

/**
 * Persistence contract for vfs_revision rows.
 */
export interface VfsRevisionRepository {
  /**
   * 按 entryId + version 读取完整 revision（解正文）。
   *
   * @returns `null` when no row exists for the pair.
   */
  findByEntryAndVersion(
    entryId: number,
    version: number,
  ): Promise<VfsRevision | null>;

  /** 判断指定 entryId+version 的 revision 行是否存在（不解正文）。 */
  existsByEntryAndVersion(
    entryId: number,
    version: number,
  ): Promise<boolean>;

  /**
   * 读取指定 entryId+version 的 status / content_hash（不解正文）。
   *
   * @returns 行不存在时为 `null`
   */
  findMetaByEntryAndVersion(
    entryId: number,
    version: number,
  ): Promise<VfsRevisionPointerMeta | null>;

  /**
   * 批量读取指定 (entryId, version) 的 status / content_hash（不解正文）。
   *
   * @returns 键为 `entryId:version`；不存在的 pair 不在 map 中
   */
  findMetasByEntryVersions(
    pairs: ReadonlyArray<{ readonly entryId: number; readonly version: number }>,
  ): Promise<Map<string, VfsRevisionPointerMeta>>;

  /**
   * Returns the highest stored revision version for an entry.
   *
   * @returns `null` when no revision rows exist for the entry.
   */
  findMaxVersionForEntry(entryId: number): Promise<number | null>;

  /** Appends a new revision row; never updates existing rows. */
  append(input: VfsRevisionAppendInput): Promise<void>;

  /**
   * 列出 scope 下某逻辑路径前缀的所有 `(entryId, version)` revision 键。
   *
   * @remarks Used by revision GC to enumerate candidates for deletion.
   */
  listKeysUnderScope(
    scopeKey: string,
    pathPrefix: string,
  ): Promise<ReadonlyArray<{ entryId: number; version: number }>>;

  /**
   * 删除 scope 下某逻辑路径前缀内、`entryId:version` 键不在 `reachable` 中的 revision 行。
   *
   * @returns Count of deleted rows.
   */
  deleteExceptReachable(
    scopeKey: string,
    pathPrefix: string,
    reachable: ReadonlySet<string>,
  ): Promise<number>;

  /** 对 (entryId, version) 的 ref_count 增减；行不存在且 delta<0 时为 no-op。 */
  adjustRefCount(entryId: number, version: number, delta: number): Promise<void>;

  /** 将 ref_count 上调至 expected（只增不减，保守纠偏）。 */
  repairRefCountFloor(
    entryId: number,
    version: number,
    expected: number,
  ): Promise<boolean>;

  /**
   * 删除 scope 下某逻辑路径前缀内 ref_count <= 0 的 revision 行。
   *
   * @returns 删除行数
   */
  deleteUnreferencedUnderScope(
    scopeKey: string,
    pathPrefix: string,
  ): Promise<number>;
}
