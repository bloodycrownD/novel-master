/**
 * VFS revision SQLite DDL (append-only file history).
 *
 * @module bootstrap/vfs/vfs-revision-schema
 */

/** Creates vfs_revision table if missing. */
export const VFS_REVISION_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS vfs_revision (
  path TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT,
  status TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  storage_kind TEXT NOT NULL DEFAULT 'inline',
  PRIMARY KEY (path, version)
)`.trim();

/** Path lookup index for revision GC and restore. */
export const VFS_REVISION_PATH_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_vfs_revision_path ON vfs_revision(path)`.trim();

/** All vfs_revision bootstrap statements in execution order. */
export const VFS_REVISION_SCHEMA_STATEMENTS: readonly string[] = [
  VFS_REVISION_TABLE_DDL,
  VFS_REVISION_PATH_INDEX_DDL,
];
