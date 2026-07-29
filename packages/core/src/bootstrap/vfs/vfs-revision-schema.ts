/**
 * VFS revision SQLite DDL (append-only file history).
 *
 * entry_id 化后 revision 改用 `(entry_id, version)` 复合主键寻址，旧的 `path`
 * / `content`（明文，已迁 blob）/ `storage_kind`（恒 inline）三列退役。同时挂上
 * 3 个触发器在 revision INSERT/DELETE/UPDATE 时维护 `vfs_content_blob.ref_count`，
 * 用于 blob 存储回收（归零自动删 blob 行）。
 *
 * @module bootstrap/vfs/vfs-revision-schema
 */

/** Creates vfs_revision table if missing (entry_id 主键形态). */
export const VFS_REVISION_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS vfs_revision (
  entry_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  content_hash TEXT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, version)
)`.trim();

/** entry_id 查询索引，用于 revision GC / restore / scope 扫描。 */
export const VFS_REVISION_ENTRY_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_vfs_revision_entry
  ON vfs_revision(entry_id)`.trim();

/** revision INSERT 时，对非 NULL content_hash 的 blob ref_count + 1。 */
export const VFS_REVISION_INSERT_TRIGGER_DDL = `
CREATE TRIGGER IF NOT EXISTS trg_revision_insert_inc_blob_ref
AFTER INSERT ON vfs_revision
WHEN NEW.content_hash IS NOT NULL
BEGIN
  UPDATE vfs_content_blob SET ref_count = ref_count + 1
  WHERE content_hash = NEW.content_hash;
END`.trim();

/** revision DELETE 时，对非 NULL content_hash 的 blob ref_count - 1，归零删 blob。 */
export const VFS_REVISION_DELETE_TRIGGER_DDL = `
CREATE TRIGGER IF NOT EXISTS trg_revision_delete_dec_blob_ref
AFTER DELETE ON vfs_revision
WHEN OLD.content_hash IS NOT NULL
BEGIN
  UPDATE vfs_content_blob
  SET ref_count = ref_count - 1
  WHERE content_hash = OLD.content_hash;
  DELETE FROM vfs_content_blob
  WHERE content_hash = OLD.content_hash AND ref_count <= 0;
END`.trim();

/** revision UPDATE content_hash 变更时，旧 hash -1 新 hash +1（防御性触发器）。 */
export const VFS_REVISION_UPDATE_TRIGGER_DDL = `
CREATE TRIGGER IF NOT EXISTS trg_revision_update_transfer_blob_ref
AFTER UPDATE OF content_hash ON vfs_revision
WHEN OLD.content_hash IS NOT NEW.content_hash
BEGIN
  UPDATE vfs_content_blob SET ref_count = ref_count - 1
  WHERE content_hash = OLD.content_hash AND OLD.content_hash IS NOT NULL;
  DELETE FROM vfs_content_blob
  WHERE content_hash = OLD.content_hash AND ref_count <= 0 AND OLD.content_hash IS NOT NULL;
  UPDATE vfs_content_blob SET ref_count = ref_count + 1
  WHERE content_hash = NEW.content_hash AND NEW.content_hash IS NOT NULL;
END`.trim();

/** All vfs_revision bootstrap statements in execution order.
 *
 * 触发器 DDL **不在此数组**——SQLite 在 schema 变更（DROP TABLE / ALTER TABLE）时会
 * 重编译触发器，而旧库在跑更早的 zlib migration 时 `vfs_revision` 尚无 `content_hash`
 * 列、`vfs_content_blob` 尚无 `ref_count` 列，重编译会撞 `no such column`。触发器统一
 * 由 `vfs-entry-id-redesign-v1` migration 在两条路径（新库 ensure + 旧库 rebuild）上
 * 创建，靠 `IF NOT EXISTS` 幂等。触发器 DDL 常量仍定义在本文件供 migration import。 */
export const VFS_REVISION_SCHEMA_STATEMENTS: readonly string[] = [
  VFS_REVISION_TABLE_DDL,
];
