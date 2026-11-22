-- Session file cache 表 DDL（storage-cache-dedup-and-cleanup：feature A）。

CREATE TABLE IF NOT EXISTS session_file_cache_blob (
    content_hash TEXT NOT NULL PRIMARY KEY,
    encoding TEXT NOT NULL CHECK (encoding IN ('zlib', 'zlib-b64')),
    bytes BLOB NOT NULL,
    byte_len INTEGER NOT NULL
  ) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS session_file_cache_entry (
    session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    mtime_ms INTEGER NOT NULL,
    PRIMARY KEY (session_id, key)
  );

CREATE INDEX IF NOT EXISTS idx_session_file_cache_hash
    ON session_file_cache_entry(content_hash);
