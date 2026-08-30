/**
 * VFS SQLite DDL statements (idempotent).
 *
 * entry_id 化后 `vfs_entry` 以不可变 `entry_id` 作主键，`scope_key` + `path` 共同
 * 唯一约束；旧 schema 的 `version`（与 head_version 永远同步）、`storage_kind`
 * （恒 inline）、`external_uri`（恒 NULL）三列退役。`content TEXT NULL` 保留
 * （§A：暂不删该列，数据模型终态图保留它）。
 *
 * @module bootstrap/vfs/vfs-schema
 */

/** 若不存在则创建 vfs_entry 表（entry_id 主键形态，entry_kind CHECK）. */
export const VFS_ENTRY_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS vfs_entry (
  entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NULL,
  head_version INTEGER NOT NULL DEFAULT 1,
  mtime_ms INTEGER NOT NULL,
  entry_kind TEXT NOT NULL DEFAULT 'file' CHECK (entry_kind IN ('file', 'directory')),
  content TEXT NULL,
  UNIQUE(scope_key, path)
)`.trim();

/** scope_key + path 复合索引，用于 scope 内前缀扫描。 */
export const VFS_ENTRY_SCOPE_PATH_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_vfs_entry_scope_path
  ON vfs_entry(scope_key, path)`.trim();

/** All bootstrap statements in execution order.
 *
 * 注意：`scope_key` / `entry_id` 上的具名索引不在此数组内——`UNIQUE(scope_key, path)`
 * 的隐式索引已覆盖前缀扫描需求，其余具名索引曾被视为纯写放大而不再建出
 * （历史上由 vfs-entry-id-redesign-v1 的 rebuildIndexes 统一管理，该函数为刻意空实现，
 * migration 已随第二轮退役删除）。 */
export const VFS_SCHEMA_STATEMENTS: readonly string[] = [VFS_ENTRY_TABLE_DDL];
