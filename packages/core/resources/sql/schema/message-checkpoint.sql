-- Message checkpoint SQLite DDL (tree index only; Phase 2 services).
-- entry_id 化后 'message_checkpoint_file' 用 'entry_id' 替代 'logical_path' 指向
-- vfs_entry，主键改为 '(session_id, message_id, entry_id)'。checkpoint 不再与具体
-- path 死绑，rename 文件后历史 checkpoint 仍能命中同一 entry；'path' 尾列另存
-- capture 时点的路径快照，供「entry 行已被删除」场景反解回滚 targetTree。

CREATE TABLE IF NOT EXISTS message_checkpoint (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, message_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS message_checkpoint_file (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  entry_id INTEGER NOT NULL,
  revision_version INTEGER NOT NULL CHECK (revision_version >= 1),
  path TEXT NULL,
  PRIMARY KEY (session_id, message_id, entry_id)
) WITHOUT ROWID;
