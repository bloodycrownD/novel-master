/**
 * Message checkpoint SQLite DDL (tree index only; Phase 2 services).
 *
 * @module bootstrap/message-checkpoint/message-checkpoint-schema
 */

/** Anchor row per Agent message with mutating tools. */
export const MESSAGE_CHECKPOINT_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS message_checkpoint (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, message_id)
)`.trim();

/** File path → revision version pointer at capture time. */
export const MESSAGE_CHECKPOINT_FILE_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS message_checkpoint_file (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  logical_path TEXT NOT NULL,
  revision_version INTEGER NOT NULL,
  PRIMARY KEY (session_id, message_id, logical_path)
)`.trim();

/** Session-scoped checkpoint lookup. */
export const MESSAGE_CHECKPOINT_SESSION_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_message_checkpoint_session
  ON message_checkpoint(session_id)`.trim();

/** All message checkpoint bootstrap statements in execution order. */
export const MESSAGE_CHECKPOINT_SCHEMA_STATEMENTS: readonly string[] = [
  MESSAGE_CHECKPOINT_TABLE_DDL,
  MESSAGE_CHECKPOINT_FILE_TABLE_DDL,
  MESSAGE_CHECKPOINT_SESSION_INDEX_DDL,
];
