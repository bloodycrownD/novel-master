/**
 * Chat tables DDL (project, session, message).
 *
 * @module bootstrap/chat/chat-schema
 */

/** Idempotent DDL for chat entities. */
export const CHAT_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS chat_project (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_session (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT,
    user_vfs_pending_json TEXT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_session_project
    ON chat_session(project_id)`,
  `CREATE TABLE IF NOT EXISTS chat_message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content_json TEXT NOT NULL,
    provider TEXT,
    raw_json TEXT,
    created_at_ms INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    UNIQUE (session_id, seq)
  )`,
];
