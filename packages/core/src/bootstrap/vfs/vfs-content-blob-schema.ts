/**
 * vfs_content_blob 表 DDL（内容寻址 + zlib）。
 *
 * @module bootstrap/vfs/vfs-content-blob-schema
 */

/** 若不存在则创建 vfs_content_blob 表。 */
export const VFS_CONTENT_BLOB_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS vfs_content_blob (
  content_hash TEXT PRIMARY KEY,
  encoding TEXT NOT NULL,
  bytes BLOB NOT NULL,
  byte_len INTEGER NOT NULL
)`.trim();

/** vfs_content_blob bootstrap 语句。 */
export const VFS_CONTENT_BLOB_SCHEMA_STATEMENTS: readonly string[] = [
  VFS_CONTENT_BLOB_TABLE_DDL,
];
