/**
 * VFS SQLite DDL statements (idempotent).
 *
 * @module bootstrap/vfs/vfs-schema
 */

/** Creates vfs_entry table if missing. */
export const VFS_ENTRY_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS vfs_entry (
  path TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  mtime_ms INTEGER NOT NULL,
  storage_kind TEXT NOT NULL DEFAULT 'inline',
  external_uri TEXT
)`.trim();

/** Prefix index for LIKE-based list queries. */
export const VFS_ENTRY_PATH_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_vfs_entry_path_prefix ON vfs_entry(path)`.trim();

/** All bootstrap statements in execution order. */
export const VFS_SCHEMA_STATEMENTS: readonly string[] = [
  VFS_ENTRY_TABLE_DDL,
  VFS_ENTRY_PATH_INDEX_DDL,
];
