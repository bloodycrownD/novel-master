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
    version: number
  ): Promise<VfsRevision | null>;

  /** 判断指定 entryId+version 的 revision 行是否存在（不解正文）。 */
  existsByEntryAndVersion(entryId: number, version: number): Promise<boolean>;

  /**
   * 读取指定 entryId+version 的 status / content_hash（不解正文）。
   *
   * @returns 行不存在时为 `null`
   */
  findMetaByEntryAndVersion(
    entryId: number,
    version: number
  ): Promise<VfsRevisionPointerMeta | null>;

  /**
   * 批量读取指定 (entryId, version) 的 status / content_hash（不解正文）。
   *
   * @returns 键为 `entryId:version`；不存在的 pair 不在 map 中
   */
  findMetasByEntryVersions(
    pairs: ReadonlyArray<{ readonly entryId: number; readonly version: number }>
  ): Promise<Map<string, VfsRevisionPointerMeta>>;

  /**
   * Returns the highest stored revision version for an entry.
   *
   * @returns `null` when no revision rows exist for the entry.
   */
  findMaxVersionForEntry(entryId: number): Promise<number | null>;

  /**
   * 批量读取多个 entry 的最高 revision version（`IN` 分块 + `GROUP BY` 聚合）。
   *
   * @remarks 供递归删除等批量场景一次取齐 MAX，避免逐 entry 查询的 N+1；
   * 没有 revision 行的 entry 不进 Map。
   */
  findMaxVersionsForEntries(entryIds: number[]): Promise<Map<number, number>>;

  /** Appends a new revision row; never updates existing rows. */
  append(input: VfsRevisionAppendInput): Promise<void>;

  /**
   * 列出 scope 下某逻辑路径前缀的所有 `(entryId, version)` revision 键。
   *
   * @remarks Used by revision GC to enumerate candidates for deletion.
   */
  listKeysUnderScope(
    scopeKey: string,
    pathPrefix: string
  ): Promise<ReadonlyArray<{ entryId: number; version: number }>>;

  /**
   * 删除 scope 下某逻辑路径前缀内、`entryId:version` 键不在 `reachable` 中的 revision 行。
   *
   * @returns Count of deleted rows.
   */
  deleteExceptReachable(
    scopeKey: string,
    pathPrefix: string,
    reachable: ReadonlySet<string>
  ): Promise<number>;

  /** 对 (entryId, version) 的 ref_count 增减；行不存在且 delta<0 时为 no-op。 */
  adjustRefCount(
    entryId: number,
    version: number,
    delta: number
  ): Promise<void>;

  /**
   * 批量增减 ref_count。
   *
   * delta = +1 时，对缺失的 (entryId, version) 行抛 `VfsError("NOT_FOUND")`——
   * 这跟逐条 {@link adjustRefCount} 的语义保持一致，用来守护 T-RB-REF-MISSING 不变量；
   * delta = -1 时缺失行直接 no-op（UPDATE 命不中即跳过）。
   *
   * @remarks 内部按 `REVISION_BATCH_CHUNK_SIZE` 分块：先批量查存在性（仅 delta>0 需要），
   * 再对每个分块发一条 `UPDATE ... WHERE (entry_id, version) IN (...)`。
   * 入参为空时直接返回，不发任何 SQL。批量场景（seed-fork / copy / delete）用它替换
   * 逐条 adjustRefCount 的循环，把 N 次 SQL 往返压成 ceil(N/chunk) 次。
   */
  batchAdjustRefCount(
    pointers: ReadonlyArray<{
      readonly entryId: number;
      readonly version: number;
    }>,
    delta: 1 | -1
  ): Promise<void>;

  /**
   * 批量增减 ref_count（自定义 delta，seed 场景用）。
   *
   * 与 {@link batchAdjustRefCount} 相同，但 delta 可以是任意正整数——seed 场景
   * 一次性加 `msgCount`，比 expand 成 N 份再调 +1 更高效。delta > 0 做存在性校验，
   * delta < 0 时缺失行 no-op。
   */
  batchAdjustRefCountWithDelta(
    pointers: ReadonlyArray<{
      readonly entryId: number;
      readonly version: number;
    }>,
    delta: number
  ): Promise<void>;

  /**
   * 批量检查哪些 (entryId, version) 的 revision 行已存在。
   *
   * @returns 已存在的 pair 集合，key 格式为 `${entryId}:${version}`
   */
  findExistingEntryVersionKeys(
    pairs: ReadonlyArray<{ readonly entryId: number; readonly version: number }>
  ): Promise<Set<string>>;

  /**
   * 批量插入 revision 行并直接设置 ref_count。
   *
   * @remarks 与逐条 append + adjustRefCount 等效，但在一个原生调用内完成。
   * 仅用于 tree-copy / seed 的「全新 revision」场景（调用方已确保行不存在）。
   * content_hash 非 null 时触发器会自动 bump blob ref_count。
   */
  batchAppendWithRefCount(
    items: ReadonlyArray<{
      readonly entryId: number;
      readonly version: number;
      readonly contentHash: string | null;
      readonly status: string;
      readonly mtimeMs: number;
      readonly refCount: number;
    }>
  ): Promise<void>;

  /** 将 ref_count 上调至 expected（只增不减，保守纠偏）。 */
  repairRefCountFloor(
    entryId: number,
    version: number,
    expected: number
  ): Promise<boolean>;

  /**
   * 批量版本 {@link repairRefCountFloor}，把 N 次 SELECT + N 次 UPDATE 压成
   * ceil(N/500) 次 SELECT + ceil(N/500) 次 batch UPDATE。
   *
   * @remarks 内部按 `REVISION_REPAIR_CHUNK_SIZE`（500）分块：先批量 SELECT 所有
   * (entry_id, version) 的当前 ref_count，再在内存里算 diff（只挑 current < expected
   * 的项），最后用 `conn.batch(UPDATE ... SET ref_count = ? WHERE entry_id = ? AND
   * version = ?)` 一次性写回。保持「只增不减」语义——current >= expected 的行不碰，
   * 缺失行（revision 已被 GC）也 no-op，跟逐条 {@link repairRefCountFloor} 完全一致。
   *
   * @returns 实际发生上调的行数
   */
  batchRepairRefCountFloor(
    items: ReadonlyArray<{
      readonly entryId: number;
      readonly version: number;
      readonly expected: number;
    }>
  ): Promise<number>;

  /**
   * 删除 scope 下某逻辑路径前缀内 ref_count <= 0 的 revision 行。
   *
   * @param excludePrefixes - 非空时，这些逻辑路径前缀下的 revision 不参与 GC
   *   （隔离豁免，如 `meta/skills`）；前缀可带或不带前导 `/`。
   * @returns 删除行数
   */
  deleteUnreferencedUnderScope(
    scopeKey: string,
    pathPrefix: string,
    excludePrefixes?: readonly string[]
  ): Promise<number>;

  /**
   * 全局清扫：删除 ref_count<=0 且 entry_id 已不在 vfs_entry 的 revision 行。
   *
   * 用于回收「删文件后遗留的 JOIN 孤儿」——deleteUnreferencedUnderScope 靠
   * `JOIN vfs_entry` 用 (scope_key, path) 圈定范围，扫不到 entry 已删的 revision。
   * 这条全局清扫不依赖 entry 存在，把 entry 已删且 ref_count<=0 的 revision 全清掉，
   * revision DELETE 触发器会连带回收归零的 blob。
   *
   * @returns 删除行数
   */
  deleteGlobalOrphans(): Promise<number>;
}
