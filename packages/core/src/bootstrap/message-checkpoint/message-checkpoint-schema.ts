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
) WITHOUT ROWID`.trim();

/** File entry → revision version pointer at capture time (entry_id 形态，WITHOUT ROWID). */
export const MESSAGE_CHECKPOINT_FILE_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS message_checkpoint_file (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  entry_id INTEGER NOT NULL,
  revision_version INTEGER NOT NULL CHECK (revision_version >= 1),
  PRIMARY KEY (session_id, message_id, entry_id)
) WITHOUT ROWID`.trim();

/** Session-scoped checkpoint lookup.
 *
 * 冗余索引，已退役：WITHOUT ROWID 表 PK (session_id, message_id) 的 B-tree
 * 天然支持 session_id 前缀查询，二级索引纯属写放大。且部分真机的 quick-sqlite
 * 对「WITHOUT ROWID 表 + CREATE INDEX」报 disk I/O error（实测），不再创建。
 * 常量保留供老库路径 DROP 清理时引用。
 */
export const MESSAGE_CHECKPOINT_SESSION_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_message_checkpoint_session
  ON message_checkpoint(session_id)`.trim();

/** All message checkpoint bootstrap statements in execution order. */
export const MESSAGE_CHECKPOINT_SCHEMA_STATEMENTS: readonly string[] = [
  MESSAGE_CHECKPOINT_TABLE_DDL,
  MESSAGE_CHECKPOINT_FILE_TABLE_DDL,
];
