/**
 * vfs_content_pack / vfs_content_pack_member 两表 DDL（VFS 非 head 历史版本混合打包）。
 *
 * 一个 entry 的非 head 历史版本按版本序分组进 pack 容器：小组用 zlib-concat-v1
 * （明文拼接、单流 zlib），大组用 fossil-chain-v1（首成员全量 zlib + 后续成员
 * 相对同组前驱的 delta 再 zlib）。member 表是 content_hash → 包内区间的偏移索引，
 * 主键一 hash 一行；`offset`/`length` 的语义按 `format` 解释（pack 切片明文区间 /
 * bytes 内段区间）。`compressed_byte_len` 恒为从被替换 blob 行原样复制的
 * `byte_len`——fossil 组严禁记 delta 长度，否则按压缩侧折算的大文件闸门会失真。
 *
 * @module bootstrap/vfs/vfs-content-pack-schema
 */

/** 若不存在则创建 vfs_content_pack 表（pack 头信息 + 压缩字节流）. */
export const VFS_CONTENT_PACK_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS vfs_content_pack (
  pack_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('zlib-concat-v1','fossil-chain-v1')),
  bytes BLOB NOT NULL,
  byte_len INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
)`.trim();

/** 若不存在则创建 vfs_content_pack_member 表（member 偏移索引，WITHOUT ROWID）. */
export const VFS_CONTENT_PACK_MEMBER_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS vfs_content_pack_member (
  content_hash TEXT NOT NULL PRIMARY KEY,
  pack_id INTEGER NOT NULL,
  offset INTEGER NOT NULL,
  length INTEGER NOT NULL,
  compressed_byte_len INTEGER NOT NULL
) WITHOUT ROWID`.trim();

/** 若不存在则创建 idx_vfs_content_pack_member_pack 索引（按 pack_id 反查成员）. */
export const VFS_CONTENT_PACK_MEMBER_PACK_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_vfs_content_pack_member_pack
  ON vfs_content_pack_member(pack_id)`.trim();

/** vfs_content_pack bootstrap 语句。 */
export const VFS_CONTENT_PACK_SCHEMA_STATEMENTS: readonly string[] = [
  VFS_CONTENT_PACK_TABLE_DDL,
  VFS_CONTENT_PACK_MEMBER_TABLE_DDL,
  VFS_CONTENT_PACK_MEMBER_PACK_INDEX_DDL,
];
