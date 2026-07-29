/**
 * vfs_content_blob 表 DDL（内容寻址 + zlib + blob 引用计数）。
 *
 * `ref_count` 列由 3 个 revision 触发器维护（INSERT +1 / DELETE -1 / UPDATE 转移），
 * 归零时触发器自动删 blob 行，用于 blob 存储回收。这与 `vfs_revision.ref_count`
 * （应用层维护，用于 revision 可达性 GC）是不同层级的计数器，并存不矛盾。
 *
 * @module bootstrap/vfs/vfs-content-blob-schema
 */

/** 若不存在则创建 vfs_content_blob 表（含 ref_count 列）。 */
export const VFS_CONTENT_BLOB_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS vfs_content_blob (
  content_hash TEXT PRIMARY KEY,
  encoding TEXT NOT NULL,
  bytes BLOB NOT NULL,
  byte_len INTEGER NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0
)`.trim();

/** vfs_content_blob bootstrap 语句。 */
export const VFS_CONTENT_BLOB_SCHEMA_STATEMENTS: readonly string[] = [
  VFS_CONTENT_BLOB_TABLE_DDL,
];
