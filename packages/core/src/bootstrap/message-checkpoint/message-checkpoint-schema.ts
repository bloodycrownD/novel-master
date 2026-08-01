/**
 * Message checkpoint SQLite DDL (tree index only; Phase 2 services).
 *
 * entry_id 化后 `message_checkpoint_file` 用 `entry_id` 替代 `logical_path` 指向
 * vfs_entry，主键改为 `(session_id, message_id, entry_id)`。checkpoint 不再与具体
 * path 死绑，rename 文件后历史 checkpoint 仍能命中同一 entry。
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

/** File entry → revision version pointer at capture time (entry_id 形态). */
export const MESSAGE_CHECKPOINT_FILE_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS message_checkpoint_file (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  entry_id INTEGER NOT NULL,
  revision_version INTEGER NOT NULL,
  PRIMARY KEY (session_id, message_id, entry_id)
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
