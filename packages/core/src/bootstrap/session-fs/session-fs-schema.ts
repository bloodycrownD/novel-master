/**
 * Session FS tables DDL (snapshots, execute batches).
 *
 * @module bootstrap/session-fs/session-fs-schema
 */

/** Idempotent DDL for session file snapshots and execute records. */
export const SESSION_FS_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS session_vfs_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    snapshot_rev INTEGER NOT NULL,
    content TEXT,
    status TEXT NOT NULL,
    vfs_version INTEGER,
    created_at_ms INTEGER NOT NULL,
    created_by TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_vfs_snapshot_path
    ON session_vfs_snapshot(session_id, logical_path, snapshot_rev)`,
  `CREATE TABLE IF NOT EXISTS session_execute_batch (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    message_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS session_execute_action (
    batch_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    function TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    payload_json TEXT,
    PRIMARY KEY (batch_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS session_execute_checkpoint (
    batch_id TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    snapshot_rev INTEGER NOT NULL,
    vfs_version INTEGER,
    created_at_ms INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    PRIMARY KEY (batch_id, logical_path)
  )`,
];
