-- VFS SQLite DDL statements (idempotent).
-- entry_id 化后 'vfs_entry' 以不可变 'entry_id' 作主键，'scope_key' + 'path' 共同
-- 唯一约束；旧 schema 的 'version'（与 head_version 永远同步）、'storage_kind'
-- （恒 inline）、'external_uri'（恒 NULL）三列退役。'content TEXT NULL' 保留
-- （§A：暂不删该列，数据模型终态图保留它）。

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
);
