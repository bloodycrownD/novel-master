/**
 * Session file cache 表 DDL（storage-cache-dedup-and-cleanup：feature A）。
 *
 * @module bootstrap/session-kkv/file-cache-schema
 */

/**
 * 幂等 DDL：`session_file_cache_blob` 内容表 + `session_file_cache_entry`
 * 引用表 + content_hash 索引，照 `vfs_content_blob` 模式，DDL 与 spec
 * 「表结构」一节完全一致。
 *
 * blob 表按 body 的 sha256（复用 hash-content.ts）全库单份存压缩内容
 * （WITHOUT ROWID，主键即哈希）；entry 表按 (session_id, key) 存会话侧
 * 轻量引用，key 键名与旧 session_kkv_entry 的 file_cache 域一致
 * （`{status}:{path}`）。mtime 留在引用行——同 body 不同 mtime 的会话
 * 共享 blob 且各自精确还原（命中不校验 mtime 的既有口径不动）。
 */
export const FILE_CACHE_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS session_file_cache_blob (
    content_hash TEXT NOT NULL PRIMARY KEY,
    encoding TEXT NOT NULL CHECK (encoding IN ('zlib', 'zlib-b64')),
    bytes BLOB NOT NULL,
    byte_len INTEGER NOT NULL
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS session_file_cache_entry (
    session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    mtime_ms INTEGER NOT NULL,
    PRIMARY KEY (session_id, key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_file_cache_hash
    ON session_file_cache_entry(content_hash)`,
];
