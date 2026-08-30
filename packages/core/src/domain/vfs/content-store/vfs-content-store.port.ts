/**
 * VFS 内容寻址存储端口（SHA-256 + zlib → SQLite BLOB）。
 *
 * @module domain/vfs/content-store/vfs-content-store.port
 */

/**
 * 明文经 ContentStore 落库；多 revision / live entry 可共享同一 blob。
 */
export interface VfsContentStore {
  /**
   * 将明文 put 入 blob 表；同 hash 已存在则复用行。
   *
   * @returns content_hash（UTF-8 明文 SHA-256 小写 hex）
   */
  put(plain: string): Promise<string>;

  /**
   * 按 hash 解出 UTF-8 明文。
   *
   * @throws 当 blob 不存在或 encoding 无法解码时
   */
  get(contentHash: string): Promise<string>;

  /**
   * 批量按 hash 解出 UTF-8 明文（分块下发 `IN (...)` 查询，避免逐条 get 的 N+1）。
   *
   * @returns 键为命中的 content_hash，值为对应明文；未命中的 hash 不出现在结果中。
   */
  getMany(hashes: readonly string[]): Promise<Map<string, string>>;

  /**
   * 清扫未被 `vfs_entry` ∪ `vfs_revision` 引用的孤立 blob 行（一条 NOT IN 子查询完成）。
   *
   * @remarks 全库引用集由 SQL 子查询当场计算，调用方无需再传 referencedHashes。
   * @returns 删除的行数
   */
  gc(): Promise<number>;

  /**
   * 承诺式 ensure：若指定 content_hash 的 blob 行不存在，则 put 一份明文；
   * 已存在则直接返回 content_hash。
   *
   * @remarks
   * 共享 blob 路径（tree-copy / seed / backfill）在写 revision 之前必须调此方法，
   * 确保触发器 `trg_revision_insert_inc_blob_ref` 的 UPDATE 不命中 0 行。
   * 调用方**不保证**明文完整可用——无明文时传 `null` 仅探测不 put。
   *
   * @param contentHash 目标 blob 的 hash
   * @param fallbackPlain 不存在时用于 put 的明文；为 null 时仅探测不写入
   * @throws 当 blob 不存在且 fallbackPlain 为 null 时抛 `NOT_FOUND`
   */
  ensureBlob(
    contentHash: string,
    fallbackPlain: string | null
  ): Promise<string>;

  /**
   * 批量检查哪些 content_hash 的 blob 行已存在。
   *
   * @returns 已存在的 hash 集合
   */
  findExistingBlobHashes(hashes: ReadonlyArray<string>): Promise<Set<string>>;
}
