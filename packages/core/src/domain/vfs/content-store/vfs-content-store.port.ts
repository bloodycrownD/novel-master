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
   * 删除不在 `referencedHashes` 内的 blob 行。
   *
   * @remarks 调用方必须传入**全库** entry∪revision 引用集，禁止 session 局部 keepSet。
   * @returns 删除的行数
   */
  gc(referencedHashes: ReadonlySet<string>): Promise<number>;

  /**
   * 收集全库仍被 `vfs_entry` ∪ `vfs_revision` 引用的非空 `content_hash`。
   *
   * @remarks 全库 blob 回收算法唯一入口之一；须经 {@link runDeferredBlobGc} 调度，禁止回滚热路径 sync 调用。
   */
  collectAllReferencedHashes(): Promise<Set<string>>;
}
